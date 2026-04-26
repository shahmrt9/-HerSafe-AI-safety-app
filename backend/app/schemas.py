from pydantic import BaseModel, EmailStr
from typing import Optional

class RegisterRequest(BaseModel):
    name: str
    email: EmailStr
    password: str
    phone: Optional[str] = None

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"

class ContactCreate(BaseModel):
    name: str
    phone: str
    email: Optional[EmailStr] = None
    relationship: Optional[str] = None
    is_primary: bool = False

class ContactOut(ContactCreate):
    id: int
    class Config:
        from_attributes = True

class SettingsUpdate(BaseModel):
    sms_enabled: bool = True
    browser_enabled: bool = True
    auto_safety_mode: bool = True
    calm_mode_enabled: bool = True
    checkin_minutes: int = 10

class TaskCreate(BaseModel):
    title: str
    due_time: Optional[str] = None
    priority: str = "medium"

class MoodRequest(BaseModel):
    mood_score: int
    note: Optional[str] = None
    health_issue: Optional[str] = None
    other_health_issue: Optional[str] = None
    current_lat: Optional[float] = None
    current_lng: Optional[float] = None

class RouteRequest(BaseModel):
    source_name: Optional[str] = None
    destination_name: Optional[str] = None
    start_lat: Optional[float] = None
    start_lng: Optional[float] = None
    dest_lat: Optional[float] = None
    dest_lng: Optional[float] = None
    mood_note: Optional[str] = None

class TripStart(RouteRequest):
    checkin_minutes: int = 10

class LocationUpdate(BaseModel):
    lat: float
    lng: float
    accuracy: Optional[float] = None

class SOSRequest(BaseModel):
    trip_id: Optional[int] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    trigger_type: str = "button"
    message: Optional[str] = None
