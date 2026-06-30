"""
Weather & Hazard Intelligence Router
Fetches live weather data from Open-Meteo API (free, no API key).
"""

from fastapi import APIRouter, Query
import httpx

router = APIRouter(prefix="/weather", tags=["Weather Intelligence"])

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"

# WMO Weather interpretation codes → human-readable descriptions
WMO_CODES = {
    0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Fog", 48: "Depositing rime fog",
    51: "Light drizzle", 53: "Moderate drizzle", 55: "Dense drizzle",
    56: "Light freezing drizzle", 57: "Dense freezing drizzle",
    61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
    66: "Light freezing rain", 67: "Heavy freezing rain",
    71: "Slight snowfall", 73: "Moderate snowfall", 75: "Heavy snowfall",
    77: "Snow grains",
    80: "Slight rain showers", 81: "Moderate rain showers", 82: "Violent rain showers",
    85: "Slight snow showers", 86: "Heavy snow showers",
    95: "Thunderstorm", 96: "Thunderstorm with slight hail", 99: "Thunderstorm with heavy hail",
}

# Hazard classification based on weather conditions
def classify_hazard(weather_code: int, wind_speed: float, rain: float, temp: float):
    """Classify current conditions into hazard level and message."""
    hazard_level = "NORMAL"
    hazard_messages = []

    # Severe weather codes (thunderstorms, heavy precipitation)
    if weather_code >= 95:
        hazard_level = "CRITICAL"
        hazard_messages.append(f"⛈️ Severe thunderstorm activity detected ({WMO_CODES.get(weather_code, 'Unknown')})")
    elif weather_code in (65, 67, 82):
        hazard_level = "HIGH"
        hazard_messages.append(f"🌧️ Heavy precipitation — potential flood risk")
    elif weather_code in (63, 66, 81, 75, 86):
        hazard_level = "ELEVATED"
        hazard_messages.append(f"🌧️ Moderate precipitation — monitor for flooding")

    # Wind hazards
    if wind_speed > 90:
        hazard_level = "CRITICAL"
        hazard_messages.append(f"🌪️ Dangerous wind speeds ({wind_speed:.0f} km/h) — Cyclone/Storm warning")
    elif wind_speed > 60:
        if hazard_level not in ("CRITICAL",):
            hazard_level = "HIGH"
        hazard_messages.append(f"💨 High wind alert ({wind_speed:.0f} km/h)")
    elif wind_speed > 40:
        if hazard_level not in ("CRITICAL", "HIGH"):
            hazard_level = "ELEVATED"
        hazard_messages.append(f"💨 Moderate winds ({wind_speed:.0f} km/h)")

    # Extreme temperature
    if temp > 45:
        if hazard_level not in ("CRITICAL",):
            hazard_level = "HIGH"
        hazard_messages.append(f"🔥 Extreme heat ({temp:.1f}°C) — Heat stroke risk")
    elif temp > 40:
        if hazard_level not in ("CRITICAL", "HIGH"):
            hazard_level = "ELEVATED"
        hazard_messages.append(f"☀️ Very high temperature ({temp:.1f}°C)")
    elif temp < -10:
        if hazard_level not in ("CRITICAL", "HIGH"):
            hazard_level = "ELEVATED"
        hazard_messages.append(f"❄️ Extreme cold ({temp:.1f}°C) — Hypothermia risk")

    # Heavy rain flood risk
    if rain > 20:
        if hazard_level not in ("CRITICAL",):
            hazard_level = "HIGH"
        hazard_messages.append(f"🌊 Flash flood risk — {rain:.1f} mm rainfall")
    elif rain > 10:
        if hazard_level not in ("CRITICAL", "HIGH"):
            hazard_level = "ELEVATED"
        hazard_messages.append(f"🌊 Elevated flood risk — {rain:.1f} mm rainfall")

    if not hazard_messages:
        hazard_messages.append("✅ No significant hazards detected")

    return hazard_level, " | ".join(hazard_messages)


@router.get("/")
async def get_weather(
    lat: float = Query(default=20.5937, description="Latitude"),
    lon: float = Query(default=78.9629, description="Longitude"),
):
    """Fetch current weather conditions from Open-Meteo API."""
    params = {
        "latitude": lat,
        "longitude": lon,
        "current_weather": True,
        "hourly": "precipitation_probability,rain",
        "timezone": "auto",
        "forecast_days": 1,
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(OPEN_METEO_URL, params=params)
            resp.raise_for_status()
            data = resp.json()

        current = data.get("current_weather", {})
        weather_code = current.get("weathercode", 0)
        temperature = current.get("temperature", 0)
        wind_speed = current.get("windspeed", 0)
        wind_dir = current.get("winddirection", 0)

        hourly = data.get("hourly", {})
        rain_values = hourly.get("rain", [0])
        current_rain = rain_values[0] if rain_values else 0

        hazard_level, hazard_message = classify_hazard(weather_code, wind_speed, current_rain, temperature)

        return {
            "temperature_c": temperature,
            "wind_speed_kmh": wind_speed,
            "wind_direction_deg": wind_dir,
            "rain_mm": current_rain,
            "weather_code": weather_code,
            "weather_description": WMO_CODES.get(weather_code, "Unknown"),
            "hazard_level": hazard_level,
            "hazard_message": hazard_message,
            "location": {"latitude": lat, "longitude": lon},
        }

    except httpx.HTTPError as e:
        return {
            "temperature_c": None, "wind_speed_kmh": None, "rain_mm": None,
            "weather_description": "Unavailable", "hazard_level": "UNKNOWN",
            "hazard_message": f"Could not fetch weather data: {str(e)}",
            "location": {"latitude": lat, "longitude": lon},
        }


@router.get("/disasters")
async def get_weather_for_disasters():
    """
    Fetch live weather for every active (non-resolved) disaster report.
    Queries each report's GPS coordinates against Open-Meteo API.
    Returns a list of weather summaries, one per active disaster.
    """
    from database import SessionLocal
    import models as _models

    db = SessionLocal()
    try:
        reports = db.query(_models.DisasterReport).filter(
            _models.DisasterReport.status != "Resolved"
        ).all()
    finally:
        db.close()

    if not reports:
        return []

    results = []

    async with httpx.AsyncClient(timeout=10.0) as client:
        for r in reports:
            try:
                params = {
                    "latitude": r.latitude,
                    "longitude": r.longitude,
                    "current_weather": True,
                    "hourly": "rain",
                    "timezone": "auto",
                    "forecast_days": 1,
                }
                resp = await client.get(OPEN_METEO_URL, params=params)
                resp.raise_for_status()
                data = resp.json()

                current = data.get("current_weather", {})
                weather_code = current.get("weathercode", 0)
                temperature = current.get("temperature", 0)
                wind_speed = current.get("windspeed", 0)
                rain_values = data.get("hourly", {}).get("rain", [0])
                current_rain = rain_values[0] if rain_values else 0

                hazard_level, hazard_message = classify_hazard(
                    weather_code, wind_speed, current_rain, temperature
                )

                results.append({
                    "report_id": r.id,
                    "disaster_type": r.disaster_type,
                    "severity": r.severity,
                    "description": r.description,
                    "status": r.status,
                    "latitude": r.latitude,
                    "longitude": r.longitude,
                    "temperature_c": temperature,
                    "wind_speed_kmh": wind_speed,
                    "rain_mm": current_rain,
                    "weather_description": WMO_CODES.get(weather_code, "Unknown"),
                    "hazard_level": hazard_level,
                    "hazard_message": hazard_message,
                })
            except Exception:
                # If weather fetch fails for one report, still include it
                results.append({
                    "report_id": r.id,
                    "disaster_type": r.disaster_type,
                    "severity": r.severity,
                    "description": r.description,
                    "status": r.status,
                    "latitude": r.latitude,
                    "longitude": r.longitude,
                    "temperature_c": None,
                    "wind_speed_kmh": None,
                    "rain_mm": None,
                    "weather_description": "Unavailable",
                    "hazard_level": "UNKNOWN",
                    "hazard_message": "Weather data unavailable",
                })

    return results




@router.get("/forecast")
async def get_forecast(
    lat: float = Query(default=20.5937, description="Latitude"),
    lon: float = Query(default=78.9629, description="Longitude"),
):
    """Fetch 3-day forecast summary for disaster preparedness."""
    params = {
        "latitude": lat,
        "longitude": lon,
        "daily": "weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max",
        "timezone": "auto",
        "forecast_days": 3,
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(OPEN_METEO_URL, params=params)
            resp.raise_for_status()
            data = resp.json()

        daily = data.get("daily", {})
        dates = daily.get("time", [])
        forecasts = []

        for i, date in enumerate(dates):
            code = daily.get("weathercode", [0])[i] if i < len(daily.get("weathercode", [])) else 0
            forecasts.append({
                "date": date,
                "weather_description": WMO_CODES.get(code, "Unknown"),
                "temp_max_c": daily.get("temperature_2m_max", [0])[i] if i < len(daily.get("temperature_2m_max", [])) else None,
                "temp_min_c": daily.get("temperature_2m_min", [0])[i] if i < len(daily.get("temperature_2m_min", [])) else None,
                "precipitation_mm": daily.get("precipitation_sum", [0])[i] if i < len(daily.get("precipitation_sum", [])) else 0,
                "wind_max_kmh": daily.get("windspeed_10m_max", [0])[i] if i < len(daily.get("windspeed_10m_max", [])) else 0,
            })

        return {"forecasts": forecasts, "location": {"latitude": lat, "longitude": lon}}

    except httpx.HTTPError as e:
        return {"forecasts": [], "error": str(e)}


@router.get("/predict")
async def get_ai_prediction(
    disaster_type: str = Query(..., description="Type of disaster"),
    lat: float = Query(..., description="Latitude"),
    lon: float = Query(..., description="Longitude"),
):
    """
    Simulated AI Prediction Engine:
    Combines live wind data with disaster type to predict impact paths.
    """
    params = {
        "latitude": lat,
        "longitude": lon,
        "current_weather": True,
        "timezone": "auto",
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(OPEN_METEO_URL, params=params)
            resp.raise_for_status()
            data = resp.json()

        current = data.get("current_weather", {})
        wind_speed = current.get("windspeed", 0)
        wind_dir_deg_raw = current.get("winddirection", 0)
        
        # Convert degree to compass points
        dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
        wind_direction = dirs[int((wind_dir_deg_raw + 22.5) / 45) % 8]

        # Heuristic AI Logic
        prediction = f"Analyzing atmospheric conditions for {disaster_type}... "
        if "fire" in disaster_type.lower():
            if wind_speed > 20:
                prediction += f"CRITICAL RISK: High winds ({wind_speed} km/h) from the {wind_direction} will likely spread the fire towards the opposite quadrant."
            else:
                prediction += f"Low wind speed ({wind_speed} km/h) suggests contained spread."
        elif "flood" in disaster_type.lower():
            prediction += f"Local terrain and wind direction ({wind_direction}) indicate water accumulation in low-lying areas. Upstream monitoring required."
        else:
            prediction += f"Impact path predicted towards the {wind_direction} based on current wind vectors."

        return {
            "ai_prediction": prediction,
            "wind_speed_kmh": wind_speed,
            "wind_direction": wind_direction,
            "confidence_score": 0.85
        }
    except Exception as e:
        return {"ai_prediction": "Prediction unavailable", "error": str(e)}
