/* Расчёт суточной нормы. Зеркало серверной функции в app.py. */
(function (global) {
  'use strict';

  var ACTIVITY = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    active: 1.725,
    very_active: 1.9
  };

  var GOAL = { lose: -500, maintain: 0, gain: 300 };
  var PROTEIN = { lose: 1.6, maintain: 1.4, gain: 1.8 };

  function num(value, fallback) {
    var n = Number(value);
    return isFinite(n) && n !== 0 ? n : fallback;
  }

  function calculate(input) {
    var sex = input.sex === 'male' ? 'male' : 'female';
    var age = num(input.age, 30);
    var weight = num(input.weight_kg, 65);
    var height = num(input.height_cm, 170);
    var activity = ACTIVITY[input.activity_level] ? input.activity_level : 'moderate';
    var goal = GOAL.hasOwnProperty(input.goal) ? input.goal : 'maintain';
    var meals = Math.min(8, Math.max(2, Math.round(num(input.meals_per_day, 4))));

    var bmr = 10 * weight + 6.25 * height - 5 * age + (sex === 'male' ? 5 : -161);
    var maintenance = bmr * ACTIVITY[activity];
    var kcal = Math.max(1200, Math.round(maintenance + GOAL[goal]));
    var protein = Math.round(weight * PROTEIN[goal]);
    var fat = Math.round(kcal * 0.25 / 9);
    var carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));

    return {
      bmr: Math.round(bmr),
      maintenance: Math.round(maintenance),
      kcal: kcal,
      protein: protein,
      fat: fat,
      carbs: carbs,
      per_meal_kcal: Math.round(kcal / meals),
      activity_factor: ACTIVITY[activity],
      goal_adjust: GOAL[goal]
    };
  }

  function byGrams(food, grams) {
    var factor = Number(grams) / 100;
    return {
      kcal: Math.round((Number(food.kcal) || 0) * factor * 10) / 10,
      protein: Math.round((Number(food.protein) || 0) * factor * 10) / 10,
      fat: Math.round((Number(food.fat) || 0) * factor * 10) / 10,
      carbs: Math.round((Number(food.carbs) || 0) * factor * 10) / 10
    };
  }

  global.Nutrition = { calculate: calculate, byGrams: byGrams, ACTIVITY: ACTIVITY, GOAL: GOAL, PROTEIN: PROTEIN };
})(window);
