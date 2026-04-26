# HerSafe+ Live MVP

Real-world hackathon MVP for **HerSafe+**: AI-powered women safety, wellness, productivity, Smart Calm Mode, live trip tracking, trusted contacts, map-based safety, and optional real SMS SOS via Twilio.

## What is included

- Plain HTML/CSS/JavaScript frontend, no React/Next.js
- FastAPI backend
- JWT login/signup/logout
- Trusted contacts CRUD
- Notification settings
- SOS trigger with optional Twilio SMS
- Live trip tracking using browser geolocation + FastAPI WebSocket
- Leaflet/OpenStreetMap map UI
- Safe route scoring agent
- Mood/stress detection agent
- Smart Calm Mode: breathing guide, calm tone, hydration/stretch suggestions
- Task planner + productivity safety suggestions
- SQLite for local demo, PostgreSQL/Supabase ready for deployment
- Dockerfile + Render deployment config

## Important safety note

This is a hackathon MVP and demo project. Do not market it as a replacement for police/emergency services. For a production safety app, add professional security review, location privacy controls, audit logs, emergency provider integrations, and legal/compliance review.

## Local setup

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Open:

```text
http://localhost:8000
```

## How to test demo flow

1. Sign up.
2. Add at least one trusted contact with phone number in international format, for example `+91XXXXXXXXXX`.
3. Enable browser notification permission.
4. Add a task like `Leave office by 9:30 PM`.
5. Mood check-in: select stressed/anxious and type `I feel anxious travelling alone`.
6. Calm Mode opens with breathing, calm tone, hydration/stretch guidance.
7. Go to Trip Mode, allow location permission.
8. Enter destination latitude/longitude or leave blank for demo route.
9. Click `Score Route` then `Start Live Trip`.
10. Click `SOS` to notify contacts.

## Enable real SMS with Twilio

Create a Twilio account and add these values in `backend/.env`:

```env
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+1xxxxxxxxxx
PUBLIC_APP_URL=https://your-deployed-url
```

If Twilio variables are not set, SOS SMS runs in simulated mode and still returns the exact message that would be sent.

## PostgreSQL / Supabase

For PostgreSQL or Supabase Postgres, set:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DBNAME
```

If your password contains special characters like `@`, URL encode it.

## Deploy on Render

1. Push this folder to GitHub.
2. Create a Render Web Service.
3. Choose Docker deployment.
4. Use this Dockerfile path:

```text
backend/Dockerfile
```

5. Set environment variables:

```env
SECRET_KEY=your-secret
DATABASE_URL=your-postgres-url-or-sqlite-for-demo
PUBLIC_APP_URL=https://your-render-url.onrender.com
TWILIO_ACCOUNT_SID=optional
TWILIO_AUTH_TOKEN=optional
TWILIO_PHONE_NUMBER=optional
```

Render's FastAPI deployment supports Uvicorn start commands, and this project also includes Docker deployment files.

## Deploy on Google Cloud Run

From project root:

```bash
gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/hersafe-live
gcloud run deploy hersafe-live \
  --image gcr.io/YOUR_PROJECT_ID/hersafe-live \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars SECRET_KEY=your-secret,PUBLIC_APP_URL=https://your-cloud-run-url
```

For PostgreSQL/Supabase and Twilio, add environment variables in Cloud Run settings.

## Project structure

```text
hersafe_live_app/
├── backend/
│   ├── main.py
│   ├── requirements.txt
│   ├── Dockerfile
│   └── app/
│       ├── agents.py
│       ├── auth.py
│       ├── database.py
│       ├── models.py
│       ├── notifications.py
│       ├── realtime.py
│       └── schemas.py
├── frontend/
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   └── manifest.json
├── render.yaml
└── README.md
```

## Judge talking points

- Live tracking is implemented using browser geolocation and WebSocket updates.
- SMS is production-ready when Twilio environment variables are added; otherwise it works in simulation mode for demo.
- Calm Mode is not just a label: it provides breathing, calm audio, hydration/stretch suggestions, and safety-mode activation.
- No AlloyDB is used; the app runs on SQLite locally and PostgreSQL/Supabase in production.
