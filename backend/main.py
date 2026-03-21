from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest
import json

from database import engine, Base, SessionLocal
import models
from routers import alerts, camps, disaster, volunteers, resources, stats, admin, auth, weather, chat
from websocket_manager import manager
import bcrypt
import os
from fastapi.staticfiles import StaticFiles

# Create all database tables on startup
Base.metadata.create_all(bind=engine)

def create_default_admin():
    db = SessionLocal()
    admin_user = db.query(models.User).filter(models.User.role == "admin").first()
    if not admin_user:
        hashed = bcrypt.hashpw("admin123".encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        new_admin = models.User(
            username="admin", 
            hashed_password=hashed,
            role="admin", 
            name="Administrator"
        )
        db.add(new_admin)
        db.commit()
    db.close()

create_default_admin()

app = FastAPI(
    title="Smart Disaster Coordination Platform",
    description="API for managing disaster reports, alerts, relief camps, volunteers, and resources.",
    version="2.0.0",
)

# ── CORS Middleware ───────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(auth.router)
app.include_router(disaster.router)
app.include_router(alerts.router)
app.include_router(camps.router)
app.include_router(volunteers.router)
app.include_router(resources.router)
app.include_router(stats.router)
app.include_router(admin.router)
app.include_router(weather.router)
app.include_router(chat.router)


@app.get("/", tags=["Health"])
def root():
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/frontend/index.html")

# Mount Static Files (Frontend)
frontend_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")
if os.path.exists(frontend_path):
    app.mount("/frontend", StaticFiles(directory=frontend_path), name="frontend")

# Middleware to prevent HTML caching — ensures browsers always load the latest page
class NoCacheHTMLMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: StarletteRequest, call_next):
        response = await call_next(request)
        path = request.url.path
        # Apply no-cache headers to HTML pages only
        if path.endswith('.html') or path == '/' or '/frontend/' in path:
            response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
            response.headers['Pragma'] = 'no-cache'
            response.headers['Expires'] = '0'
        return response

app.add_middleware(NoCacheHTMLMiddleware)


# ── WebSockets ────────────────────────────────────────────────────────────────
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # We don't expect much incoming data from the dashboard client,
            # but we need to keep the connection open and listen for disconnects
            data = await websocket.receive_text()
            # Could handle incoming messages here if needed
    except WebSocketDisconnect:
        manager.disconnect(websocket)
