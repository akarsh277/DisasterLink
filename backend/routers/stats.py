from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend import models
from backend import schemas
from backend.database import get_db

router = APIRouter(prefix="/stats", tags=["Stats"])


@router.get("/", response_model=schemas.StatsResponse)
def get_stats(db: Session = Depends(get_db)):
    """Return platform-wide summary statistics."""
    total_reports    = db.query(models.DisasterReport).count()
    # "Active" means Open or In Progress — NOT Resolved
    active_reports   = db.query(models.DisasterReport).filter(
        models.DisasterReport.status != "Resolved"
    ).count()
    critical_reports = db.query(models.DisasterReport).filter(
        models.DisasterReport.severity == "Critical",
        models.DisasterReport.status != "Resolved"
    ).count()
    active_camps    = db.query(models.ReliefCamp).count()
    total_volunteers = db.query(models.Volunteer).count()
    total_alerts    = db.query(models.Alert).count()

    return schemas.StatsResponse(
        total_reports=active_reports,   # Surface 'active' count as total_reports for dashboard KPI
        open_reports=active_reports,
        critical_reports=critical_reports,
        active_camps=active_camps,
        total_volunteers=total_volunteers,
        total_alerts=total_alerts,
    )
