from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional

from backend import models
from backend import schemas
from backend.database import get_db
from backend.websocket_manager import manager

router = APIRouter(prefix="/volunteers", tags=["Volunteers"])

VALID_STATUSES = {"ASSIGNED", "EN_ROUTE", "REACHED", "COMPLETED"}


@router.post("/", response_model=schemas.VolunteerResponse, status_code=201)
def register_volunteer(volunteer: schemas.VolunteerCreate, db: Session = Depends(get_db)):
    """Register a new volunteer (legacy / quick register without auth)."""
    db_vol = models.Volunteer(
        name=volunteer.name,
        phone=volunteer.phone,
        skill=volunteer.skill,
        latitude=volunteer.latitude,
        longitude=volunteer.longitude,
    )
    db.add(db_vol)
    db.commit()
    db.refresh(db_vol)
    return db_vol


@router.get("/", response_model=List[schemas.VolunteerResponse])
def get_volunteers(db: Session = Depends(get_db)):
    """List all registered volunteers."""
    return db.query(models.Volunteer).order_by(models.Volunteer.registered_at.desc()).all()


@router.patch("/{volunteer_id}", response_model=schemas.VolunteerResponse)
def assign_volunteer(volunteer_id: int, assign: schemas.VolunteerAssign, db: Session = Depends(get_db)):
    """Assign (or unassign) a volunteer to a disaster report."""
    vol = db.query(models.Volunteer).filter(models.Volunteer.id == volunteer_id).first()
    if not vol:
        raise HTTPException(status_code=404, detail="Volunteer not found")
    vol.assigned_report_id = assign.assigned_report_id
    db.commit()
    db.refresh(vol)
    return vol


@router.delete("/{volunteer_id}", status_code=204)
def delete_volunteer(volunteer_id: int, db: Session = Depends(get_db)):
    """Remove a volunteer record and their linked user account."""
    vol = db.query(models.Volunteer).filter(models.Volunteer.id == volunteer_id).first()
    if not vol:
        raise HTTPException(status_code=404, detail="Volunteer not found")
    
    # Also delete the linked User account if it exists
    if vol.username:
        user = db.query(models.User).filter(models.User.username == vol.username).first()
        if user:
            db.delete(user)

    db.delete(vol)
    db.commit()
    return None


@router.post("/status")
async def update_volunteer_status(update: schemas.VolunteerStatusUpdate, db: Session = Depends(get_db)):
    """
    Volunteer updates their own status:
    ASSIGNED → EN_ROUTE → REACHED → COMPLETED
    """
    status = update.status.upper()
    if status not in VALID_STATUSES:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid status. Must be one of: {', '.join(VALID_STATUSES)}"
        )

    vol = db.query(models.Volunteer).filter(models.Volunteer.id == update.volunteer_id).first()
    if not vol:
        raise HTTPException(status_code=404, detail="Volunteer not found")

    vol.volunteer_status = status
    if update.latitude is not None:
        vol.latitude = update.latitude
    if update.longitude is not None:
        vol.longitude = update.longitude
    
    # Auto-resolve report if completed
    updated_report = None
    if status == "COMPLETED":
        report_id_to_clear = vol.assigned_report_id
        if report_id_to_clear:
            report = db.query(models.DisasterReport).filter(models.DisasterReport.id == report_id_to_clear).first()
            if report and report.status != "Resolved":
                report.status = "Resolved"
                updated_report = report
                
            # Cascade free colleagues deployed to the same incident
            stuck_vols = db.query(models.Volunteer).filter(
                models.Volunteer.assigned_report_id == report_id_to_clear,
                models.Volunteer.id != vol.id
            ).all()
            for v in stuck_vols:
                v.assigned_report_id = None
                v.volunteer_status = "Available"
                await manager.broadcast({
                    "type": "VOLUNTEER_UPDATE",
                    "data": {
                        "volunteer_id": v.id,
                        "name": v.name,
                        "status": "Available",
                        "assigned_report_id": None
                    }
                })
                
        # Detach caller and mark as free
        vol.assigned_report_id = None
        vol.volunteer_status = "Available"
        status = "Available" # Let the local variable reflect this for the broadcast

    db.commit()
    db.refresh(vol)

    # Broadcast status update to all connected clients (admin sees instantly)
    await manager.broadcast({
        "type": "VOLUNTEER_UPDATE",
        "data": {
            "volunteer_id": vol.id,
            "name": vol.name,
            "status": vol.volunteer_status,
            "latitude": vol.latitude,
            "longitude": vol.longitude,
            "assigned_report_id": vol.assigned_report_id,
        }
    })

    if updated_report:
        await manager.broadcast({
            "type": "UPDATE_REPORT",
            "data": {
                "id": updated_report.id,
                "status": updated_report.status,
                "severity": updated_report.severity
            }
        })

    return {
        "message": f"Status updated to {status}",
        "volunteer_id": vol.id,
        "status": status
    }
