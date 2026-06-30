# DisasterLink

DisasterLink is a full-stack, real-time emergency response and disaster coordination platform. The system connects emergency command centers, field volunteers, and citizens in a unified, responsive interface to optimize disaster mapping, resource tracking, and volunteer deployment.

## Features

### Command Center (Admin Dashboard)
*   **Geospatial Tracking:** Real-time Leaflet.js interactive map plotting active incidents and volunteers, including a 5km danger zone visualization.
*   **Automated GDACS Polling:** Background polling service that automatically ingests natural hazard alerts within India from the Global Disaster Alert and Coordination System (GDACS).
*   **Geocoding Integration:** Reverse geocodes coordinates to descriptive locations (e.g. `City, State, India`) via the Nominatim OpenStreetMap API.
*   **Real-time Analytics:** Visual breakdown of incidents by type, severity, status, and volunteer skill metrics powered by Chart.js.
*   **Tactical Incident Clustering:** Automatically groups incidents within ~500 meters of each other to optimize responder dispatching.
*   **Inventory Management:** Tracks relief camp supply levels (Food, Water, Medicine, etc.) with automated alerts for low inventory.
*   **Donation System:** Real-time log of citizen donations (Money, Food, Supplies, Medicine) allowing administrators to track and mark items as received.

### Volunteer Portal
*   **Proximity-Based Dispatching:** Automatically identifies and alerts the nearest available volunteers matching required skills (Rescue, Medical, Logistics, etc.) using the Haversine formula.
*   **Live Field Chat:** Real-time WebSocket connection between dispatchers and field volunteers with support for username tagging.
*   **Status Progression:** Step-by-step responder workflow tracking ("En Route" -> "Reached Scene" -> "Completed").

### Public Landing Page
*   **One-Click SOS:** Immediate high-priority GPS location-based alert submission directly to the Command Center.
*   **Public Hazard Map:** Citizen interface displaying ongoing incident danger zones to avoid.
*   **Relief Donations:** Simple portal for public users to register funds or relief supplies.

---

## Project Structure

```text
DisasterLink/
├── backend/
│   ├── main.py                  # FastAPI application entry point
│   ├── database.py              # SQLAlchemy database connection setup
│   ├── models.py                # Database models (SQLite tables)
│   ├── schemas.py               # Pydantic schemas for request/response validation
│   ├── gdacs_integration.py     # Background worker for automated GDACS ingestion
│   ├── websocket_manager.py     # Connection manager for real-time WebSocket events
│   └── routers/                 # Modular API routers
│       ├── auth.py, admin.py, disaster.py, volunteers.py,
│       ├── camps.py, resources.py, weather.py, chat.py, donations.py
└── frontend/
    ├── index.html               # Public landing page and SOS reporting form
    ├── admin.html               # Command Center Administration Dashboard
    ├── volunteer.html           # Volunteer assignment and chat portal
    ├── style.css                # Custom UI styling (Glassmorphism & Dark Mode)
    └── script.js                # Core API fetching, Leaflet Map, Charts, WebSockets
```

---

## Getting Started

### Prerequisites
*   Python 3.10 or higher
*   Git

### Clone the Repository
Clone the project repository to your local machine:
```bash
git clone https://github.com/your-username/DisasterLink.git
cd DisasterLink
```

### Backend Setup
1.  Navigate to the `backend` directory:
    ```bash
    cd backend
    ```
2.  Create and activate a virtual environment:
    ```bash
    # Windows:
    python -m venv venv
    .\venv\Scripts\activate

    # macOS/Linux:
    python3 -m venv venv
    source venv/bin/activate
    ```
3.  Install the required dependencies:
    ```bash
    pip install fastapi uvicorn sqlalchemy httpx requests bcrypt
    ```
4.  Start the development server:
    ```bash
    python -m uvicorn main:app --reload --reload-exclude "*.db"
    ```
    *The API interactive documentation will be available at `http://127.0.0.1:8000/docs`.*

### Frontend Setup
1.  Serve the `frontend/` directory using a local web server (e.g. the **Live Server** extension in VS Code).
2.  Open your browser and navigate to the local address (typically `http://127.0.0.1:5500/frontend/index.html`).
