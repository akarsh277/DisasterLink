from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional

from backend import models
from backend import schemas
from backend.database import get_db

router = APIRouter(prefix="/resources", tags=["Resources"])


@router.post("/", response_model=schemas.ResourceResponse, status_code=201)
def add_resource(resource: schemas.ResourceCreate, db: Session = Depends(get_db)):
    """Add a resource to a relief camp."""
    camp = db.query(models.ReliefCamp).filter(models.ReliefCamp.id == resource.camp_id).first()
    if not camp:
        raise HTTPException(status_code=404, detail="Relief camp not found")
    # Check if this camp already has this specific resource type
    existing_res = db.query(models.Resource).filter(
        models.Resource.camp_id == resource.camp_id,
        models.Resource.resource_type == resource.resource_type
    ).first()

    if existing_res:
        existing_res.quantity += resource.quantity
        db.commit()
        db.refresh(existing_res)
        return existing_res
    else:
        db_res = models.Resource(
            resource_type=resource.resource_type,
            quantity=resource.quantity,
            camp_id=resource.camp_id,
        )
        db.add(db_res)
        db.commit()
        db.refresh(db_res)
        return db_res


@router.get("/", response_model=List[schemas.ResourceResponse])
def get_resources(camp_id: Optional[int] = None, db: Session = Depends(get_db)):
    """List all resources, optionally filtered by camp_id."""
    q = db.query(models.Resource)
    if camp_id:
        q = q.filter(models.Resource.camp_id == camp_id)
    return q.all()


@router.get("/critical", response_model=List[schemas.CriticalSupplyAlert])
def get_critical_supplies(db: Session = Depends(get_db)):
    """Analyze supply vs occupancy ratios to detect critical shortages."""
    camps = db.query(models.ReliefCamp).filter(models.ReliefCamp.occupancy > 0).all()
    alerts = []
    
    # Safe Ratios (units required per person)
    thresholds = {
        "Food": 2.0,
        "Water": 3.0,
        "Medicine": 0.5
    }

    for camp in camps:
        supplies = db.query(models.Resource).filter(models.Resource.camp_id == camp.id).all()
        supply_dict = {res.resource_type: res.quantity for res in supplies}
        
        for r_type, min_ratio in thresholds.items():
            current_qty = supply_dict.get(r_type, 0)
            required_qty = camp.occupancy * min_ratio
            if current_qty < required_qty:
                alerts.append(schemas.CriticalSupplyAlert(
                    camp_id=camp.id,
                    camp_name=camp.camp_name,
                    resource_type=r_type,
                    quantity=current_qty,
                    occupancy=camp.occupancy,
                    message=f"CRITICAL SHORTAGE: {camp.camp_name} has {current_qty} {r_type} for {camp.occupancy} people! (Needs {int(required_qty)})"
                ))
    return alerts


@router.delete("/{resource_id}", status_code=204)
def delete_resource(resource_id: int, db: Session = Depends(get_db)):
    """Remove a resource entry."""
    res = db.query(models.Resource).filter(models.Resource.id == resource_id).first()
    if not res:
        raise HTTPException(status_code=404, detail="Resource not found")
    db.delete(res)
    db.commit()
