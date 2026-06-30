import logging
import asyncio
import httpx
from datetime import datetime
from database import SessionLocal
import models
from websocket_manager import manager

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("gdacs")

# Map GDACS event types to DisasterLink disaster types
# EQ = Earthquake, TC = Cyclone (Tropical Cyclone), FL = Flood, VO = Volcano, DR = Drought
DISASTER_TYPE_MAP = {
    "EQ": "Earthquake",
    "TC": "Cyclone",
    "FL": "Flood",
    "VO": "Volcano",
    "DR": "Drought"
}

SEVERITY_MAP = {
    "Red": "Critical",
    "Orange": "High",
    "Green": "Low"
}
async def get_location_details(lat: float, lon: float) -> str:
    url = f"https://nominatim.openstreetmap.org/reverse?lat={lat}&lon={lon}&format=json&accept-language=en"
    headers = {"User-Agent": "DisasterLink/1.0 (contact@disasterlink.org)"}
    
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(url, headers=headers, timeout=5.0)
            if response.status_code == 200:
                data = response.json()
                address = data.get("address", {})
                
                # Check for various potential administrative divisions
                city = address.get("city") or address.get("town") or address.get("village") or address.get("suburb") or address.get("county") or address.get("city_district")
                state = address.get("state")
                
                if city and state:
                    return f"{city}, {state}"
                elif state:
                    return state
        except Exception:
            pass
    return ""


async def fetch_and_ingest_gdacs():
    url = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH"
    
    async with httpx.AsyncClient() as client:
        try:
            logger.info("Fetching real-time disaster alerts from GDACS...")
            response = await client.get(url, timeout=15.0)
            if response.status_code != 200:
                logger.error(f"GDACS API returned status code {response.status_code}")
                return
            
            data = response.json()
            features = data.get("features", [])
            
            db = SessionLocal()
            try:
                new_reports_added = 0
                for feature in features:
                    properties = feature.get("properties", {})
                    geometry = feature.get("geometry", {})
                    coords = geometry.get("coordinates", [])
                    
                    if not coords or len(coords) < 2:
                        continue
                        
                    event_id = properties.get("eventid")
                    alert_level = properties.get("alertlevel")
                    
                    # Filter for Orange and Red alerts only (as per approved implementation plan)
                    if alert_level not in ["Orange", "Red"]:
                        continue
                        
                    # Check if already exists using the reporter_phone as GDACS unique ID
                    gdacs_uid = f"GDACS-{event_id}"
                    existing = db.query(models.DisasterReport).filter(
                        models.DisasterReport.reporter_phone == gdacs_uid
                    ).first()
                    
                    if existing:
                        continue
                        
                    event_type = properties.get("eventtype")
                    disaster_type = DISASTER_TYPE_MAP.get(event_type, "Other")
                    severity = SEVERITY_MAP.get(alert_level, "High")
                    
                    lng, lat = coords[0], coords[1]
                    
                    # Filter strictly for India (must fall within coordinate bounding box AND mention India)
                    name = properties.get("name", "Unknown disaster")
                    description = properties.get("description", "")
                    
                    name_lower = name.lower()
                    desc_lower = description.lower()
                    is_india = "india" in name_lower or "india" in desc_lower
                    
                    if not is_india or not (6.5 <= lat <= 38.5 and 68.0 <= lng <= 98.5):
                        continue
                        
                    # Perform reverse geocoding to retrieve detailed city/state
                    loc_details = await get_location_details(lat, lng)
                    if loc_details:
                        description = f"{disaster_type} in {loc_details}, India"
                    else:
                        if not description:
                            description = name
                        else:
                            description = description
                        
                    new_report = models.DisasterReport(
                        disaster_type=disaster_type,
                        description=description,
                        latitude=lat,
                        longitude=lng,
                        severity=severity,
                        status="Open",
                        confidence_level="HIGH",  # GDACS is an official, highly reliable system
                        reporter_name="GDACS System",
                        reporter_phone=gdacs_uid
                    )
                    
                    db.add(new_report)
                    db.commit()
                    db.refresh(new_report)
                    
                    new_reports_added += 1
                    
                    # Prepare WebSocket payload
                    report_data = {
                        "id": new_report.id,
                        "disaster_type": new_report.disaster_type,
                        "description": new_report.description,
                        "latitude": new_report.latitude,
                        "longitude": new_report.longitude,
                        "severity": new_report.severity,
                        "status": new_report.status,
                        "confidence_level": new_report.confidence_level,
                        "cluster_id": new_report.cluster_id,
                        "timestamp": new_report.timestamp.isoformat() if new_report.timestamp else datetime.now().isoformat()
                    }
                    
                    # Broadcast to WebSockets
                    await manager.broadcast({
                        "type": "NEW_REPORT",
                        "data": report_data
                    })
                    
                if new_reports_added > 0:
                    logger.info(f"Ingested {new_reports_added} new GDACS events successfully.")
            except Exception as e:
                db.rollback()
                logger.error(f"Error occurred during GDACS DB processing: {e}")
            finally:
                db.close()
                
        except Exception as e:
            logger.error(f"Failed to communicate with GDACS: {e}")

async def start_gdacs_polling():
    """Continuous loop running in background to poll GDACS every 5 minutes."""
    logger.info("Initializing GDACS Automated Disaster Poller...")
    # Delay initial fetch slightly to let server start up completely
    await asyncio.sleep(5)
    while True:
        try:
            await fetch_and_ingest_gdacs()
        except Exception as e:
            logger.error(f"GDACS Polling encountered an error: {e}")
        await asyncio.sleep(300)  # 5 minutes
