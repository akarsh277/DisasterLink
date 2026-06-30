from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import bcrypt

import models
import schemas
from database import get_db
from websocket_manager import manager

router = APIRouter(prefix="/auth", tags=["Authentication"])

# Hardcoded credentials eliminated in favor of complete database-backed auth.

def hash_password(password: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode('utf-8'), hashed.encode('utf-8'))
    except Exception:
        return False


# ── Register Volunteer ───────────────────────────────────────────────────────
@router.post("/register", status_code=201)
def register_volunteer(data: schemas.UserCreate, db: Session = Depends(get_db)):
    """Register a new volunteer account with hashed password (min 6 chars)."""
    # Check username taken
    existing = db.query(models.User).filter(models.User.username == data.username).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username already taken")
        
    # Check phone number taken
    if data.phone:
        existing_phone = db.query(models.Volunteer).filter(models.Volunteer.phone == data.phone).first()
        if existing_phone:
            raise HTTPException(status_code=400, detail="Volunteer already exists. Please login.")

    # Create user record
    user = models.User(
        username=data.username,
        hashed_password=hash_password(data.password),
        role="volunteer",
        name=data.name or data.username,
    )
    db.add(user)
    db.flush()  # get user.id before commit

    volunteer = models.Volunteer(
        name=data.name or data.username,
        phone=data.phone,
        skill=data.skill or "Other",
        username=data.username,
        latitude=data.latitude,
        longitude=data.longitude,
    )
    db.add(volunteer)
    db.commit()

    return {"message": "Volunteer registered successfully. Please log in."}


# ── Login (Admin + Volunteer) ────────────────────────────────────────────────
@router.post("/login", response_model=schemas.UserLoginResponse)
def login(credentials: schemas.UserLogin, db: Session = Depends(get_db)):
    """Unified login for admin and volunteers."""

    role = (credentials.role or "volunteer").lower()

    # ── Admin login ──────────────────────────────────────────────────────────
    if role == "admin":
        user = db.query(models.User).filter(
            models.User.username == credentials.username,
            models.User.role == "admin"
        ).first()

        if not user or not verify_password(credentials.password, user.hashed_password):
            raise HTTPException(status_code=401, detail="Invalid admin credentials")

        return schemas.UserLoginResponse(
            token=f"dl-admin-token-{user.username}",
            role="admin",
            username=user.username,
            name=user.name,
            volunteer_id=None,
            message="Admin login successful",
        )

    # ── Volunteer login ──────────────────────────────────────────────────────
    user = db.query(models.User).filter(
        models.User.username == credentials.username,
        models.User.role == "volunteer"
    ).first()

    if not user or not verify_password(credentials.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid volunteer credentials")

    # Find matching volunteer record
    vol = db.query(models.Volunteer).filter(
        models.Volunteer.username == credentials.username
    ).first()

    # Simple token: prefix + username (demo-grade)
    token = f"dl-vol-{credentials.username}-token"

    return schemas.UserLoginResponse(
        token=token,
        role="volunteer",
        username=user.username,
        name=user.name,
        volunteer_id=vol.id if vol else None,
        message="Volunteer login successful",
    )
