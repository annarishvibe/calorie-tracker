"""Генератор SQL для загрузки справочника блюд в Supabase.

Читает data/foods.json и перезаписывает supabase/seed_foods.sql.
"""

import json
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
foods = json.loads((BASE / "data" / "foods.json").read_text(encoding="utf-8"))


def sql_string(value: str) -> str:
    return "'" + str(value).replace("'", "''") + "'"


blocks = []
for start in range(0, len(foods), 40):
    chunk = foods[start:start + 40]
    rows = ",\n".join(
        "({}, {}, {}, {}, {}, {}, {})".format(
            sql_string(item["name"]),
            sql_string(item["category"]),
            item["kcal"], item["protein"], item["fat"], item["carbs"], item["serving_g"],
        )
        for item in chunk
    )
    blocks.append(
        "insert into public.foods (name, category, kcal, protein, fat, carbs, serving_g)\n"
        "values\n" + rows + "\non conflict do nothing;"
    )

out = (
    "-- Стартовые блюда Ккал.Дневника (КБЖУ на 100 г, {} позиций)\n".format(len(foods))
    + "-- Сгенерировано из data/foods.json скриптом scripts/seed_supabase.py\n\n"
    + "\n\n".join(blocks)
    + "\n\nselect count(*) as seeded_foods from public.foods where is_custom = false;\n"
)

path = BASE / "supabase" / "seed_foods.sql"
path.write_text(out, encoding="utf-8")
print("Записано", len(foods), "блюд в", path)
