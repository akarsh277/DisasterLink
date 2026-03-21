from pydantic import BaseModel, field_validator
from typing import Optional
from datetime import datetime


# ── Disaster Report Schemas ──────────────────────────────────────────────────

class DisasterReportCreate(BaseModel):
    disaster_type: str
    description: Optional[str] = None
    latitude: float
    longitude: float
    image_url: Optional[str] = None
    severity: Optional[str] = "Medium"      # Low / Medium / High / Critical
    reporter_name: Optional[str] = None
    reporter_phone: Optional[str] = None


class SOSCreate(BaseModel):
    latitude: float
    longitude: float
    reporter_name: Optional[str] = None
    reporter_phone: Optional[str] = None


class DisasterReportUpdate(BaseModel):
    status: Optional[str] = None            # Open / In Progress / Resolved
    severity: Optional[str] = None


class DisasterReportResponse(BaseModel):
    id: int
    disaster_type: str
    description: Optional[str]
    latitude: float
    longitude: float
    image_url: Optional[str]
    severity: str
    status: str
    confidence_level: Optional[str] = "LOW"
    cluster_id: Optional[int] = None
    reporter_name: Optional[str]
    timestamp: datetime

    class Config:
        from_attributes = True


# ── Alert Schemas ─────────────────────────────────────────────────────────────

class AlertCreate(BaseModel):
    message: str
    location: str
    severity: str


class AlertResponse(BaseModel):
    id: int
    message: str
    location: str
    severity: str
    timestamp: datetime

    class Config:
        from_attributes = True


# ── Relief Camp Schemas ───────────────────────────────────────────────────────

class CampCreate(BaseModel):
    camp_name: str
    location: str
    capacity: int
    occupancy: Optional[int] = 0


class CampUpdate(BaseModel):
    occupancy: Optional[int] = None


class CampResponse(BaseModel):
    id: int
    camp_name: str
    location: str
    capacity: int
    occupancy: int

    class Config:
        from_attributes = True


# ── Resource Schemas ──────────────────────────────────────────────────────────

class ResourceCreate(BaseModel):
    resource_type: str
    quantity: int
    camp_id: int


class ResourceResponse(ResourceCreate):
    id: int

    class Config:
        from_attributes = True


class CriticalSupplyAlert(BaseModel):
    camp_id: int
    camp_name: str
    resource_type: str
    quantity: int
    occupancy: int
    message: str


# ── Volunteer Schemas ─────────────────────────────────────────────────────────

class VolunteerCreate(BaseModel):
    name: str
    phone: Optional[str] = None
    skill: str                              # Medical / Rescue / Logistics / Communication / Other
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class VolunteerAssign(BaseModel):
    assigned_report_id: Optional[int] = None


class VolunteerStatusUpdate(BaseModel):
    volunteer_id: int
    status: str                             # EN_ROUTE / REACHED / COMPLETED
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class VolunteerResponse(BaseModel):
    id: int
    name: str
    phone: Optional[str]
    skill: str
    assigned_report_id: Optional[int]
    volunteer_status: Optional[str] = "ASSIGNED"
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    username: Optional[str] = None
    registered_at: datetime

    class Config:
        from_attributes = True


# ── Chat Schemas ──────────────────────────────────────────────────────────────

class ChatMessageCreate(BaseModel):
    message: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class ChatMessageResponse(BaseModel):
    id: int
    sender_id: int
    sender_name: str
    sender_role: str
    message: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    timestamp: datetime

    class Config:
        from_attributes = True



# ── Auth / User Schemas ────────────────────────────────────────────────────────

class UserCreate(BaseModel):
    username: str
    password: str
    name: Optional[str] = None
    role: Optional[str] = "volunteer"
    phone: Optional[str] = None
    skill: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None

    @field_validator('password')
    @classmethod
    def password_min_length(cls, v: str) -> str:
        if len(v) < 6:
            raise ValueError('Password must be at least 6 characters')
        return v


class UserLogin(BaseModel):
    username: str
    password: str
    role: Optional[str] = "volunteer"       # admin / volunteer


class UserLoginResponse(BaseModel):
    token: str
    role: str
    username: str
    name: Optional[str] = None
    volunteer_id: Optional[int] = None      # Set if role is volunteer
    message: str


# ── Resource Schemas ──────────────────────────────────────────────────────────

class ResourceCreate(BaseModel):
    resource_type: str                      # Food / Water / Medicine / Shelter / Equipment
    quantity: int
    camp_id: int


class ResourceResponse(BaseModel):
    id: int
    resource_type: str
    quantity: int
    camp_id: int

    class Config:
        from_attributes = True


# ── Stats Schema ──────────────────────────────────────────────────────────────

class StatsResponse(BaseModel):
    total_reports: int
    open_reports: int
    critical_reports: int
    active_camps: int
    total_volunteers: int
    total_alerts: int
