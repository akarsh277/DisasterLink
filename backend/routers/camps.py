from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from backend import models
from backend import schemas
from backend.database import get_db

router = APIRouter(prefix="/camps", tags=["Relief Camps"])


@router.post("/", response_model=schemas.CampResponse, status_code=201)
def create_camp(camp: schemas.CampCreate, db: Session = Depends(get_db)):
    """Register a new relief camp."""
    db_camp = models.ReliefCamp(
        camp_name=camp.camp_name,
        location=camp.location,
        capacity=camp.capacity,
        occupancy=camp.occupancy,
    )
    db.add(db_camp)
    db.commit()
    db.refresh(db_camp)
    return db_camp


@router.get("/", response_model=List[schemas.CampResponse])
def get_camps(db: Session = Depends(get_db)):
    """Retrieve all registered relief camps."""
    return db.query(models.ReliefCamp).all()


@router.patch("/{camp_id}", response_model=schemas.CampResponse)
def update_camp(camp_id: int, update: schemas.CampUpdate, db: Session = Depends(get_db)):
    """Update a relief camp's occupancy."""
    camp = db.query(models.ReliefCamp).filter(models.ReliefCamp.id == camp_id).first()
    if not camp:
        raise HTTPException(status_code=404, detail="Camp not found")
    if update.occupancy is not None:
        camp.occupancy = update.occupancy
    db.commit()
    db.refresh(camp)
    return camp


@router.delete("/{camp_id}", status_code=204)
def delete_camp(camp_id: int, db: Session = Depends(get_db)):
    """Delete a relief camp."""
    camp = db.query(models.ReliefCamp).filter(models.ReliefCamp.id == camp_id).first()
    if not camp:
        raise HTTPException(status_code=404, detail="Camp not found")
        
    # Cascade delete orphaned supplies
    db.query(models.Supply).filter(models.Supply.camp_id == camp_id).delete()
    
    db.delete(camp)
    db.commit()
