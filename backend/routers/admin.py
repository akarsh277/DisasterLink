from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/admin", tags=["Admin"])

# ── Hardcoded credentials (demo / project only) ───────────────────────────────
ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "disasterlink2026"
ADMIN_TOKEN    = "dl-admin-token-2026"


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    token: str
    message: str


@router.post("/login", response_model=LoginResponse)
def admin_login(credentials: LoginRequest):
    """Validate admin credentials and return a session token."""
    if credentials.username == ADMIN_USERNAME and credentials.password == ADMIN_PASSWORD:
        return LoginResponse(token=ADMIN_TOKEN, message="Login successful")
    raise HTTPException(status_code=401, detail="Invalid username or password")
