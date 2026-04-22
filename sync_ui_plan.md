# sync_ui_plan.md — ТЗ: Веб-интерфейс синхронизации

> Документ читается Claude Code на старте работы над Next.js-приложением.
> Вся backend-часть (RPC в Supabase, Realtime publication) уже готова — см. раздел «Что уже готово».

---

## 1. Зачем это нужно

Сейчас запуск синхронизации остатков/цен магазина винила происходит по команде в чате Claude.ai («синхронизируй остатки» → Claude вызывает `claude_meta.enqueue_playbook`). Хочется заменить Claude в этой цепочке простым веб-интерфейсом:

- **Три кнопки**: «Остатки», «Цены», «Всё целиком»
- **Нажатие** → RPC `trigger_playbook` ставит задачу в очередь
- **UI показывает прогресс** шагов в реальном времени через Supabase Realtime
- **История прогонов** — последние 20, с деталями
- **Защита от дублей** — нельзя запустить тот же плейбук дважды параллельно

Результат: открываешь страницу с телефона/компа, жмёшь кнопку, смотришь как капают шаги. Без Claude-чата.

---

## 2. Архитектура

```
┌──────────────────┐   RPC trigger_playbook()    ┌────────────────────┐
│  Next.js UI      │ ──────────────────────────► │ Supabase           │
│  (Vercel)        │                              │  claude_meta.      │
│                  │ ◄── Realtime subscribe ──── │  job_queue +       │
│                  │     on job_queue, run       │  playbook_run      │
└──────────────────┘                              └──────────┬─────────┘
                                                             │
                                                    pg_cron every 20s
                                                             │
                                                  ┌──────────▼─────────┐
                                                  │ claude_meta.       │
                                                  │ queue_tick()       │
                                                  │  → http.post n8n   │
                                                  └────────────────────┘
```

**Принцип:** UI не оркестрирует. UI только ставит задачу в очередь и читает статус. Воркер (`queue_tick` в Supabase) — уже существует, его трогать не нужно.

---

## 3. Что уже готово в Supabase

### Project
- **Project ID:** `iavjkpzpkgepwcmhcxoq`
- **Хост:** `https://iavjkpzpkgepwcmhcxoq.supabase.co`
- **anon key** — в `.env.local` как `NEXT_PUBLIC_SUPABASE_ANON_KEY` (запросить у Андрея)

### RPC-функции (все в схеме `public`, все `SECURITY DEFINER`)

#### `trigger_playbook(p_playbook_name text, p_triggered_by text DEFAULT 'web_ui') → jsonb`
Запускает плейбук. Защита от дублей встроена.

Возвращает:
```json
// Успех:
{ "status": "enqueued",        "run_id": 19, "playbook_name": "sync_stocks" }
// Уже идёт:
{ "status": "already_running", "run_id": 18, "playbook_name": "sync_stocks" }
// Неизвестный плейбук:
{ "status": "error", "error": "playbook_not_found", "playbook_name": "xxx" }
```

Допустимые имена плейбуков: **`sync_stocks`**, **`sync_prices`**, **`sync_all`**.

#### `get_active_runs() → table`
Список активных прогонов (status in running/pending) с агрегатами по шагам.

Колонки:
| Колонка | Тип |
|---|---|
| `run_id` | bigint |
| `playbook_name` | text |
| `status` | text |
| `triggered_by` | text |
| `started_at` | timestamptz |
| `steps_total` | int |
| `steps_done` | int |
| `steps_failed` | int |
| `steps_running` | int |

#### `get_run_status(p_run_id bigint) → jsonb`
Детали одного прогона: сам `playbook_run` + массив шагов `job_queue`.

Возвращает:
```json
{
  "run": {
    "run_id": 18,
    "playbook_name": "sync_stocks",
    "status": "completed",
    "triggered_by": "claude",
    "started_at": "2026-04-21T21:48:41+00:00",
    "finished_at": "2026-04-21T21:52:05+00:00",
    "notes": null
  },
  "steps": [
    {
      "job_id": 110,
      "step_order": 1,
      "label": "Продажи Мешка→SB: WF-C-1 (...)",
      "status": "done",
      "run_after": "...",
      "claimed_at": "...",
      "started_at": "...",
      "finished_at": "...",
      "attempt": 1,
      "max_attempts": 2,
      "error_message": null,
      "duration_ms": 0
    }
    // ...
  ]
}
```

#### `get_recent_runs(p_limit integer DEFAULT 20) → table`
Лента последних прогонов. Макс 100.

Колонки:
| Колонка | Тип |
|---|---|
| `run_id` | bigint |
| `playbook_name` | text |
| `status` | text |
| `triggered_by` | text |
| `started_at` | timestamptz |
| `finished_at` | timestamptz |
| `duration_sec` | numeric |
| `steps_total` | int |
| `steps_done` | int |
| `steps_failed` | int |

#### `cancel_run(p_run_id bigint) → jsonb`
Отмена прогона. Queued-шаги → `cancelled`, running не прерывает.

Возвращает:
```json
{
  "status": "ok",
  "run_id": 18,
  "cancelled_steps": 3,
  "running_steps_left": 1,
  "note": "queued steps cancelled; worker will complete running step(s) first"
}
// либо:
{ "status": "error", "error": "run_not_found" | "not_active", "run_id": 18 }
```

### Realtime
Publication `supabase_realtime` включает:
- `claude_meta.job_queue`
- `claude_meta.playbook_run`

SELECT на обе таблицы выдан роли `anon`. Подписка из клиента:

```typescript
supabase
  .channel('sync_ui')
  .on('postgres_changes',
      { event: '*', schema: 'claude_meta', table: 'job_queue',
        filter: `run_id=eq.${runId}` },
      (payload) => { /* ... */ })
  .on('postgres_changes',
      { event: '*', schema: 'claude_meta', table: 'playbook_run' },
      (payload) => { /* ... */ })
  .subscribe()
```

---

## 4. Справочник плейбуков (для UI-лейблов)

| Имя | Что делает | Среднее время |
|---|---|---|
| `sync_stocks` | Полный цикл синхронизации остатков, 8 шагов: продажи Мешка → продажи YM → продажи WB → SB→Ozon push → Reconcile Ozon→SB + стоп Мешок → WF-C-3 публикация → SB→YM → SB→WB | ~3 мин |
| `sync_prices` | Цены: Ozon→SB → SB→Meshok → SB→WB → SB→YM, 4 шага | ~2-10 мин (зависит от Мешка) |
| `sync_all` | Остатки + цены, ~12 шагов последовательно | ~5-15 мин |

UI должен показывать человеческие названия:
- `sync_stocks` → «Остатки»
- `sync_prices` → «Цены»
- `sync_all` → «Всё целиком»

---

## 5. Требования к UI

### 5.1. Главная (`/`)

**Три карточки кнопок** — по одной на плейбук:

- Иконка + название (Остатки / Цены / Всё целиком)
- Под кнопкой: время последнего успешного прогона + статус (✅ 3 мин назад / ❌ ошибка)
- Кнопка disabled, если `get_active_runs()` содержит этот плейбук
- Клик → `trigger_playbook(...)` → если `enqueued` или `already_running` → открывается «Активный прогон»

**Под карточками — «Активный прогон» (если есть):**
- Название плейбука
- Прогресс-бар (done/total)
- Список шагов с их статусами (queued / running / done / failed / cancelled)
- Под каждым шагом в `failed` — спойлер с `error_message`
- Кнопка «Отменить» → `cancel_run(run_id)`

**Под активным — «История» (скроллируемая таблица):**
- Последние 20 прогонов
- Колонки: Когда | Плейбук | Статус | Длительность | Шаги (done/total)
- Клик по строке → модалка с полными деталями (get_run_status)

### 5.2. Обновление состояния

**Без polling.** Только Realtime:
- Подписка на `playbook_run` — ловим смену `status` (pending → running → completed/failed/cancelled)
- Подписка на `job_queue` — ловим смену `status` шагов активного прогона
- На каждое событие — ре-фетч `get_active_runs()` и `get_recent_runs(20)` (они дешёвые)
- Либо обновление состояния в React через payload.new

### 5.3. Стиль

- **Тёмная тема, плотная, таблично-ориентированная** (как Linear / Datadog / Supabase Studio)
- Не «лендинг», не «маркетинг». Это dev-tool.
- Моноширинные цифры для колонок времени и длительности
- Статусы цветом: queued — серый, running — синий с пульсацией, done — зелёный, failed — красный, cancelled — тёмно-серый

### 5.4. Auth (MVP)

**Bearer token через RLS не используем.** Для первого MVP доступ открыт — приложение защищается тем, что:
1. URL Vercel-деплоя никому не известен
2. anon-ключ Supabase в `.env` (без него UI ничего не покажет)
3. RPC-функции `SECURITY DEFINER` — не раскрывают данные напрямую

**Если в будущем потребуется auth** — добавим magic link через Supabase Auth + RLS. MVP без этого.

---

## 6. Стек и окружение

- **Next.js 14** (App Router)
- **TypeScript** (strict mode)
- **Tailwind CSS** + **shadcn/ui** (Dialog, Card, Button, Table, Badge, Progress)
- **`@supabase/supabase-js`** v2
- **Vercel** для продакшн-деплоя

### `.env.local` (не в git)
```bash
NEXT_PUBLIC_SUPABASE_URL=https://iavjkpzpkgepwcmhcxoq.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<запросить у Андрея>
```

### `.env.example` (в git)
```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

### `.gitignore` должен содержать
```
.env
.env.local
.env.*.local
!.env.example
node_modules/
.next/
.vercel/
```

---

## 7. Структура проекта (рекомендуемая)

```
vinyl-project/
├── src/
│   ├── app/
│   │   ├── page.tsx                    # Главная: кнопки + активный прогон + история
│   │   ├── layout.tsx                  # Root layout, темная тема
│   │   └── globals.css                 # Tailwind base + CSS-переменные для темы
│   ├── components/
│   │   ├── PlaybookButton.tsx          # Карточка-кнопка плейбука
│   │   ├── ActiveRun.tsx               # Блок активного прогона со списком шагов
│   │   ├── StepList.tsx                # Список шагов с иконками статусов
│   │   ├── RunHistory.tsx              # Таблица истории
│   │   ├── RunDetailsDialog.tsx        # Модалка с деталями прогона
│   │   └── ui/                         # shadcn/ui компоненты
│   ├── lib/
│   │   ├── supabase.ts                 # createClient(), единый инстанс
│   │   ├── types.ts                    # TypeScript-типы для RPC ответов
│   │   ├── rpc.ts                      # Обёртки над supabase.rpc() с типами
│   │   └── formatters.ts               # formatDuration, formatTime, statusLabel
│   └── hooks/
│       ├── useActiveRuns.ts            # useSWR + Realtime invalidation
│       ├── useRecentRuns.ts
│       └── useRunStatus.ts             # детали одного прогона
├── public/
├── .env.local                          # (не в git)
├── .env.example
├── .gitignore
├── next.config.js
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## 8. TypeScript-типы (для копирования в `src/lib/types.ts`)

```typescript
export type PlaybookName = 'sync_stocks' | 'sync_prices' | 'sync_all';

export type RunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type StepStatus =
  | 'queued'
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface ActiveRun {
  run_id: number;
  playbook_name: PlaybookName;
  status: RunStatus;
  triggered_by: string | null;
  started_at: string;
  steps_total: number;
  steps_done: number;
  steps_failed: number;
  steps_running: number;
}

export interface RecentRun {
  run_id: number;
  playbook_name: PlaybookName;
  status: RunStatus;
  triggered_by: string | null;
  started_at: string;
  finished_at: string | null;
  duration_sec: number | null;
  steps_total: number;
  steps_done: number;
  steps_failed: number;
}

export interface RunStep {
  job_id: number;
  step_order: number;
  label: string;
  status: StepStatus;
  run_after: string;
  claimed_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  attempt: number;
  max_attempts: number;
  error_message: string | null;
  duration_ms: number | null;
}

export interface RunDetails {
  run: {
    run_id: number;
    playbook_name: PlaybookName;
    status: RunStatus;
    triggered_by: string | null;
    started_at: string;
    finished_at: string | null;
    notes: string | null;
  };
  steps: RunStep[];
}

// trigger_playbook responses
export type TriggerResult =
  | { status: 'enqueued'; run_id: number; playbook_name: PlaybookName }
  | { status: 'already_running'; run_id: number; playbook_name: PlaybookName }
  | { status: 'error'; error: string; playbook_name?: string };

export type CancelResult =
  | {
      status: 'ok';
      run_id: number;
      cancelled_steps: number;
      running_steps_left: number;
      note: string;
    }
  | { status: 'error'; error: 'run_not_found' | 'not_active'; run_id: number };
```

---

## 9. Порядок разработки (рекомендуемый для CC)

1. **Инициализация.** `npx create-next-app@latest . --typescript --tailwind --app --no-src-dir=false` → настроить Tailwind, shadcn/ui init, установить supabase-js.
2. **Supabase client** (`src/lib/supabase.ts`) + типы (`src/lib/types.ts`).
3. **RPC-обёртки** (`src/lib/rpc.ts`) — типизированные функции-вызовы всех 5 RPC.
4. **Главная страница** — пустой скелет с тремя кнопками, без логики, просто UI.
5. **Хук `useRecentRuns`** + `useActiveRuns` — базовая загрузка без Realtime.
6. **Клик по кнопке** — вызов `trigger_playbook`, алерт на ошибку.
7. **Блок «Активный прогон»** — рендерим когда есть.
8. **Realtime-подписка** — инвалидация списков при событиях.
9. **Таблица истории** + модалка с деталями.
10. **Стили, полировка, адаптивность.**
11. **Deploy на Vercel** (Андрей делает сам через веб-UI).

---

## 10. Чего НЕ делать

- ❌ Не писать свой backend (FastAPI, Next.js API routes и т.п.). Всё идёт напрямую в Supabase.
- ❌ Не использовать `localStorage` / `sessionStorage` для sync-состояния — всё живёт в Supabase.
- ❌ Не делать polling (`setInterval`) — только Realtime.
- ❌ Не хардкодить имена плейбуков в разных местах — использовать `PlaybookName` и const-массив.
- ❌ Не тащить данные напрямую из `claude_meta.*` таблиц (кроме Realtime-подписки) — использовать только RPC.
- ❌ Не коммитить `.env.local`.
- ❌ Не запускать боевые воркфлоу при разработке — `trigger_playbook` на существующую Supabase реально запускает синхронизацию. Для тестов использовать `cancel_run` сразу после запуска, или добавить тестовый плейбук-пустышку (по согласованию с Андреем).

---

## 11. Ссылки на контекст

- **`CLAUDE.md`** — общий контекст проекта (бизнес, инфраструктура, правила). Раздел 19 содержит эту же задачу на верхнем уровне.
- **Supabase Dashboard** → SQL Editor для проверки состояния: `SELECT * FROM public.get_active_runs();`
- **Когда застрял** — показать проблему и кусок кода Claude в чате Claude.ai (тот же проект), где есть контекст всего бэкенда.
