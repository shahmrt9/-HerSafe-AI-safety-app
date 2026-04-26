import os
from twilio.rest import Client

def send_sos_sms(contacts, user, event, lat=None, lng=None, trip_id=None):
    sid = os.getenv("TWILIO_ACCOUNT_SID")
    token = os.getenv("TWILIO_AUTH_TOKEN")
    from_number = os.getenv("TWILIO_PHONE_NUMBER")

    print("SID:", sid)
    print("TOKEN:", token)
    print("FROM:", from_number)

    public_app_url = os.getenv("PUBLIC_APP_URL", "http://127.0.0.1:8000")

    maps_link = f"https://www.google.com/maps?q={lat},{lng}" if lat and lng else "Location not available"
    tracking_link = f"{public_app_url}/?watchTrip={trip_id}" if trip_id else public_app_url

    body = f"SOS ALERT from {user.name}\nLocation: {maps_link}\nTracking: {tracking_link}"

    if not (sid and token and from_number):
        return {"status": "simulated", "sent": 0, "message": body}

    client = Client(sid, token)

    sent = 0
    errors = []

    for c in contacts:
        try:
            client.messages.create(body=body, from_=from_number, to=c.phone)
            sent += 1
        except Exception as e:
            print("Twilio error:", e)
            errors.append(str(e))

    return {"status": "sent" if sent else "failed", "sent": sent, "errors": errors}