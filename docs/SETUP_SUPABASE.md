# Настройка Supabase

Пошаговая инструкция для бэкенда приложения «Ккал.Дневник».

## 1. Создание проекта

1. Войдите в https://supabase.com/dashboard и нажмите **New project**.
2. Укажите название `calorie-tracker`, пароль базы и регион.
3. Дождитесь окончания создания проекта.

Для этого репозитория проект уже создан: `mznibizsnsvtervqptgy` ( eu-central-1 ), URL `https://mznibizsnsvtervqptgy.supabase.co`.

## 2. Применение схемы

1. Откройте **SQL Editor** в панели проекта.
2. Создайте новый запрос, вставьте содержимое `supabase/migrations/0001_init.sql` и нажмите **Run**.
3. Создайте ещё один запрос, вставьте `supabase/seed_foods.sql` и нажмите **Run**.
4. Проверьте в **Table Editor**, что появились таблицы `profiles`, `foods`, `diary_entries`, `favorites` и представление `daily_totals`.

Если нужно пересоздать стартовые блюда после изменения `data/foods.json`:

```bash
python scripts/seed_supabase.py
```

Скрипт перезапишет `supabase/seed_foods.sql`.

## 3. Ключи

В **Project Settings → API** возьмите:

- **Project URL** — запишите в `SUPABASE_URL`;
- **anon / public key** — запишите в `SUPABASE_ANON_KEY`.

`service_role` не используется и не должен попадать в репозиторий или браузер.

## 4. Авторизация

1. **Authentication → Providers → Email**: включите провайдер.
2. Рекомендуется отключить **Confirm email** (Authentication → Providers → Email → Confirm email): иначе вход до подтверждения даёт ошибку `Email not confirmed`. В приложении есть кнопка повторной отправки письма, но сразу после регистрации дневник откроется только если подтверждение выключено.
3. В **Authentication → URL Configuration** добавьте `http://localhost:5000` в **Site URL** и **Redirect URLs** (и домен продакшена, если он есть).
4. При включённом подтверждении почты ссылка в письме вернёт пользователя на сайт с сессией — анкета откроется автоматически.

## 5. Как устроена регистрация

1. Клиент вызывает `supabase.auth.signUp()` с email, паролем и `display_name` в `user_metadata`.
2. Триггер `on_auth_user_created` на таблице `auth.users` автоматически создаёт строку в `public.profiles` с `onboarding_complete = false`.
3. Приложение открывает анкету. После сохранения анкеты в `profiles` пишутся антропометрия, цель, число приёмов пищи и рассчитанные цели по КБЖУ, флаг `onboarding_complete = true`.
4. При следующем входе приложение сразу открывает дневник.

## 6. Безопасность (RLS)

На всех таблицах включён Row Level Security:

- `profiles` — пользователь читает и обновляет только свою строку (`auth.uid() = id`);
- `diary_entries` — любые операции только с `user_id = auth.uid()`;
- `favorites` — то же правило;
- `foods` — читают все, создавать/изменять/удалять можно только свои пользовательские блюда (`created_by = auth.uid() AND is_custom`).

Функция `handle_new_user()` выполнена с `SECURITY DEFINER`, поэтому создание профиля не зависит от политик вставки.

Представление `daily_totals` создано с `security_invoker = true`: агрегаты считаются в контексте прав текущего пользователя.

## 7. Локальный запуск

```bash
pip install -r requirements.txt
cp .env.example .env   # Windows: copy .env.example .env
python app.py
```

Если Supabase не настроен, приложение всё равно откроется, но покажет понятное сообщение о конфигурации — интерфейс можно посмотреть без данных.
