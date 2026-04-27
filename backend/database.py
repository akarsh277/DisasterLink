from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

import os

# Use DATABASE_URL from environment (e.g., Supabase Postgres URL).
# Fallback to local SQLite if not provided.
SQLALCHEMY_DATABASE_URL = os.environ.get("DATABASE_URL")

if not SQLALCHEMY_DATABASE_URL:
    # Use /tmp for SQLite on Vercel due to read-only filesystem, otherwise use local directory
    if os.environ.get("VERCEL") == "1":
        SQLALCHEMY_DATABASE_URL = "sqlite:////tmp/disaster.db"
    else:
        SQLALCHEMY_DATABASE_URL = "sqlite:///./disaster.db"

# connect_args={"check_same_thread": False} is only needed for SQLite
connect_args = {}
if SQLALCHEMY_DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args=connect_args
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
