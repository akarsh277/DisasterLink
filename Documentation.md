# Smart Disaster Coordination Platform (DisasterLink)

## 📖 Overview
DisasterLink is a full-stack web application designed for comprehensive disaster management and coordination. It bridges the gap between emergency command centers, field volunteers, and the public by providing real-time data, predictive insights, and resource tracking.

## 🛠️ Tech Stack
- **Backend:** Python, FastAPI, SQLAlchemy, SQLite, Uvicorn, WebSockets
- **Frontend:** HTML5, Vanilla JavaScript, CSS3 (Custom Glassmorphism UI)
- **Maps Integration:** Leaflet.js (OpenStreetMap)
- **Data Visualization:** Chart.js (Doughnut and Bar charts)
- **Third-Party APIs:** Open-Meteo API (for real-time weather and hazard intelligence)

## ✨ Key Features

### 1. Command Center (Admin Dashboard)
- **Command Map:** Real-time geospatial mapping of all reported incidents and active volunteers. Danger zones are algorithmically drawn around severe disasters.
- **Live Incident Feed:** Track incoming SOS alerts and disaster reports in real-time.
- **Analytics Engine:** Visual breakdown of disasters by Type, Severity, Status, and available Volunteer Skills using Chart.js.
- **Disaster Clusters:** Grouping nearby incidents (within ~500m) to allow dispatchers to handle tactical multi-incident responses efficiently.
- **Alert Broadcast System:** Push critical warning messages instantly to all users via WebSockets.
- **Supply Chain Intelligence:** Track inventory (Food, Water, Medicine, etc.) across various relief camps. Low supplies trigger visual alerts on the dashboard.
- **Weather & AI Forecasts:** Integrated Open-Meteo API for real-time risk predictions based on active disaster coordinates.
- **Donation Registry:** Real-time dashboard for managing citizen donations of money, food, and supplies.
- **Automated Incident Ingestion:** Background polling service that automatically ingests natural hazard alerts from GDACS (Global Disaster Alert and Coordination System) within India, reverse geocoding them to city/state names.

### 2. Volunteer Portal
- **Real-time Assignments:** Volunteers are auto-assigned to nearby incidents based on GPS proximity and required skill sets.
- **Live Field Chat:** A WebSocket-powered chat allows command center operators and field volunteers to coordinate dynamically. Supports @tagging volunteers directly.
- **Status Updates:** One-click buttons for volunteers to report their status: "En Route", "Reached Scene", and "Completed".

### 3. Public Incident Reporting
- **Public Map:** Citizens can view active disaster zones and avoid them.
- **SOS Form:** Public users can report disasters, define the severity, and request immediate help. Geolocation is handled directly via browser APIs.
- **Relief Donations:** Public users can donate money, food, or critical items (supplies, medicine, etc.) to support relief camps.

## 🔄 Core Workflow

1. **Incident Creation:** A public user submits an SOS alert via the frontend with their exact GPS coordinates and the nature of the emergency.
2. **Command Review:** The incident immediately appears on the Admin Dashboard's live feed and geospatial map. It is logged in the `reports` database table.
3. **Clustering & Assessment:** The system automatically groups incidents occurring within ~500 meters of each other into "Tactical Clusters", reducing duplicate dispatches.
4. **Intelligent Dispatching:** An admin can dispatch a cluster or report. The system calculates the distance between the incident and all active volunteers using the Haversine formula, finding the closest free volunteers equipped with the necessary skills (e.g., Medical, Rescue).
5. **Field Execution:** The assigned volunteers receive a WebSocket push notification. They track their progress on their personal portal, updating their status ("En Route" -> "Reached Scene" -> "Completed").
6. **Resolution:** The admin monitors live chat updates from the field and officially marks the incident as "Resolved" once the volunteers complete their work.

## 📂 Project Structure

```
DisasterLink/
├── backend/
│   ├── main.py                  # FastAPI application entry point
│   ├── database.py              # SQLAlchemy engine and session management
│   ├── models.py                # Database models (SQLite tables)
│   ├── schemas.py               # Pydantic models for request/response validation
│   ├── websocket_manager.py     # Connection manager for real-time WebSocket alerts
│   ├── gdacs_integration.py     # Background poller service for automated GDACS alerts
│   └── routers/                 # Modular API endpoints
│       ├── admin.py
│       ├── alerts.py
│       ├── auth.py
│       ├── camps.py
│       ├── chat.py
│       ├── disaster.py
│       ├── donations.py
│       ├── resources.py
│       ├── stats.py
│       ├── volunteers.py
│       └── weather.py
└── frontend/
    ├── index.html               # Public facing map and report form
    ├── admin.html               # Secure Command Center Dashboard
    ├── style.css                # Custom UI styles (Glassmorphism, Dark Mode)
    └── script.js                # Core frontend logic (API fetching, Leaflet Map, Charts, WebSockets)
```

## 🔌 API Architecture & Security

The backend is built with **FastAPI** for high performance and modularity, using `APIRouter` to structure the endpoints cleanly.

### Security (Hashing & Auth)
- **Password Hashing:** The platform utilizes **`bcrypt`** for strong cryptographic hashing of all passwords. Plaintext passwords are never stored in the database.
- **Authentication Tokens:** Admin APIs are secured using Bearer tokens verified via the `/auth/` routes.

### Endpoints
- **`/auth/`**: Authentication routes handling secure login.
- **`/reports/`**: CRUD operations for disaster incidents, including clustering logic based on geospatial proximity (Haversine formula).
- **`/volunteers/`**: Volunteer registration, real-time GPS tracking, and intelligent dispatching.
- **`/chat/`**: Stores and retrieves field messages.
- **`/resources/`**: Manages relief camp inventory. Exposes `/resources/critical` for supply chain alerts.
- **`/weather/`**: Proxies requests to Open-Meteo API to generate AI forecasts.
- **`/donations/`**: CRUD endpoints for creating, retrieving, and updating the status of relief donations.
- **`/ws`**: The primary WebSocket endpoint used for pushing live broadcast alerts and chat messages instantly.