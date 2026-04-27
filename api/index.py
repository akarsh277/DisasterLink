import sys
import os

# Explicitly add the root folder to Python's path so Vercel can find the 'backend' folder
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.main import app
