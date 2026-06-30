from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.orm import Session
from database import get_db
import models
import schemas
from websocket_manager import manager

router = APIRouter(prefix="/chat", tags=["Live Chat"])


def extract_user_from_token(authorization: str = Header(...), db: Session = Depends(get_db)):
    if not authorization or "Bearer" not in authorization:
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    token = authorization.split(" ")[1]
    # Simple token scheme from auth.py:
    # Admin: dl-admin-token-{username}
    # Volunteer: dl-vol-{username}-token
    
    if token.startswith("dl-admin-token-"):
        username = token.replace("dl-admin-token-", "")
        role = "admin"
    elif token.startswith("dl-vol-") and token.endswith("-token"):
        username = token.replace("dl-vol-", "").replace("-token", "")
        role = "volunteer"
    else:
        raise HTTPException(status_code=401, detail="Invalid token")

    user = db.query(models.User).filter(models.User.username == username, models.User.role == role).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
        
    return user


@router.get("/", response_model=list[schemas.ChatMessageResponse])
def get_messages(limit: int = 50, db: Session = Depends(get_db), current_user: models.User = Depends(extract_user_from_token)):
    """Retrieve recent chat messages for the live feed."""
    messages = db.query(models.ChatMessage).order_by(models.ChatMessage.timestamp.desc()).limit(limit).all()
    # Return in chronological order
    return messages[::-1]


@router.post("/", response_model=schemas.ChatMessageResponse)
async def post_message(
    chat_in: schemas.ChatMessageCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(extract_user_from_token)
):
    """Post a new message to the live chat."""
    
    # Use real name if available, fallback to username
    sender_name = current_user.name if current_user.name else current_user.username

    # For volunteers, try to grab their latest GPS from the volunteer model if not provided
    lat, lon = chat_in.latitude, chat_in.longitude
    if current_user.role == "volunteer" and (lat is None or lon is None):
        vol = db.query(models.Volunteer).filter(models.Volunteer.username == current_user.username).first()
        if vol:
            lat = lat or vol.latitude
            lon = lon or vol.longitude

    msg = models.ChatMessage(
        sender_id=current_user.id,
        sender_name=sender_name,
        sender_role=current_user.role,
        message=chat_in.message,
        latitude=lat,
        longitude=lon,
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)

    # Broadcast to all connected clients
    await manager.broadcast({
        "type": "NEW_CHAT",
        "data": {
            "id": msg.id,
            "sender_id": msg.sender_id,
            "sender_name": msg.sender_name,
            "sender_role": msg.sender_role,
            "message": msg.message,
            "latitude": msg.latitude,
            "longitude": msg.longitude,
            "timestamp": msg.timestamp.isoformat()
        }
    })

    return msg
