import os
from datetime import datetime
from pathlib import Path
from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from dotenv import load_dotenv

from pydantic import BaseModel
from typing import Optional

from app.database import Base, engine, get_db, SessionLocal
from app.models import User, TrustedContact, NotificationSettings, Task, MoodLog, Trip, LocationPing, EmergencyEvent
from app.schemas import RegisterRequest, LoginRequest, ContactCreate, SettingsUpdate, TaskCreate, MoodRequest, RouteRequest, TripStart, LocationUpdate, SOSRequest
from app.auth import hash_password, verify_password, create_access_token, get_current_user
from app.agents import analyze_stress, route_risk, productivity_suggestions
from app.notifications import send_sos_sms
from app.realtime import manager

load_dotenv()
Base.metadata.create_all(bind=engine)

app = FastAPI(title="HerSafe+ Live MVP", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")

@app.get("/")
def home():
    return FileResponse(FRONTEND_DIR / "index.html")

@app.post("/api/auth/register")
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == req.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user = User(name=req.name, email=req.email, phone=req.phone, hashed_password=hash_password(req.password))
    db.add(user)
    db.flush()
    db.add(NotificationSettings(user_id=user.id))
    db.commit()
    token = create_access_token({"sub": str(user.id)})
    return {"access_token": token, "token_type": "bearer", "user": {"id": user.id, "name": user.name, "email": user.email}}

@app.post("/api/auth/login")
def login(req: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == req.email).first()
    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token({"sub": str(user.id)})
    return {"access_token": token, "token_type": "bearer", "user": {"id": user.id, "name": user.name, "email": user.email}}

@app.get("/api/me")
def me(user: User = Depends(get_current_user)):
    return {"id": user.id, "name": user.name, "email": user.email, "phone": user.phone}

@app.post("/api/contacts")
def add_contact(req: ContactCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    contact = TrustedContact(user_id=user.id, **req.model_dump())
    db.add(contact)
    db.commit()
    db.refresh(contact)
    return contact

@app.get("/api/contacts")
def list_contacts(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return db.query(TrustedContact).filter(TrustedContact.user_id == user.id).order_by(TrustedContact.is_primary.desc(), TrustedContact.id.desc()).all()

@app.delete("/api/contacts/{contact_id}")
def delete_contact(contact_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    contact = db.query(TrustedContact).filter(TrustedContact.id == contact_id, TrustedContact.user_id == user.id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    db.delete(contact)
    db.commit()
    return {"ok": True}

@app.get("/api/settings")
def get_settings(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    settings = db.query(NotificationSettings).filter(NotificationSettings.user_id == user.id).first()
    if not settings:
        settings = NotificationSettings(user_id=user.id)
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings

@app.put("/api/settings")
def update_settings(req: SettingsUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    settings = db.query(NotificationSettings).filter(NotificationSettings.user_id == user.id).first()
    if not settings:
        settings = NotificationSettings(user_id=user.id)
        db.add(settings)
    for key, value in req.model_dump().items():
        setattr(settings, key, value)
    db.commit()
    db.refresh(settings)
    return settings

@app.post("/api/tasks")
def create_task(req: TaskCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    task = Task(user_id=user.id, **req.model_dump())
    db.add(task)
    db.commit()
    db.refresh(task)
    return task

@app.get("/api/tasks")
def tasks(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    user_tasks = db.query(Task).filter(Task.user_id == user.id).order_by(Task.id.desc()).all()
    return {"tasks": user_tasks, "suggestions": productivity_suggestions(user_tasks)}

# UPDATE TASK
class TaskUpdate(BaseModel):
    title: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None

@app.put("/api/tasks/{task_id}")
def update_task(
    task_id: int,
    req: TaskUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    task = db.query(Task).filter(Task.id == task_id, Task.user_id == user.id).first()

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    data = req.model_dump(exclude_unset=True)

    for key, value in data.items():
        setattr(task, key, value)

    db.commit()
    db.refresh(task)

    return task

# DELETE TASK
@app.delete("/api/tasks/{task_id}")
def delete_task(task_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    task = db.query(Task).filter(Task.id == task_id, Task.user_id == user.id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    db.delete(task)
    db.commit()
    return {"ok": True}

@app.post("/api/mood/analyze")
def mood_analyze(req: MoodRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    result = analyze_stress(req.note, req.mood_score, getattr(req, "health_issue", None))
    log = MoodLog(user_id=user.id, mood_score=req.mood_score, note=req.note, stress_level=result["stress_level"])
    db.add(log)
    db.commit()
    return result

@app.post("/api/route/score")
def route_score(req: RouteRequest, user: User = Depends(get_current_user)):
    return route_risk(req)

@app.post("/api/trips/start")
def start_trip(req: TripStart, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    risk = route_risk(req)
    trip = Trip(
        user_id=user.id,
        source_name=req.source_name,
        destination_name=req.destination_name,
        start_lat=req.start_lat,
        start_lng=req.start_lng,
        dest_lat=req.dest_lat,
        dest_lng=req.dest_lng,
        checkin_minutes=req.checkin_minutes,
        risk_score=risk["risk_score"],
    )
    db.add(trip)
    db.commit()
    db.refresh(trip)
    return {"trip": {"id": trip.id, "status": trip.status, "risk_score": trip.risk_score}, "risk": risk}

@app.post("/api/trips/{trip_id}/location")
async def update_location(trip_id: int, req: LocationUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    trip = db.query(Trip).filter(Trip.id == trip_id, Trip.user_id == user.id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    ping = LocationPing(trip_id=trip_id, user_id=user.id, lat=req.lat, lng=req.lng, accuracy=req.accuracy)
    db.add(ping)
    db.commit()
    payload = {"type": "location", "trip_id": trip_id, "lat": req.lat, "lng": req.lng, "accuracy": req.accuracy, "time": datetime.utcnow().isoformat()}
    await manager.broadcast(trip_id, payload)
    return payload

@app.get("/api/trips/{trip_id}/latest")
def latest_location(trip_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    trip = db.query(Trip).filter(Trip.id == trip_id, Trip.user_id == user.id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    ping = db.query(LocationPing).filter(LocationPing.trip_id == trip_id).order_by(LocationPing.id.desc()).first()
    return {"trip": trip, "latest": ping}

@app.post("/api/trips/{trip_id}/end")
def end_trip(trip_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    trip = db.query(Trip).filter(Trip.id == trip_id, Trip.user_id == user.id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    trip.status = "ended"
    trip.ended_at = datetime.utcnow()
    db.commit()
    return {"ok": True, "status": "ended"}

@app.post("/api/sos/trigger")
async def trigger_sos(req: SOSRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    settings = db.query(NotificationSettings).filter(NotificationSettings.user_id == user.id).first()
    contacts = db.query(TrustedContact).filter(TrustedContact.user_id == user.id).all()
    event = EmergencyEvent(user_id=user.id, trip_id=req.trip_id, trigger_type=req.trigger_type, lat=req.lat, lng=req.lng, message=req.message)
    db.add(event)
    db.commit()
    db.refresh(event)
    sms_result = {"status": "disabled", "sent": 0}
    if settings is None or settings.sms_enabled:
        sms_result = send_sos_sms(contacts, user, event, req.lat, req.lng, req.trip_id)
        event.sms_status = sms_result["status"]
        db.commit()
    payload = {"type": "sos", "event_id": event.id, "lat": req.lat, "lng": req.lng, "message": req.message, "sms": sms_result}
    if req.trip_id:
        await manager.broadcast(req.trip_id, payload)
    return {"event_id": event.id, "contacts_notified": sms_result.get("sent", 0), "sms": sms_result, "contacts_count": len(contacts)}

@app.websocket("/ws/trips/{trip_id}")
async def trip_websocket(websocket: WebSocket, trip_id: int):
    await manager.connect(trip_id, websocket)
    try:
        while True:
            data = await websocket.receive_json()
            await manager.broadcast(trip_id, data)
    except WebSocketDisconnect:
        manager.disconnect(trip_id, websocket)

@app.get("/api/health")
def health():
    return {"status": "ok"}
