from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

import models
import schemas
from database import get_db
from websocket_manager import manager

router = APIRouter(prefix="/alerts", tags=["Alerts"])


@router.post("/", response_model=schemas.AlertResponse, status_code=201)
async def create_alert(alert: schemas.AlertCreate, db: Session = Depends(get_db)):
    """Create a new disaster alert."""
    db_alert = models.Alert(
        message=alert.message,
        location=alert.location,
        severity=alert.severity,
    )
    db.add(db_alert)
    db.commit()
    db.refresh(db_alert)

    # Broadcast new alert
    await manager.broadcast({
        "type": "NEW_ALERT",
        "data": {
            "id": db_alert.id,
            "message": db_alert.message,
            "location": db_alert.location,
            "severity": db_alert.severity,
            "timestamp": db_alert.timestamp.isoformat() if db_alert.timestamp else None
        }
    })

    return db_alert


@router.get("/", response_model=List[schemas.AlertResponse])
def get_alerts(db: Session = Depends(get_db)):
    """Retrieve all disaster alerts."""
    return db.query(models.Alert).order_by(models.Alert.timestamp.desc()).all()


@router.delete("/{alert_id}", status_code=204)
async def delete_alert(alert_id: int, db: Session = Depends(get_db)):
    """Delete a disaster alert."""
    alert = db.query(models.Alert).filter(models.Alert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    db.delete(alert)
    db.commit()

    # Broadcast deletion
    await manager.broadcast({
        "type": "DELETE_ALERT",
        "data": {"id": alert_id}
    })
