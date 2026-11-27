/* Ккал.Дневник — клиентская логика */
(function () {
  'use strict';

  var $ = function (selector, root) { return (root || document).querySelector(selector); };
  var $$ = function (selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); };

  var MEAL_LABELS = ['Завтрак', 'Второй завтрак', 'Обед', 'Полдник', 'Ужин', 'Перед сном'];

  var state = {
    sb: null,
    config: null,
    user: null,
    profile: null,
    view: 'auth',
    theme: 'system',
    foods: [],
    customFoods: [],
    selectedDate: todayISO(),
    monthEntries: [],
    entries: [],
    foodLimit: 40,
    modal: null
  };

  /* ---------------- Вспомогательные функции ---------------- */

  function todayISO() { return isoDate(new Date()); }

  function isoDate(date) {
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1).padStart(2, '0');
    var d = String(date.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  function parseDate(value) {
    var parts = String(value).split('-');
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }

  function addDays(value, amount) {
    var date = parseDate(value);
    date.setDate(date.getDate() + amount);
    return isoDate(date);
  }

  function fmt(value, digits) {
    var n = Number(value) || 0;
    return n.toLocaleString('ru-RU', { minimumFractionDigits: digits || 0, maximumFractionDigits: digits || 0 });
  }

  function round1(value) { return Math.round((Number(value) || 0) * 10) / 10; }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function dateRu(value, options) {
    return new Intl.DateTimeFormat('ru-RU', options).format(parseDate(value));
  }

  function mealLabel(index, total) {
    return index <= MEAL_LABELS.length ? MEAL_LABELS[index - 1] : 'Приём пищи ' + index;
  }

  function mealOptions(selected) {
    var count = Math.min(8, Math.max(2, Number(state.profile && state.profile.meals_per_day) || 4));
    var html = '';
    for (var i = 1; i <= count; i++) {
      html += '<option value="meal_' + i + '"' + (selected === 'meal_' + i ? ' selected' : '') + '>' + esc(mealLabel(i, count)) + '</option>';
    }
    return html;
  }

  function toast(message, isError) {
    var root = $('#toast-root');
    if (!root) return;
    var el = document.createElement('div');
    el.className = 'toast' + (isError ? ' error' : '');
    el.textContent = message;
    root.appendChild(el);
    setTimeout(function () { el.remove(); }, 4200);
  }

  function setBusy(button, flag, label) {
    if (!button) return;
    button.disabled = !!flag;
    if (flag) {
      button.dataset.original = button.innerHTML;
      if (label) button.textContent = label;
    } else if (button.dataset.original) {
      button.innerHTML = button.dataset.original;
      delete button.dataset.original;
    }
  }

  function errText(error) { return error && error.message ? error.message : String(error || 'Неизвестная ошибка'); }

  function allFoods() { return state.foods.concat(state.customFoods); }

  function findFood(id) {
    var list = allFoods();
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].id) === String(id)) return list[i];
    }
    return null;
  }

  function targets() {
    var p = state.profile || {};
    if (p.use_manual_targets) {
      return {
        kcal: Number(p.daily_kcal) || 2000,
        protein: Number(p.protein_g) || 0,
        fat: Number(p.fat_g) || 0,
        carbs: Number(p.carbs_g) || 0
      };
    }
    return window.Nutrition.calculate(p);
  }

  /* ---------------- Инициализация ---------------- */

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    bindStaticEvents();
    applyTheme(localStorage.getItem('ct-theme') || 'system');
    await loadConfig();
    await loadFoods();

    if (!state.sb) {
      setAuthMessage('Supabase не настроен. Укажите SUPABASE_URL и SUPABASE_ANON_KEY в .env — подробности в docs/SETUP_SUPABASE.md.');
      showView('auth');
      return;
    }

    state.sb.auth.onAuthStateChange(function (event, session) {
      if (event === 'SIGNED_OUT') {
        state.user = null;
        state.profile = null;
        state.entries = [];
        updateUserChip();
        showView('auth');
      } else if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        handleUser(session && session.user);
      }
    });
  }

  async function loadConfig() {
    var cfg = Object.assign({}, window.APP_CONFIG || {});
    try {
      var response = await fetch('api/config', { cache: 'no-store' });
      if (response.ok) {
        var remote = await response.json();
        if (remote.supabaseUrl) cfg.supabaseUrl = remote.supabaseUrl;
        if (remote.anonKey) cfg.anonKey = remote.anonKey;
      }
    } catch (error) { /* статический хостинг без бэкенда */ }

    state.config = cfg;
    if (cfg.supabaseUrl && cfg.anonKey && window.supabase) {
      state.sb = window.supabase.createClient(cfg.supabaseUrl, cfg.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
    }
  }

  async function loadFoods() {
    var urls = ['api/foods?limit=1000', 'data/foods.json', 'https://raw.githubusercontent.com/annarishvibe/calorie-tracker/main/data/foods.json'];
    for (var i = 0; i < urls.length; i++) {
      try {
        var response = await fetch(urls[i], { cache: 'no-store' });
        if (!response.ok) continue;
        var data = await response.json();
        var items = Array.isArray(data) ? data : (data.items || []);
        if (items.length) {
          state.foods = items;
          break;
        }
      } catch (error) { /* пробуем следующий источник */ }
    }
    fillCategorySelect($('#food-category'), 'all');
  }

  async function loadCustomFoods() {
    if (!state.sb || !state.user) { state.customFoods = []; return; }
    var result = await state.sb.from('foods').select('*').eq('is_custom', true).order('name');
    state.customFoods = result.error ? [] : (result.data || []);
  }

  function applyTheme(theme) {
    var selected = theme || 'system';
    var resolved = selected;
    if (selected === 'system') {
      resolved = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', resolved);
    state.theme = selected;
    localStorage.setItem('ct-theme', selected);
    ['#header-theme', '#set-theme'].forEach(function (selector) {
      var node = $(selector);
      if (node) node.value = selected;
    });
  }

  function setAuthMessage(text) {
    var node = $('#auth-message');
    if (node) node.textContent = text || '';
  }

  function updateUserChip() {
    var chip = $('#user-chip');
    if (!chip) return;
    var name = state.profile && state.profile.display_name;
    if (!name && state.user) name = (state.user.email || '').split('@')[0];
    chip.innerHTML = '<i class="fa-regular fa-circle-user"></i><span>' + esc(name || 'Не вошли в аккаунт') + '</span>';
  }

  function showView(name) {
    state.view = name;
    $$('.view').forEach(function (node) { node.classList.toggle('hidden', node.id !== 'view-' + name); });
    $$('.nav-item').forEach(function (node) { node.classList.toggle('active', node.dataset.view === name); });
    var titles = { auth: 'Вход', onboarding: 'Анкета', tracker: 'Дневник', foods: 'База блюд', settings: 'Настройки' };
    $('#topbar-title').textContent = titles[name] || '';
    $('#topbar-date').textContent = new Intl.DateTimeFormat('ru-RU', {
      day: 'numeric', month: 'long', year: 'numeric', weekday: 'long'
    }).format(new Date());

    if (name === 'tracker') { renderCalendar(); renderDay(); renderWeek(); }
    if (name === 'foods') { fillCategorySelect($('#food-category'), 'all'); renderFoods(); }
    if (name === 'settings') fillSettings();
  }

  function requireAuth() {
    if (state.user) return true;
    showView('auth');
    toast('Сначала войдите в аккаунт', true);
    return false;
  }

  /* ---------------- Авторизация и профиль ---------------- */

  async function handleUser(user) {
    if (!user) {
      state.user = null;
      state.profile = null;
      updateUserChip();
      setAuthMessage('');
      showView('auth');
      return;
    }

    state.user = user;
    updateUserChip();

    var result = await state.sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (result.error) toast('Ошибка загрузки профиля: ' + errText(result.error), true);
    state.profile = result.data || state.profile || null;
    await loadCustomFoods();

    if (!state.profile || !state.profile.onboarding_complete) {
      fillOnboarding();
      showView('onboarding');
      return;
    }

    applyTheme(state.profile.theme || 'system');
    await loadMonth();
    await loadDay();
    await loadWeek();
    showView('tracker');
  }

  function collectOnboarding() {
    return {
      display_name: $('#onb-name').value.trim(),
      sex: $('#onb-sex').value,
      age: Number($('#onb-age').value),
      weight_kg: Number($('#onb-weight').value),
      height_cm: Number($('#onb-height').value),
      activity_level: $('#onb-activity').value,
      goal: $('#onb-goal').value,
      meals_per_day: Math.min(8, Math.max(2, Number($('#onb-meals').value) || 4))
    };
  }

  function fillOnboarding() {
    var p = state.profile || {};
    $('#onb-name').value = p.display_name || (state.user && (state.user.email || '').split('@')[0]) || '';
    $('#onb-sex').value = p.sex || 'female';
    $('#onb-age').value = p.age || 30;
    $('#onb-weight').value = p.weight_kg || 65;
    $('#onb-height').value = p.height_cm || 170;
    $('#onb-activity').value = p.activity_level || 'moderate';
    $('#onb-goal').value = p.goal || 'maintain';
    $('#onb-meals').value = p.meals_per_day || 4;
    updateOnboardingSummary();
  }

  function updateOnboardingSummary() {
    var result = window.Nutrition.calculate(collectOnboarding());
    $('#onb-kcal').textContent = fmt(result.kcal);
    $('#onb-bmr').textContent = fmt(result.bmr);
    $('#onb-maint').textContent = fmt(result.maintenance);
    $('#onb-per-meal').textContent = fmt(result.per_meal_kcal);
    $('#onb-protein').textContent = fmt(result.protein);
    $('#onb-fat').textContent = fmt(result.fat);
    $('#onb-carbs').textContent = fmt(result.carbs);
    $('#onb-progress').style.width = Math.min(100, result.kcal / 3500 * 100) + '%';
  }

  /* ---------------- Дневник: календарь и итоги ---------------- */

  async function loadMonth() {
    if (!state.user) return;
    var date = parseDate(state.selectedDate);
    var year = date.getFullYear();
    var month = date.getMonth();
    var start = isoDate(new Date(year, month, 1));
    var end = isoDate(new Date(year, month + 1, 0));
    var result = await state.sb.from('diary_entries')
      .select('entry_date, kcal').eq('user_id', state.user.id)
      .gte('entry_date', start).lte('entry_date', end);
    state.monthEntries = result.error ? [] : (result.data || []);
    renderCalendar();
  }

  async function loadDay() {
    if (!state.user) return;
    var result = await state.sb.from('diary_entries').select('*')
      .eq('user_id', state.user.id).eq('entry_date', state.selectedDate)
      .order('created_at', { ascending: true });
    state.entries = result.error ? [] : (result.data || []);
    renderDay();
  }

  async function loadWeek() {
    var byDate = {};
    if (state.user) {
      var result = await state.sb.from('diary_entries').select('entry_date, kcal')
        .eq('user_id', state.user.id)
        .gte('entry_date', addDays(state.selectedDate, -6))
        .lte('entry_date', state.selectedDate);
      if (!result.error) {
        (result.data || []).forEach(function (row) {
          byDate[row.entry_date] = (byDate[row.entry_date] || 0) + (Number(row.kcal) || 0);
        });
      }
    }
    var html = '';
    for (var i = 6; i >= 0; i--) {
      var date = addDays(state.selectedDate, -i);
      var kcal = byDate[date] || 0;
      html += '<div class="week-day' + (date === todayISO() ? ' is-today' : '') + '">' +
        '<span>' + esc(dateRu(date, { day: 'numeric', month: 'short' })) + '</span>' +
        '<strong>' + fmt(kcal) + '</strong>' +
        '<span>ккал</span></div>';
    }
    var node = $('#week-summary');
    if (node) node.innerHTML = html;
  }

  function renderCalendar() {
    var date = parseDate(state.selectedDate);
    var year = date.getFullYear();
    var month = date.getMonth();
    $('#calendar-month').textContent = dateRu(state.selectedDate, { month: 'long', year: 'numeric' });

    var counts = {};
    state.monthEntries.forEach(function (row) { counts[row.entry_date] = (counts[row.entry_date] || 0) + 1; });

    var first = new Date(year, month, 1);
    var offset = (first.getDay() + 6) % 7;
    var cells = [];
    var i;
    for (i = 0; i < offset; i++) {
      cells.push({ date: isoDate(new Date(year, month, 1 - offset + i)), other: true });
    }
    for (i = 1; i <= new Date(year, month + 1, 0).getDate(); i++) {
      cells.push({ date: isoDate(new Date(year, month, i)), other: false });
    }
    while (cells.length < 42) {
      cells.push({ date: isoDate(new Date(year, month + 1, cells.length - offset - new Date(year, month + 1, 0).getDate() + 1)), other: true });
    }

    $('#calendar-grid').innerHTML = cells.map(function (cell) {
      var classes = ['calendar-cell'];
      if (cell.other) classes.push('other');
      if (cell.date === todayISO()) classes.push('today');
      if (cell.date === state.selectedDate) classes.push('selected');
      var dot = counts[cell.date] ? '<span class="dot"></span>' : '';
      return '<button type="button" class="' + classes.join(' ') + '" data-date="' + cell.date + '">' +
        '<span>' + Number(cell.date.slice(-2)) + '</span>' + dot + '</button>';
    }).join('');
  }

  async function selectDate(date) {
    state.selectedDate = date;
    renderCalendar();
    await Promise.all([loadMonth(), loadDay(), loadWeek()]);
    renderDay();
  }

  function renderDay() {
    $('#day-title').textContent = dateRu(state.selectedDate, { day: 'numeric', month: 'long' });
    $('#day-subtitle').textContent = dateRu(state.selectedDate, { weekday: 'long' }) +
      (state.selectedDate === todayISO() ? ' · сегодня' : '');

    var total = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
    state.entries.forEach(function (entry) {
      total.kcal += Number(entry.kcal) || 0;
      total.protein += Number(entry.protein) || 0;
      total.fat += Number(entry.fat) || 0;
      total.carbs += Number(entry.carbs) || 0;
    });
    var goal = targets();
    $('#totals-kcal').textContent = fmt(total.kcal);
    $('#totals-target').textContent = fmt(goal.kcal);
    $('#totals-protein').textContent = fmt(total.protein) + ' / ' + fmt(goal.protein);
    $('#totals-fat').textContent = fmt(total.fat) + ' / ' + fmt(goal.fat);
    $('#totals-carbs').textContent = fmt(total.carbs) + ' / ' + fmt(goal.carbs);
    $('#progress-bar').style.width = Math.min(100, goal.kcal ? total.kcal / goal.kcal * 100 : 0) + '%';

    var count = Math.min(8, Math.max(2, Number(state.profile && state.profile.meals_per_day) || 4));
    var html = '';
    for (var i = 1; i <= count; i++) {
      var slot = 'meal_' + i;
      var items = state.entries.filter(function (entry) { return entry.meal_slot === slot; });
      var slotKcal = items.reduce(function (sum, entry) { return sum + (Number(entry.kcal) || 0); }, 0);
      html += '<div class="meal-section"><div class="meal-head"><div>' +
        '<strong>' + esc(mealLabel(i, count)) + '</strong> ' +
        '<small>' + fmt(slotKcal) + ' / ' + fmt(Math.round(goal.kcal / count)) + ' ккал</small></div>' +
        '<button class="icon-button" type="button" data-meal="' + slot + '" aria-label="Добавить блюдо"><i class="fa-solid fa-plus"></i></button>' +
        '</div><div class="meal-body">';

      if (items.length) {
        html += items.map(function (entry) {
          return '<div class="entry-row">' +
            '<div class="entry-name"><strong>' + esc(entry.food_name) + '</strong><small>' + fmt(entry.grams, 1) + ' г</small></div>' +
            '<span class="entry-macros">Б ' + fmt(entry.protein, 1) + ' · Ж ' + fmt(entry.fat, 1) + ' · У ' + fmt(entry.carbs, 1) + '</span>' +
            '<span class="entry-kcal">' + fmt(entry.kcal, 1) + ' ккал</span>' +
            '<button class="entry-delete" type="button" data-id="' + esc(entry.id) + '" title="Удалить запись"><i class="fa-solid fa-trash-can"></i></button>' +
            '</div>';
        }).join('');
      } else {
        html += '<div class="empty-meal">Пока пусто</div>';
      }

      html += '<button class="btn btn-ghost add-food" type="button" data-meal="' + slot + '">' +
        '<i class="fa-solid fa-plus"></i> Добавить блюдо</button></div></div>';
    }
    $('#meals-container').innerHTML = html;
  }

  async function addEntry(food, grams, slot, date) {
    var macros = window.Nutrition.byGrams(food, grams);
    var row = {
      user_id: state.user.id,
      entry_date: date,
      meal_slot: slot,
      // Справочные блюда имеют строковый id из foods.json — в БД они не ссылка.
      food_id: food.is_custom ? food.id : null,
      food_name: food.name,
      grams: grams,
      kcal: macros.kcal,
      protein: macros.protein,
      fat: macros.fat,
      carbs: macros.carbs
    };
    var result = await state.sb.from('diary_entries').insert(row);
    if (result.error) { toast('Не удалось добавить запись: ' + errText(result.error), true); return false; }
    state.selectedDate = date;
    await Promise.all([loadMonth(), loadDay(), loadWeek()]);
    renderDay();
    toast('Добавлено: ' + food.name);
    return true;
  }

  /* ---------------- Модальное окно выбора блюда ---------------- */

  function openFoodModal(mealSlot, presetFood) {
    if (!requireAuth()) return;
    state.modal = {
      mealSlot: mealSlot || 'meal_1',
      date: state.selectedDate,
      selectedFood: presetFood || null,
      query: '',
      category: 'all',
      limit: 40,
      tab: 'picker'
    };
    $('#modal-title').textContent = presetFood ? 'Добавить блюдо' : 'Выбрать блюдо';
    $('#modal').classList.remove('hidden');
    renderModal();
  }

  function closeModal() {
    $('#modal').classList.add('hidden');
    state.modal = null;
  }

  function renderModal() {
    if (!state.modal) return;
    var modal = state.modal;
    $('#modal-body').innerHTML =
      '<div class="tabs">' +
      '<button class="tab' + (modal.tab === 'picker' ? ' active' : '') + '" type="button" data-modal-tab="picker">Из базы</button>' +
      '<button class="tab' + (modal.tab === 'custom' ? ' active' : '') + '" type="button" data-modal-tab="custom">Новое блюдо</button>' +
      '</div>' +
      '<div id="modal-picker" class="' + (modal.tab === 'custom' ? 'hidden' : '') + '">' +
      '<div class="filters"><label class="field"><span>Поиск</span><input id="mp-search" type="search" value="' + esc(modal.query) + '" placeholder="Название блюда"></label>' +
      '<label class="field"><span>Категория</span><select id="mp-category"></select></label></div>' +
      '<div class="picker-list" id="mp-list"></div>' +
      '<div id="mp-selection"></div></div>' +
      '<div id="modal-custom" class="' + (modal.tab === 'custom' ? '' : 'hidden') + '">' +
      '<form id="mp-custom-form" class="modal-form" novalidate>' +
      '<label class="field field-wide"><span>Название</span><input id="mcf-name" type="text" required></label>' +
      '<label class="field"><span>Категория</span><input id="mcf-category" type="text" value="Свои блюда"></label>' +
      '<label class="field"><span>Ккал / 100 г</span><input id="mcf-kcal" type="number" min="0" step="0.1" required></label>' +
      '<label class="field"><span>Белки, г</span><input id="mcf-protein" type="number" min="0" step="0.1" value="0"></label>' +
      '<label class="field"><span>Жиры, г</span><input id="mcf-fat" type="number" min="0" step="0.1" value="0"></label>' +
      '<label class="field"><span>Углеводы, г</span><input id="mcf-carbs" type="number" min="0" step="0.1" value="0"></label>' +
      '<label class="field"><span>Порция, г</span><input id="mcf-serving" type="number" min="1" step="1" value="100"></label>' +
      '<label class="field"><span>Приём пищи</span><select id="mcf-meal">' + mealOptions(modal.mealSlot) + '</select></label>' +
      '<label class="field"><span>Дата</span><input id="mcf-date" type="date" value="' + esc(modal.date) + '"></label>' +
      '<button class="btn btn-primary btn-block" type="submit"><i class="fa-solid fa-plus"></i> Создать и добавить</button>' +
      '</form></div>';

    fillCategorySelect($('#mp-category'), modal.category);
    renderPickerList();
    renderSelection();

    $('#mp-search').addEventListener('input', function (event) {
      state.modal.query = event.target.value;
      state.modal.limit = 40;
      renderPickerList();
    });
    $('#mp-category').addEventListener('change', function (event) {
      state.modal.category = event.target.value;
      state.modal.limit = 40;
      renderPickerList();
    });
    $('#mp-list').addEventListener('click', function (event) {
      var button = event.target.closest('[data-food-id]');
      if (!button) return;
      state.modal.selectedFood = findFood(button.dataset.foodId);
      renderPickerList();
      renderSelection();
    });
    $('#modal-picker').addEventListener('click', function (event) {
      if (event.target.closest('#mp-add')) confirmModalAdd();
    });
    $('#modal-picker').addEventListener('input', function (event) {
      if (event.target.id === 'mp-grams') updateModalPreview();
      if (event.target.id === 'mp-date') state.modal.date = event.target.value;
      if (event.target.id === 'mp-meal') state.modal.mealSlot = event.target.value;
    });
    $('#mp-custom-form').addEventListener('submit', createCustomFromModal);
  }

  function fillCategorySelect(select, selected) {
    if (!select) return;
    var categories = [];
    allFoods().forEach(function (food) {
      var category = food.category || 'other';
      if (categories.indexOf(category) === -1) categories.push(category);
    });
    categories.sort(function (a, b) { return a.localeCompare(b, 'ru'); });
    select.innerHTML = '<option value="all">Все категории</option>' + categories.map(function (category) {
      return '<option value="' + esc(category) + '"' + (selected === category ? ' selected' : '') + '>' + esc(category) + '</option>';
    }).join('');
  }

  function renderPickerList() {
    var list = $('#mp-list');
    if (!list || !state.modal) return;
    var query = state.modal.query.trim().toLocaleLowerCase('ru');
    var filtered = allFoods().filter(function (food) {
      var name = String(food.name || '').toLocaleLowerCase('ru');
      var category = String(food.category || '').toLocaleLowerCase('ru');
      var matches = !query || name.indexOf(query) !== -1 || category.indexOf(query) !== -1;
      var inCategory = state.modal.category === 'all' || food.category === state.modal.category;
      return matches && inCategory;
    });
    var shown = filtered.slice(0, state.modal.limit);
    list.innerHTML = shown.map(function (food) {
      var active = state.modal.selectedFood && String(state.modal.selectedFood.id) === String(food.id);
      return '<button class="picker-item' + (active ? ' selected' : '') + '" type="button" data-food-id="' + esc(food.id) + '">' +
        '<span>' + esc(food.name) + '<br><small>' + esc(food.category) + '</small></span>' +
        '<span class="num">' + fmt(food.kcal) + ' ккал</span></button>';
    }).join('') || '<div class="empty-meal">Ничего не найдено. Попробуйте другое слово или создайте своё блюдо.</div>';
  }

  function renderSelection() {
    var node = $('#mp-selection');
    if (!node || !state.modal) return;
    var food = state.modal.selectedFood;
    if (!food) { node.innerHTML = ''; return; }
    var grams = food.serving_g || 100;
    node.innerHTML = '<div class="selected-line">Выбрано: <strong>' + esc(food.name) + '</strong> · ' + fmt(food.kcal) + ' ккал / 100 г</div>' +
      '<div class="modal-form">' +
      '<label class="field"><span>Граммы</span><input id="mp-grams" type="number" min="1" step="1" value="' + grams + '"></label>' +
      '<label class="field"><span>Приём пищи</span><select id="mp-meal">' + mealOptions(state.modal.mealSlot) + '</select></label>' +
      '<label class="field field-wide"><span>Дата</span><input id="mp-date" type="date" value="' + esc(state.modal.date) + '"></label>' +
      '<div class="selected-line field-wide" id="mp-preview"></div>' +
      '<button class="btn btn-primary btn-block" type="button" id="mp-add"><i class="fa-solid fa-plus"></i> Добавить в дневник</button>' +
      '</div>';
    updateModalPreview();
  }

  function updateModalPreview() {
    var node = $('#mp-preview');
    if (!node || !state.modal || !state.modal.selectedFood) return;
    var grams = Number($('#mp-grams').value) || 0;
    var macros = window.Nutrition.byGrams(state.modal.selectedFood, grams);
    node.textContent = fmt(macros.kcal, 1) + ' ккал · Б ' + fmt(macros.protein, 1) +
      ' · Ж ' + fmt(macros.fat, 1) + ' · У ' + fmt(macros.carbs, 1);
  }

  async function confirmModalAdd() {
    if (!state.modal || !state.modal.selectedFood) { toast('Сначала выберите блюдо', true); return; }
    var grams = Number($('#mp-grams').value);
    if (!(grams > 0)) { toast('Укажите вес порции больше нуля', true); return; }
    var date = $('#mp-date').value || state.selectedDate;
    var slot = $('#mp-meal').value;
    var ok = await addEntry(state.modal.selectedFood, grams, slot, date);
    if (ok) {
      closeModal();
      if (state.view !== 'tracker') showView('tracker');
    }
  }

  async function createCustomFromModal(event) {
    event.preventDefault();
    var food = {
      name: $('#mcf-name').value.trim(),
      category: $('#mcf-category').value.trim() || 'Свои блюда',
      kcal: Number($('#mcf-kcal').value),
      protein: Number($('#mcf-protein').value) || 0,
      fat: Number($('#mcf-fat').value) || 0,
      carbs: Number($('#mcf-carbs').value) || 0,
      serving_g: Number($('#mcf-serving').value) || 100,
      is_custom: true,
      created_by: state.user.id
    };
    if (!food.name || !(food.kcal >= 0)) { toast('Заполните название и калорийность', true); return; }
    var button = event.target.querySelector('[type="submit"]');
    setBusy(button, true, 'Сохраняем…');
    var result = await state.sb.from('foods').insert(food).select().single();
    setBusy(button, false);
    if (result.error) { toast('Не удалось сохранить блюдо: ' + errText(result.error), true); return; }
    state.customFoods.push(result.data);
    var ok = await addEntry(result.data, food.serving_g, $('#mcf-meal').value, $('#mcf-date').value || state.selectedDate);
    if (ok) {
      closeModal();
      if (state.view !== 'tracker') showView('tracker');
      else renderFoods();
    }
  }

  /* ---------------- База блюд ---------------- */

  function renderFoods() {
    var body = $('#foods-table-body');
    if (!body) return;
    var query = $('#food-search').value.trim().toLocaleLowerCase('ru');
    var category = $('#food-category').value;
    var filtered = allFoods().filter(function (food) {
      var text = (food.name + ' ' + (food.category || '')).toLocaleLowerCase('ru');
      return (!query || text.indexOf(query) !== -1) && (category === 'all' || food.category === category);
    });
    $('#food-count').textContent = filtered.length + ' блюд';
    var shown = filtered.slice(0, state.foodLimit);
    body.innerHTML = shown.map(function (food) {
      return '<tr><td><strong>' + esc(food.name) + '</strong>' + (food.is_custom ? ' <span class="tag">своё</span>' : '') + '</td>' +
        '<td>' + esc(food.category) + '</td>' +
        '<td class="num">' + fmt(food.kcal) + '</td>' +
        '<td class="num">' + fmt(food.protein, 1) + '</td>' +
        '<td class="num">' + fmt(food.fat, 1) + '</td>' +
        '<td class="num">' + fmt(food.carbs, 1) + '</td>' +
        '<td class="num">' + fmt(food.serving_g, 0) + ' г</td>' +
        '<td><button class="btn btn-ghost" type="button" data-food-id="' + esc(food.id) + '"><i class="fa-solid fa-plus"></i> В дневник</button></td></tr>';
    }).join('') || '<tr><td colspan="8" class="muted">Ничего не найдено</td></tr>';
    $('#foods-more').classList.toggle('hidden', shown.length >= filtered.length);
  }

  async function saveCustomFoodFromPage(event) {
    event.preventDefault();
    if (!requireAuth()) return;
    var food = {
      name: $('#cf-name').value.trim(),
      category: $('#cf-category').value.trim() || 'Свои блюда',
      kcal: Number($('#cf-kcal').value),
      protein: Number($('#cf-protein').value) || 0,
      fat: Number($('#cf-fat').value) || 0,
      carbs: Number($('#cf-carbs').value) || 0,
      serving_g: Number($('#cf-serving').value) || 100,
      is_custom: true,
      created_by: state.user.id
    };
    if (!food.name || !(food.kcal >= 0)) { toast('Заполните название и калорийность', true); return; }
    var button = $('#cf-save');
    setBusy(button, true, 'Сохраняем…');
    var result = await state.sb.from('foods').insert(food).select().single();
    setBusy(button, false);
    if (result.error) { toast('Не удалось сохранить блюдо: ' + errText(result.error), true); return; }
    state.customFoods.push(result.data);
    event.target.reset();
    $('#cf-category').value = 'Свои блюда';
    $('#cf-serving').value = '100';
    fillCategorySelect($('#food-category'), 'all');
    renderFoods();
    toast('Блюдо «' + food.name + '» сохранено');
  }

  /* ---------------- Настройки ---------------- */

  function fillSettings() {
    var p = state.profile;
    if (!p) return;
    $('#set-name').value = p.display_name || '';
    $('#set-sex').value = p.sex || 'female';
    $('#set-age').value = p.age || 30;
    $('#set-weight').value = p.weight_kg || 65;
    $('#set-height').value = p.height_cm || 170;
    $('#set-activity').value = p.activity_level || 'moderate';
    $('#set-goal').value = p.goal || 'maintain';
    $('#set-meals').value = p.meals_per_day || 4;
    $('#set-theme').value = p.theme || 'system';
    $('#set-manual').checked = !!p.use_manual_targets;
    $('#manual-targets').classList.toggle('hidden', !p.use_manual_targets);
    var goal = targets();
    $('#set-kcal').value = Math.round(goal.kcal);
    $('#set-protein').value = Math.round(goal.protein);
    $('#set-fat').value = Math.round(goal.fat);
    $('#set-carbs').value = Math.round(goal.carbs);
  }

  async function saveSettings(event) {
    event.preventDefault();
    if (!requireAuth()) return;
    var profile = {
      display_name: $('#set-name').value.trim(),
      sex: $('#set-sex').value,
      age: Number($('#set-age').value),
      weight_kg: Number($('#set-weight').value),
      height_cm: Number($('#set-height').value),
      activity_level: $('#set-activity').value,
      goal: $('#set-goal').value,
      meals_per_day: Math.min(8, Math.max(2, Number($('#set-meals').value) || 4)),
      theme: $('#set-theme').value,
      use_manual_targets: $('#set-manual').checked,
      email: state.user.email || null
    };
    var calculated = window.Nutrition.calculate(profile);
    profile.daily_kcal = profile.use_manual_targets ? Number($('#set-kcal').value) : calculated.kcal;
    profile.protein_g = profile.use_manual_targets ? Number($('#set-protein').value) : calculated.protein;
    profile.fat_g = profile.use_manual_targets ? Number($('#set-fat').value) : calculated.fat;
    profile.carbs_g = profile.use_manual_targets ? Number($('#set-carbs').value) : calculated.carbs;

    var button = $('#set-save');
    setBusy(button, true, 'Сохраняем…');
    var result = await state.sb.from('profiles').update(profile).eq('id', state.user.id).select().single();
    setBusy(button, false);
    if (result.error) { toast('Не удалось сохранить настройки: ' + errText(result.error), true); return; }
    state.profile = result.data;
    applyTheme(profile.theme);
    updateUserChip();
    fillSettings();
    renderDay();
    toast('Настройки сохранены');
  }

  async function exportCsv() {
    if (!requireAuth()) return;
    var result = await state.sb.from('diary_entries').select('*')
      .eq('user_id', state.user.id).order('entry_date').order('created_at');
    if (result.error) { toast('Не удалось выгрузить данные: ' + errText(result.error), true); return; }
    var lines = ['Дата;Приём пищи;Блюдо;Граммы;Ккал;Белки;Жиры;Углеводы'];
    (result.data || []).forEach(function (row) {
      lines.push([
        row.entry_date,
        mealLabel(Number(String(row.meal_slot).split('_')[1]) || 1, 8),
        '"' + String(row.food_name).replace(/"/g, '""') + '"',
        row.grams, row.kcal, row.protein, row.fat, row.carbs
      ].join(';'));
    });
    var blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'kaloriynik-' + todayISO() + '.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('Дневник выгружен в CSV');
  }

  /* ---------------- Привязка событий ---------------- */

  function bindStaticEvents() {
    $$('.nav-item').forEach(function (button) {
      button.addEventListener('click', function () {
        var view = button.dataset.view;
        if (view === 'auth') return;
        if (!requireAuth()) return;
        if (view === 'tracker') {
          loadMonth(); loadDay(); loadWeek();
        }
        showView(view);
      });
    });

    $$('[data-auth-tab]').forEach(function (button) {
      button.addEventListener('click', function () {
        $$('[data-auth-tab]').forEach(function (item) { item.classList.toggle('active', item === button); });
        $('#auth-panel-login').classList.toggle('hidden', button.dataset.authTab !== 'login');
        $('#auth-panel-register').classList.toggle('hidden', button.dataset.authTab !== 'register');
        setAuthMessage('');
      });
    });

    $('#login-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      if (!state.sb) { setAuthMessage('Supabase не настроен.'); return; }
      var button = $('#login-submit');
      setBusy(button, true, 'Входим…');
      var result = await state.sb.auth.signInWithPassword({
        email: $('#login-email').value.trim(),
        password: $('#login-password').value
      });
      setBusy(button, false);
      if (result.error) { setAuthMessage(errText(result.error)); return; }
      setAuthMessage('');
    });

    $('#register-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      var password = $('#register-password').value;
      if (password !== $('#register-confirm').value) { setAuthMessage('Пароли не совпадают.'); return; }
      if (password.length < 6) { setAuthMessage('Пароль должен содержать минимум 6 символов.'); return; }
      var button = $('#register-submit');
      setBusy(button, true, 'Создаём…');
      var result = await state.sb.auth.signUp({
        email: $('#register-email').value.trim(),
        password: password,
        options: { data: { display_name: $('#register-name').value.trim() } }
      });
      setBusy(button, false);
      if (result.error) { setAuthMessage(errText(result.error)); return; }
      if (result.data && result.data.session) {
        setAuthMessage('');
        handleUser(result.data.session.user);
      } else {
        setAuthMessage('Аккаунт создан. Подтвердите почту (если включено подтверждение), затем войдите.');
        $$('[data-auth-tab]').forEach(function (item) { item.classList.toggle('active', item.dataset.authTab === 'login'); });
        $('#auth-panel-login').classList.remove('hidden');
        $('#auth-panel-register').classList.add('hidden');
      }
    });

    $('#forgot-password').addEventListener('click', async function () {
      var email = $('#login-email').value.trim();
      if (!email) { setAuthMessage('Сначала введите email в поле входа.'); return; }
      if (!state.sb) { setAuthMessage('Supabase не настроен.'); return; }
      var result = await state.sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      setAuthMessage(result.error ? errText(result.error) : 'Ссылка для сброса пароля отправлена на ' + email);
    });

    $('#sign-out').addEventListener('click', async function () {
      if (!state.sb) return;
      await state.sb.auth.signOut();
      state.user = null;
      state.profile = null;
      updateUserChip();
      showView('auth');
    });

    $('#onboarding-form').addEventListener('input', updateOnboardingSummary);
    $$('.stepper-btn').forEach(function (button) {
      button.addEventListener('click', function () {
        var input = $('#onb-meals');
        var next = Number(input.value) + Number(button.dataset.step);
        input.value = Math.min(8, Math.max(2, next));
        updateOnboardingSummary();
      });
    });

    $('#onboarding-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      if (!state.user) return;
      var profile = collectOnboarding();
      if (!profile.age || !profile.weight_kg || !profile.height_cm) { toast('Заполните возраст, вес и рост', true); return; }
      var calculated = window.Nutrition.calculate(profile);
      var payload = Object.assign({}, profile, {
        email: state.user.email || null,
        daily_kcal: calculated.kcal,
        protein_g: calculated.protein,
        fat_g: calculated.fat,
        carbs_g: calculated.carbs,
        use_manual_targets: false,
        onboarding_complete: true,
        theme: state.theme
      });
      var button = $('#onb-save');
      setBusy(button, true, 'Сохраняем…');
      var result = await state.sb.from('profiles').update(payload).eq('id', state.user.id).select().single();
      if (result.error || !result.data) {
        var upsert = await state.sb.from('profiles').upsert(Object.assign({ id: state.user.id }, payload)).select().single();
        result = upsert;
      }
      setBusy(button, false);
      if (result.error) { toast('Не удалось сохранить анкету: ' + errText(result.error), true); return; }
      state.profile = result.data;
      updateUserChip();
      await loadMonth();
      await loadDay();
      await loadWeek();
      showView('tracker');
      toast('Анкета сохранена. Ваша норма: ' + fmt(calculated.kcal) + ' ккал');
    });

    $('#calendar-prev').addEventListener('click', function () {
      var date = parseDate(state.selectedDate);
      selectDate(isoDate(new Date(date.getFullYear(), date.getMonth() - 1, 1)));
    });
    $('#calendar-next').addEventListener('click', function () {
      var date = parseDate(state.selectedDate);
      selectDate(isoDate(new Date(date.getFullYear(), date.getMonth() + 1, 1)));
    });
    $('#calendar-today').addEventListener('click', function () { selectDate(todayISO()); });
    $('#calendar-grid').addEventListener('click', function (event) {
      var cell = event.target.closest('[data-date]');
      if (cell) selectDate(cell.dataset.date);
    });

    $('#meals-container').addEventListener('click', function (event) {
      var add = event.target.closest('[data-meal]');
      if (add) { openFoodModal(add.dataset.meal); return; }
      var remove = event.target.closest('[data-id]');
      if (remove) {
        state.sb.from('diary_entries').delete().eq('id', remove.dataset.id).eq('user_id', state.user.id)
          .then(function (result) {
            if (result.error) { toast('Не удалось удалить запись: ' + errText(result.error), true); return; }
            loadMonth(); loadDay(); loadWeek();
            toast('Запись удалена');
          });
      }
    });

    $('#copy-previous').addEventListener('click', async function () {
      if (!requireAuth()) return;
      var previous = addDays(state.selectedDate, -1);
      var result = await state.sb.from('diary_entries').select('*')
        .eq('user_id', state.user.id).eq('entry_date', previous);
      if (result.error || !result.data || !result.data.length) { toast('На предыдущий день записей нет', true); return; }
      var rows = result.data.map(function (entry) {
        return {
          user_id: state.user.id,
          entry_date: state.selectedDate,
          meal_slot: entry.meal_slot,
          food_id: entry.food_id,
          food_name: entry.food_name,
          grams: entry.grams,
          kcal: entry.kcal,
          protein: entry.protein,
          fat: entry.fat,
          carbs: entry.carbs
        };
      });
      var inserted = await state.sb.from('diary_entries').insert(rows);
      if (inserted.error) { toast('Не удалось скопировать: ' + errText(inserted.error), true); return; }
      await loadDay(); await loadMonth(); await loadWeek();
      toast('Записи предыдущего дня скопированы');
    });

    $('#clear-day').addEventListener('click', async function () {
      if (!requireAuth() || !state.entries.length) return;
      if (!confirm('Удалить все записи за выбранный день?')) return;
      var result = await state.sb.from('diary_entries').delete()
        .eq('user_id', state.user.id).eq('entry_date', state.selectedDate);
      if (result.error) { toast('Не удалось очистить день: ' + errText(result.error), true); return; }
      await loadDay(); await loadMonth(); await loadWeek();
      toast('День очищен');
    });

    $('#food-search').addEventListener('input', function () { state.foodLimit = 40; renderFoods(); });
    $('#food-category').addEventListener('change', function () { state.foodLimit = 40; renderFoods(); });
    $('#foods-more').addEventListener('click', function () { state.foodLimit += 40; renderFoods(); });
    $('#foods-table-body').addEventListener('click', function (event) {
      var button = event.target.closest('[data-food-id]');
      if (button) openFoodModal('meal_1', findFood(button.dataset.foodId));
    });
    $('#custom-food-form').addEventListener('submit', saveCustomFoodFromPage);

    $('#set-manual').addEventListener('change', function () {
      $('#manual-targets').classList.toggle('hidden', !$('#set-manual').checked);
    });
    $('#settings-form').addEventListener('submit', saveSettings);
    $('#export-csv').addEventListener('click', exportCsv);

    $('#password-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      var password = $('#pwd-new').value;
      if (password !== $('#pwd-confirm').value) { toast('Пароли не совпадают', true); return; }
      if (password.length < 6) { toast('Пароль слишком короткий', true); return; }
      var result = await state.sb.auth.updateUser({ password: password });
      if (result.error) { toast('Не удалось обновить пароль: ' + errText(result.error), true); return; }
      $('#password-form').reset();
      toast('Пароль обновлён');
    });

    $('#header-theme').addEventListener('change', async function (event) {
      applyTheme(event.target.value);
      if (state.sb && state.user && state.profile) {
        await state.sb.from('profiles').update({ theme: event.target.value }).eq('id', state.user.id);
        state.profile.theme = event.target.value;
      }
    });

    $('#modal-close').addEventListener('click', closeModal);
    $('#modal').addEventListener('click', function (event) {
      if (event.target.closest('[data-modal-close]')) closeModal();
      var tab = event.target.closest('[data-modal-tab]');
      if (tab && state.modal) {
        state.modal.tab = tab.dataset.modalTab;
        renderModal();
      }
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && state.modal) closeModal();
    });

    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
        if (state.theme === 'system') applyTheme('system');
      });
    }
  }
})();
