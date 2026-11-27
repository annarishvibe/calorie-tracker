"""Ккал.Дневник — Flask-бэкенд.

Раздаёт интерфейс, справочник блюд и корректную конфигурацию Supabase,
а также содержит серверную реализацию расчёта суточной нормы.
"""

from __future__ import annotations

import json
import os
import urllib.request
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

app = Flask(__name__, static_folder="assets", static_url_path="/assets")
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "dev-only-secret-key")

FOODS_PATH = BASE_DIR / "data" / "foods.json"
FOODS_URL = "https://raw.githubusercontent.com/annarishvibe/calorie-tracker/main/data/foods.json"
FOODS: list[dict] = []

if FOODS_PATH.exists():
    FOODS = json.loads(FOODS_PATH.read_text(encoding="utf-8"))
else:
    try:
        with urllib.request.urlopen(FOODS_URL, timeout=10) as response:
            FOODS = json.loads(response.read().decode("utf-8"))
    except Exception:
        FOODS = []

ACTIVITY_FACTORS = {
    "sedentary": 1.2,
    "light": 1.375,
    "moderate": 1.55,
    "active": 1.725,
    "very_active": 1.9,
}

GOAL_ADJUST = {"lose": -500, "maintain": 0, "gain": 300}
PROTEIN_PER_KG = {"lose": 1.6, "maintain": 1.4, "gain": 1.8}


def calculate_nutrition(data: dict) -> dict:
    """Возвращает суточную норму КБЖУ (Миффлин — Сан Жеор)."""
    sex = data.get("sex", "female")
    age = float(data.get("age") or 0)
    weight = float(data.get("weight_kg") or 0)
    height = float(data.get("height_cm") or 0)
    activity = data.get("activity_level", "moderate")
    goal = data.get("goal", "maintain")
    meals = int(data.get("meals_per_day") or 4)

    if not (10 <= age <= 120 and 20 <= weight <= 400 and 100 <= height <= 250):
        raise ValueError("Проверьте возраст, вес и рост")
    if sex not in ("male", "female"):
        raise ValueError("Неверный пол")
    if activity not in ACTIVITY_FACTORS:
        raise ValueError("Неверный уровень активности")
    if goal not in GOAL_ADJUST:
        raise ValueError("Неверная цель")
    if not (2 <= meals <= 8):
        raise ValueError("Количество приёмов пищи должно быть от 2 до 8")

    bmr = 10 * weight + 6.25 * height - 5 * age + (5 if sex == "male" else -161)
    maintenance = bmr * ACTIVITY_FACTORS[activity]
    kcal = max(1200, round(maintenance + GOAL_ADJUST[goal]))
    protein = round(weight * PROTEIN_PER_KG[goal])
    fat = round(kcal * 0.25 / 9)
    carbs = max(0, round((kcal - protein * 4 - fat * 9) / 4))

    return {
        "bmr": round(bmr),
        "maintenance": round(maintenance),
        "kcal": kcal,
        "protein": protein,
        "fat": fat,
        "carbs": carbs,
        "per_meal_kcal": round(kcal / meals),
        "activity_factor": ACTIVITY_FACTORS[activity],
        "goal_adjust": GOAL_ADJUST[goal],
    }


@app.get("/")
def index():
    return send_from_directory(BASE_DIR, "index.html")


@app.get("/api/health")
def health():
    return jsonify({"status": "ok", "foods_loaded": len(FOODS)})


@app.get("/data/foods.json")
def foods_json():
    """Прямой доступ к справочнику для статического клиента."""
    return send_from_directory(BASE_DIR / "data", "foods.json")


@app.get("/api/config")
def config():
    """Публичные настройки. anon-ключ предназначен для браузера."""
    return jsonify(
        {
            "supabaseUrl": os.getenv("SUPABASE_URL", ""),
            "anonKey": os.getenv("SUPABASE_ANON_KEY", ""),
        }
    )


@app.get("/api/foods")
def foods():
    query = request.args.get("q", "").strip().casefold()
    category = request.args.get("category", "").strip()
    try:
        limit = min(max(int(request.args.get("limit", 200)), 1), 1000)
    except ValueError:
        limit = 200

    items = FOODS
    if query:
        items = [item for item in items if query in item["name"].casefold()]
    if category and category != "all":
        items = [item for item in items if item["category"] == category]
    return jsonify({"items": items[:limit], "total": len(items)})


@app.post("/api/nutrition/calculate")
def calculate():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "Ожидается JSON-объект"}), 400
    try:
        return jsonify(calculate_nutrition(payload))
    except (ValueError, TypeError) as exc:
        return jsonify({"error": str(exc)}), 400


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 5000)), debug=True)
