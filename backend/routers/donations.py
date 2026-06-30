from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import SessionLocal
import models
import schemas
from websocket_manager import manager

router = APIRouter(prefix="/donations", tags=["Donations"])

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@router.post("/", response_model=schemas.DonationResponse, status_code=201)
async def create_donation(donation: schemas.DonationCreate, db: Session = Depends(get_db)):
    db_donation = models.Donation(**donation.dict())
    db.add(db_donation)
    db.commit()
    db.refresh(db_donation)
    
    # Broadcast to websocket so admin panel updates in real-time
    await manager.broadcast({
        "type": "NEW_DONATION",
        "data": {
            "id": db_donation.id,
            "donor_name": db_donation.donor_name,
            "donor_phone": db_donation.donor_phone,
            "donation_type": db_donation.donation_type,
            "quantity": db_donation.quantity,
            "item_details": db_donation.item_details,
            "status": db_donation.status,
            "timestamp": db_donation.timestamp.isoformat() if db_donation.timestamp else None
        }
    })
    return db_donation

@router.get("/", response_model=list[schemas.DonationResponse])
def get_donations(db: Session = Depends(get_db)):
    return db.query(models.Donation).order_by(models.Donation.timestamp.desc()).all()

@router.patch("/{donation_id}", response_model=schemas.DonationResponse)
async def update_donation_status(donation_id: int, update: schemas.DonationUpdate, db: Session = Depends(get_db)):
    db_donation = db.query(models.Donation).filter(models.Donation.id == donation_id).first()
    if not db_donation:
        raise HTTPException(status_code=404, detail="Donation not found")
    
    db_donation.status = update.status
    db.commit()
    db.refresh(db_donation)
    
    # Broadcast updated donation state
    await manager.broadcast({
        "type": "UPDATE_DONATION",
        "data": {
            "id": db_donation.id,
            "status": db_donation.status
        }
    })
    return db_donation
