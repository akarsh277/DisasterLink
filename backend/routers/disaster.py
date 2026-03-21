from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
import math

from backend import models
from backend import schemas
from backend.database import get_db
from backend.websocket_manager import manager

router = APIRouter(prefix="/reports", tags=["Disaster Reports"])

# ── Clustering & Confidence Helpers ──────────────────────────────────────────

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Return distance in km between two lat/lon points."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


CLUSTER_RADIUS_KM = 0.5   # 500 m


def get_nearby_reports(db: Session, lat: float, lon: float, exclude_id: int = None):
    """Return all existing reports within CLUSTER_RADIUS_KM of the given point."""
    all_reports = db.query(models.DisasterReport).all()
    nearby = []
    for r in all_reports:
        if exclude_id and r.id == exclude_id:
            continue
        if r.latitude and r.longitude:
            dist = haversine_km(lat, lon, r.latitude, r.longitude)
            if dist <= CLUSTER_RADIUS_KM:
                nearby.append(r)
    return nearby


def assign_confidence(nearby_count: int) -> str:
    if nearby_count >= 5:
        return "HIGH"
    elif nearby_count >= 2:
        return "MEDIUM"
    return "LOW"


def compute_severity_from_type(disaster_type: str, user_severity: str) -> str:
    """Auto-elevate severity based on disaster type priority: fire > flood > others."""
    dt = (disaster_type or "").lower()
    if "fire" in dt:
        # Fire always at least High
        if user_severity in ("Low", "Medium"):
            return "High"
    elif "flood" in dt or "cyclone" in dt:
        if user_severity == "Low":
            return "Medium"
    return user_severity


def find_or_create_cluster_id(db: Session, nearby: list) -> int:
    """Return existing cluster_id from nearby reports, or a new unique cluster id."""
    for r in nearby:
        if r.cluster_id is not None:
            return r.cluster_id
    # Create new cluster id = max existing + 1
    max_cluster = db.query(models.DisasterReport).filter(
        models.DisasterReport.cluster_id != None
    ).order_by(models.DisasterReport.cluster_id.desc()).first()
    return (max_cluster.cluster_id + 1) if max_cluster else 1


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/", response_model=schemas.DisasterReportResponse, status_code=201)
async def create_report(report: schemas.DisasterReportCreate, db: Session = Depends(get_db)):
    """Submit a new disaster report with auto-clustering and confidence scoring."""

    # Validate coordinates
    if not (-90 <= report.latitude <= 90) or not (-180 <= report.longitude <= 180):
        raise HTTPException(status_code=422, detail="Invalid latitude or longitude")

    # Auto-compute severity from disaster type
    base_severity = report.severity or "Medium"
    computed_severity = compute_severity_from_type(report.disaster_type, base_severity)

    # Find nearby reports
    nearby = get_nearby_reports(db, report.latitude, report.longitude)
    confidence_level = assign_confidence(len(nearby))
    cluster_id = find_or_create_cluster_id(db, nearby) if (nearby or True) else None

    db_report = models.DisasterReport(
        disaster_type=report.disaster_type,
        description=report.description,
        latitude=report.latitude,
        longitude=report.longitude,
        image_url=report.image_url,
        severity=computed_severity,
        status="Open",
        confidence_level=confidence_level,
        cluster_id=cluster_id,
        reporter_name=report.reporter_name,
        reporter_phone=report.reporter_phone,
    )
    db.add(db_report)
    db.commit()
    db.refresh(db_report)

    # Propagate confidence to nearby reports (they may now be MEDIUM/HIGH)
    if nearby:
        new_count = len(nearby) + 1
        new_conf = assign_confidence(new_count)
        for r in nearby:
            r.confidence_level = new_conf
            r.cluster_id = cluster_id
        db.commit()

    # Broadcast new report
    report_data = {
        "id": db_report.id,
        "disaster_type": db_report.disaster_type,
        "description": db_report.description,
        "latitude": db_report.latitude,
        "longitude": db_report.longitude,
        "severity": db_report.severity,
        "status": db_report.status,
        "confidence_level": db_report.confidence_level,
        "cluster_id": db_report.cluster_id,
        "timestamp": db_report.timestamp.isoformat() if db_report.timestamp else None
    }
    await manager.broadcast({
        "type": "NEW_REPORT",
        "data": report_data
    })

    return db_report


@router.post("/sos", response_model=schemas.DisasterReportResponse, status_code=201)
async def trigger_sos(sos: schemas.SOSCreate, db: Session = Depends(get_db)):
    """Instantly trigger a high-priority SOS alert from a victim's GPS."""
    nearby = get_nearby_reports(db, sos.latitude, sos.longitude)
    confidence_level = assign_confidence(len(nearby))
    cluster_id = find_or_create_cluster_id(db, nearby) if nearby else None

    # Auto-generate a critical report
    db_report = models.DisasterReport(
        disaster_type="Other",
        description="URGENT: Automated SOS Signal from Victim",
        latitude=sos.latitude,
        longitude=sos.longitude,
        severity="Critical",
        status="Open",
        confidence_level=confidence_level,
        cluster_id=cluster_id,
        reporter_name="Emergency SOS",
    )
    db.add(db_report)
    db.commit()
    db.refresh(db_report)

    # Broadcast new report
    report_data = {
        "id": db_report.id,
        "disaster_type": db_report.disaster_type,
        "description": db_report.description,
        "latitude": db_report.latitude,
        "longitude": db_report.longitude,
        "severity": db_report.severity,
        "status": db_report.status,
        "confidence_level": db_report.confidence_level,
        "cluster_id": db_report.cluster_id,
        "timestamp": db_report.timestamp.isoformat() if db_report.timestamp else None
    }
    await manager.broadcast({
        "type": "NEW_REPORT",
        "data": report_data
    })
    
    # Broadcast an explicit high-priority alert to command center
    await manager.broadcast({
        "type": "NEW_ALERT",
        "data": {
            "id": db_report.id * -1, # Synthetic ID for pure websocket alert
            "message": f"🚨 EMERGENCY SOS Triggered at {round(sos.latitude, 4)}, {round(sos.longitude, 4)}",
            "severity": "High",
            "timestamp": db_report.timestamp.isoformat() if db_report.timestamp else None
        }
    })

    return db_report


@router.get("/", response_model=List[schemas.DisasterReportResponse])
def get_reports(db: Session = Depends(get_db)):
    """Retrieve all disaster reports."""
    return db.query(models.DisasterReport).order_by(models.DisasterReport.timestamp.desc()).all()


@router.get("/clusters")
def get_clusters(db: Session = Depends(get_db)):
    """Return a summarized view of disaster clusters for the admin dashboard.
    Reports with a cluster_id are grouped; standalone reports appear as solo clusters.
    """
    # Fetch ALL OPEN reports (only Open reports need dispatch/clustering)
    all_reports = db.query(models.DisasterReport).filter(
        models.DisasterReport.status == "Open"
    ).order_by(models.DisasterReport.id).all()

    clusters = {}
    # Use negative IDs as synthetic cluster keys for standalone reports
    synthetic_id = -1

    for r in all_reports:
        cid = r.cluster_id if r.cluster_id is not None else synthetic_id
        if r.cluster_id is None:
            synthetic_id -= 1  # unique key per standalone report

        if cid not in clusters:
            clusters[cid] = {
                "cluster_id": r.id,           # use report id as the dispatch target
                "disaster_type": r.disaster_type,
                "confidence": r.confidence_level or "LOW",
                "severity": r.severity,
                "status": r.status,
                "description": r.description,
                "report_count": 0,
                "latest_timestamp": None,
                "latitude": r.latitude,
                "longitude": r.longitude,
                "report_ids": [],
            }
        clusters[cid]["report_count"] += 1
        clusters[cid]["report_ids"].append(r.id)
        # Keep highest severity
        sev_order = ["Low", "Medium", "High", "Critical"]
        cur_sev_idx = sev_order.index(clusters[cid]["severity"]) if clusters[cid]["severity"] in sev_order else -1
        new_sev_idx = sev_order.index(r.severity) if r.severity in sev_order else -1
        if new_sev_idx > cur_sev_idx:
            clusters[cid]["severity"] = r.severity
        # Keep latest timestamp
        if r.timestamp:
            ts = r.timestamp.isoformat()
            if not clusters[cid]["latest_timestamp"] or ts > clusters[cid]["latest_timestamp"]:
                clusters[cid]["latest_timestamp"] = ts

    return list(clusters.values())



@router.patch("/{report_id}", response_model=schemas.DisasterReportResponse)
async def update_report(report_id: int, update: schemas.DisasterReportUpdate, db: Session = Depends(get_db)):
    """Update status or severity of a disaster report."""
    report = db.query(models.DisasterReport).filter(models.DisasterReport.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    if update.status is not None:
        report.status = update.status
        if update.status == "Resolved":
            stuck_vols = db.query(models.Volunteer).filter(models.Volunteer.assigned_report_id == report_id).all()
            for vol in stuck_vols:
                vol.assigned_report_id = None
                vol.volunteer_status = "Available"
    if update.severity is not None:
        report.severity = update.severity
    db.commit()
    db.refresh(report)

    await manager.broadcast({
        "type": "UPDATE_REPORT",
        "data": {
            "id": report.id,
            "status": report.status,
            "severity": report.severity
        }
    })

    return report


@router.delete("/{report_id}", status_code=204)
async def delete_report(report_id: int, db: Session = Depends(get_db)):
    """Delete a disaster report."""
    report = db.query(models.DisasterReport).filter(models.DisasterReport.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
        
    stuck_vols = db.query(models.Volunteer).filter(models.Volunteer.assigned_report_id == report_id).all()
    for vol in stuck_vols:
        vol.assigned_report_id = None
        vol.volunteer_status = "Available"
        
    db.delete(report)
    db.commit()

    await manager.broadcast({
        "type": "DELETE_REPORT",
        "data": {"id": report_id}
    })


@router.post("/{report_id}/dispatch", status_code=200)
async def dispatch_volunteers(report_id: int, db: Session = Depends(get_db)):
    """
    Intelligently find available volunteers based on disaster type
    and assign the CLOSEST ones (by GPS distance) to this report.
    """
    report = db.query(models.DisasterReport).filter(models.DisasterReport.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    # Basic Heuristics for skill matching based on disaster type
    disaster_type = report.disaster_type.lower()
    if "fire" in disaster_type:
        skill_req = "Rescue"
    elif "flood" in disaster_type or "cyclone" in disaster_type:
        skill_req = "Rescue"
    elif "earthquake" in disaster_type or "landslide" in disaster_type:
        skill_req = "Rescue"
    else:
        skill_req = "Logistics"

    available_volunteers = db.query(models.Volunteer).filter(
        models.Volunteer.skill == skill_req,
        models.Volunteer.assigned_report_id == None
    ).all()

    # FALLBACK LOGIC: If no volunteers with the exact required skill are available,
    # fallback to ANY available volunteer to ensure someone is dispatched.
    if not available_volunteers:
        available_volunteers = db.query(models.Volunteer).filter(
            models.Volunteer.assigned_report_id == None
        ).all()

    # Sort by distance (closest first). Volunteers without GPS go last.
    def sort_key(vol):
        if vol.latitude is not None and vol.longitude is not None:
            return haversine_km(report.latitude, report.longitude, vol.latitude, vol.longitude)
        return float('inf')  # No GPS → pushed to end

    available_volunteers.sort(key=sort_key)

    # Dynamic Severity Allocation Scale
    severity = report.severity if report.severity else "Medium"
    required_count = 2 # default
    if severity == "Critical":
        required_count = 5
    elif severity == "High":
        required_count = 3
    elif severity == "Low":
        required_count = 1

    closest_vols = available_volunteers[:required_count]

    dispatched = []
    for vol in closest_vols:
        vol.assigned_report_id = report.id
        vol.volunteer_status = "ASSIGNED"
        dist = None
        if vol.latitude is not None and vol.longitude is not None:
            dist = round(haversine_km(report.latitude, report.longitude, vol.latitude, vol.longitude), 2)
        dispatched.append({
            "id": vol.id, "name": vol.name, "skill": vol.skill,
            "phone": vol.phone, "distance_km": dist
        })

    if dispatched and report.status == "Open":
        report.status = "In Progress"

    db.commit()

    await manager.broadcast({
        "type": "DISPATCH",
        "data": {
            "report_id": report.id,
            "dispatched_volunteers": dispatched,
            "new_status": report.status
        }
    })

    # Prepare warning if under-resourced
    message = f"Successfully dispatched {len(dispatched)} volunteer(s)."
    if len(dispatched) < required_count:
        shortage = required_count - len(dispatched)
        message = f"Dispatched {len(dispatched)} volunteer(s) (CRITICAL SHORTAGE: Need {shortage} more!)"

    return {
        "message": message,
        "volunteers": dispatched
    }
