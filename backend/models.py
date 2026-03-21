from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Boolean
from sqlalchemy.sql import func
from backend.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, nullable=False, index=True)
    hashed_password = Column(String, nullable=False)
    role = Column(String, nullable=False, default="volunteer")  # admin / volunteer
    name = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class DisasterReport(Base):
    __tablename__ = "disaster_reports"

    id = Column(Integer, primary_key=True, index=True)
    disaster_type = Column(String, nullable=False)
    description = Column(String, nullable=True)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    image_url = Column(String, nullable=True)
    severity = Column(String, default="Medium")          # Low / Medium / High / Critical
    status = Column(String, default="Open")              # Open / In Progress / Resolved
    confidence_level = Column(String, default="LOW")     # LOW / MEDIUM / HIGH
    cluster_id = Column(Integer, nullable=True)          # Cluster grouping
    reporter_name = Column(String, nullable=True)
    reporter_phone = Column(String, nullable=True)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())


class Alert(Base):
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True, index=True)
    message = Column(String, nullable=False)
    location = Column(String, nullable=False)
    severity = Column(String, nullable=False)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())


class ReliefCamp(Base):
    __tablename__ = "relief_camps"

    id = Column(Integer, primary_key=True, index=True)
    camp_name = Column(String, nullable=False)
    location = Column(String, nullable=False)
    capacity = Column(Integer, nullable=False)
    occupancy = Column(Integer, default=0)


class Volunteer(Base):
    __tablename__ = "volunteers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    phone = Column(String, nullable=True)
    skill = Column(String, nullable=False)               # Medical / Rescue / Logistics / Communication / Other
    assigned_report_id = Column(Integer, ForeignKey("disaster_reports.id"), nullable=True)
    volunteer_status = Column(String, nullable=True, default=None)   # null / EN_ROUTE / REACHED / COMPLETED
    latitude = Column(Float, nullable=True)               # Volunteer GPS latitude
    longitude = Column(Float, nullable=True)              # Volunteer GPS longitude
    username = Column(String, nullable=True)             # Linked to User.username if registered via auth
    registered_at = Column(DateTime(timezone=True), server_default=func.now())


class Resource(Base):
    __tablename__ = "resources"

    id = Column(Integer, primary_key=True, index=True)
    resource_type = Column(String, nullable=False)       # Food / Water / Medicine / Shelter / Equipment
    quantity = Column(Integer, nullable=False)
    camp_id = Column(Integer, ForeignKey("relief_camps.id"), nullable=False)


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, index=True)
    sender_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    sender_name = Column(String, nullable=False)         # Denormalized for fast display
    sender_role = Column(String, nullable=False)         # volunteer / admin
    message = Column(String, nullable=False)
    latitude = Column(Float, nullable=True)              # Live location if active
    longitude = Column(Float, nullable=True)             # Live location if active
    timestamp = Column(DateTime(timezone=True), server_default=func.now())

