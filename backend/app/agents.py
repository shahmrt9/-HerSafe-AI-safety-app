from datetime import datetime
from math import radians, sin, cos, asin, sqrt

STRESS_WORDS = {"anxious", "panic", "scared", "unsafe", "stressed", "alone", "following", "afraid", "fear", "help"}
RISKY_PLACE_WORDS = {"dark", "isolated", "unknown", "highway", "empty", "late", "lonely"}

def haversine_km(lat1, lon1, lat2, lon2):
    if None in [lat1, lon1, lat2, lon2]:
        return 0.0
    lon1, lat1, lon2, lat2 = map(radians, [lon1, lat1, lon2, lat2])
    dlon = lon2 - lon1
    dlat = lat2 - lat1
    a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    c = 2 * asin(sqrt(a))
    return 6371 * c

def analyze_stress(note: str | None, mood_score: int | None = None, health_issue: str | None = None) -> dict:
    text = (note or "").lower()
    health = (health_issue or "").lower()

    hits = sum(1 for word in STRESS_WORDS if word in text)

    score = 20 + hits * 25

    if mood_score is not None:
        if mood_score <= 2:
            score += 35
        elif mood_score == 3:
            score += 15

    # Women health / wellness signals
    if health in ["anxiety", "panic"]:
        score += 35
    elif health in ["fatigue"]:
        score += 15
    elif health in ["period_cramps", "pcos"]:
        score += 12
    elif health in ["headache", "back_pain"]:
        score += 10

    # Free-text health issue detection
    if "panic" in text:
        score += 35
    if "anxiety" in text:
        score += 30
    if "dizzy" in text or "weak" in text:
        score += 15
    if "pain" in text or "cramp" in text:
        score += 10

    score = min(score, 100)

    if score >= 75:
        level = "high"
    elif score >= 45:
        level = "medium"
    else:
        level = "low"

    return {
        "stress_score": score,
        "stress_level": level,
        "calm_mode": level in ["medium", "high"],
        "calm_plan": calm_plan(level),
    }

def calm_plan(level: str) -> list[dict]:
    base = [
        {"type": "breathing", "title": "4-4-6 breathing", "detail": "Inhale 4 sec, hold 4 sec, exhale 6 sec. Repeat for 1 minute."},
        {"type": "hydration", "title": "Hydrate", "detail": "Drink water and sit/stand in a well-lit place."},
        {"type": "stretch", "title": "Quick shoulder release", "detail": "Roll shoulders slowly 5 times and relax your jaw."},
        {"type": "music", "title": "Calm audio", "detail": "Play a soft calming tone or your saved calming playlist."},
    ]
    if level == "high":
        base.insert(0, {"type": "safety", "title": "Enable Safety Mode", "detail": "Start live tracking and keep SOS ready."})
    return base

def route_risk(req) -> dict:
    hour = datetime.now().hour
    text = f"{getattr(req, 'source_name', '') or ''} {getattr(req, 'destination_name', '') or ''} {getattr(req, 'mood_note', '') or ''}".lower()
    distance = haversine_km(getattr(req, 'start_lat', None), getattr(req, 'start_lng', None), getattr(req, 'dest_lat', None), getattr(req, 'dest_lng', None))
    risk = 25
    reasons = []
    if hour >= 21 or hour <= 5:
        risk += 30
        reasons.append("Late-night travel window")
    if distance > 8:
        risk += 15
        reasons.append("Longer distance")
    if any(word in text for word in RISKY_PLACE_WORDS):
        risk += 20
        reasons.append("Destination/source text contains possible risk signal")
    stress = analyze_stress(getattr(req, 'mood_note', None))
    if stress["stress_level"] in ["medium", "high"]:
        risk += 15
        reasons.append("User stress signal detected")
    risk = min(risk, 100)
    label = "High" if risk >= 70 else "Medium" if risk >= 45 else "Low"
    safer_tips = [
        "Share trip with trusted contacts",
        "Prefer main roads and well-lit areas",
        "Keep phone battery and data on",
    ]
    if label == "High":
        safer_tips.append("Start live tracking before leaving")
        safer_tips.append("Avoid isolated stretches or wait for safer travel option")
    return {"risk_score": risk, "risk_label": label, "reasons": reasons or ["No strong risk signal"], "safer_tips": safer_tips, "distance_km": round(distance, 2)}

def productivity_suggestions(tasks: list) -> list[str]:
    pending = [t for t in tasks if getattr(t, "status", "pending") == "pending"]
    suggestions = []
    if len(pending) >= 4:
        suggestions.append("You have a high workload. Move non-urgent tasks to tomorrow.")
    late_tasks = [t for t in pending if t.due_time and any(x in t.due_time.lower() for x in ["pm", "21", "22", "23"])]
    if late_tasks:
        suggestions.append("Late task detected. Plan commute earlier and enable Safety Mode.")
    if not suggestions:
        suggestions.append("Task load looks manageable. Keep a check-in reminder for travel.")
    return suggestions
