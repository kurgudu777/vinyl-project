# sync_ui_plan.md — ТЗ: Веб-интерфейс синхронизации

> Документ читается Claude Code на старте работы над Next.js-приложением.
> Вся backend-часть (RPC в Supabase, Realtime publication) уже готова — см. раздел «Что уже готово».

---

## 1. Зачем это нужно

Сейчас запуск синхронизации остатков/цен магазина винила происходит по команде в чате Claude.ai («синхронизируй остатки» → Claude вызывает `claude_meta.enqueue_playbook`). Хочется заменить Claude в этой цепочке простым веб-интерфейсом:

- **Три кнопки**: «Остатки», «Цены», «Всё целиком»
- **Нажатие** → RPC `trigger_playbook` ставит задачу в очередь
- **UI показывает прогресс** шагов в реальном времени через Supabase Realtime
- **История запусков** — последние 20, с деталями
- **Режим «по шагам»** (по клику на чекбокс) — можно запустить любой шаг отдельно
- **Блокировка по конфликту** — см. раздел 5.2

Результат: открываешь страницу с телефона/компа, жмёшь кнопку, смотришь как капают шаги. Без Claude-чата.

---

## 2. Архитектура

```
┌──────────────────┐   RPC trigger_playbook()    ┌────────────────────┐
│  Next.js UI      │ ──────────────────────────► │ Supabase           │
│  (Vercel)        │   trigger_single_step()     │  claude_meta.      │
│                  │                              │  job_queue +       │
│                  │ ◄── Realtime subscribe ──── │  playbook_run      │
│                  │     on job_queue, run       │                    │
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
Запускает плейбук целиком. Блокируется **только конфликтующим** активным run (см. раздел 5.2).

Возвращает:
```json
// Успех:
{ "status": "enqueued", "run_id": 19, "playbook_name": "sync_stocks" }

// Конфликт:
{
  "status": "already_running",
  "active_run_id": 18,
  "active_playbook": "sync_stocks",
  "reason": "conflict_with_sync_stocks"
}

// Неизвестный плейбук:
{ "status": "error", "error": "playbook_not_found", "playbook_name": "xxx" }
```

Допустимые имена: **`sync_stocks`**, **`sync_prices`**, **`sync_all`**.

#### `trigger_single_step(p_playbook_name text, p_step_order integer, p_triggered_by text DEFAULT 'web_ui') → jsonb`
Запускает один шаг плейбука отдельно, без `depends_on` на остальные.

- Создаёт `playbook_run` с именем `<playbook>__step_<N>` — UI по двойному подчёркиванию отличает одиночный запуск от полного
- Пропускает шаги 1..N−1 (это намеренно — фича для дебага/точечных операций)
- Блокируется **конфликтующим** активным run (одиночный шаг конфликтует с тем же, с чем конфликтует его родительский плейбук)

Возвращает:
```json
// Успех:
{
  "status": "enqueued",
  "run_id": 25,
  "job_id": 130,
  "playbook_name": "sync_stocks",
  "step_order": 5,
  "label": "SB→Ozon push: ..."
}

// Конфликт:
{
  "status": "already_running",
  "active_run_id": 24,
  "active_playbook": "sync_all",
  "reason": "conflict_with_sync_all"
}

// Шаг не найден:
{ "status": "error", "error": "step_not_found", "playbook_name": "sync_stocks", "step_order": 99 }
```

#### `is_playbook_available(p_playbook_name text) → boolean`
`true` если этот плейбук (или любой его шаг) можно запустить прямо сейчас — нет конфликтующих активных runs. Используется для блокировки каждой карточки независимо.

#### `get_playbook_steps(p_playbook_name text DEFAULT NULL) → table`
Каталог шагов для раскрывающихся списков. Без аргумента — все шаги, с аргументом — только указанный плейбук.

Колонки:
| Колонка | Тип | Примечание |
|---|---|---|
| `playbook_name` | text | `sync_stocks` / `sync_prices` / `sync_all` |
| `step_order` | int | 1..N |
| `label` | text | Русский текст шага, можно показывать как есть |
| `workflow_id` | text | n8n workflow ID |
| `required` | boolean | false = шаг необязательный |

#### `get_active_runs() → table`
Список активных прогонов (running/pending) с агрегатами по шагам.

Колонки:
| Колонка | Тип |
|---|---|
| `run_id` | bigint |
| `playbook_name` | text (может быть `sync_stocks__step_5` для одиночных шагов) |
| `status` | text |
| `triggered_by` | text |
| `started_at` | timestamptz |
| `steps_total` | int |
| `steps_done` | int |
| `steps_failed` | int |
| `steps_running` | int |

#### `get_run_status(p_run_id bigint) → jsonb`
Детали прогона: `playbook_run` + массив шагов.

```json
{
  "run": {
    "run_id": 18,
    "playbook_name": "sync_stocks",
    "status": "completed",
    "triggered_by": "web_ui",
    "started_at": "...",
    "finished_at": "...",
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
  ]
}
```

#### `get_recent_runs(p_limit integer DEFAULT 20) → table`
Лента последних запусков. Макс 100.

| Колонка | Тип |
|---|---|
| `run_id` | bigint |
| `playbook_name` | text (может быть с суффиксом `__step_N`) |
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

```json
{ "status": "ok", "run_id": 18, "cancelled_steps": 3, "running_steps_left": 1, "note": "..." }
// либо:
{ "status": "error", "error": "run_not_found" | "not_active", "run_id": 18 }
```

### Realtime
Publication `supabase_realtime` включает:
- `claude_meta.job_queue`
- `claude_meta.playbook_run`

SELECT на обе таблицы выдан роли `anon`. Подписка:

```typescript
supabase
  .channel('sync_ui')
  .on('postgres_changes',
      { event: '*', schema: 'claude_meta', table: 'job_queue' },
      (payload) => { /* инвалидировать активные */ })
  .on('postgres_changes',
      { event: '*', schema: 'claude_meta', table: 'playbook_run' },
      (payload) => { /* инвалидировать списки и доступность плейбуков */ })
  .subscribe()
```

---

## 4. Справочник плейбуков (для UI-лейблов)

| Имя | UI-название | Количество шагов | Среднее время |
|---|---|---|---|
| `sync_stocks` | «Остатки» | 9 | ~3 мин |
| `sync_prices` | «Цены» | 4 | ~2-10 мин |
| `sync_all` | «Всё целиком» | 12 | ~5-15 мин |

Имена плейбуков типа `sync_stocks__step_5` (с двойным подчёркиванием) означают одиночный запуск. UI парсит и показывает как «Остатки: шаг 5» или по label шага.

---

## 5. Требования к UI

### 5.1. Главная (`/`)

**Три карточки** — по одной на плейбук. Каждая имеет два режима.

**Обычный режим (чекбокс «По шагам» снят — состояние по умолчанию):**

```
┌──────────────────────────────────────────┐
│ ОСТАТКИ                                  │
│ 9 шагов · ~3 мин                         │
│ Последний запуск: 2ч назад ✅            │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │      Запустить целиком             │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ☐ По шагам                         (▼)  │   ← чекбокс + стрелка (disabled)
└──────────────────────────────────────────┘
```

**Режим «По шагам» (чекбокс включён):**
Стрелка ▼ становится активной. Клик по стрелке разворачивает список шагов:

```
┌──────────────────────────────────────────┐
│ ОСТАТКИ                                  │
│ 9 шагов · ~3 мин                         │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │      Запустить целиком             │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ☑ По шагам                         (▲)  │   ← стрелка активна
│  ──────────────────────────────────────  │
│  1. Ozon→SB Pull Only (WF-A0)       [▶]  │
│  2. Продажи Мешка→SB: WF-C-1        [▶]  │
│  3. Sales YM→SB                     [▶]  │
│  4. Sales WB→SB                     [▶]  │
│  5. SB→Ozon push                    [▶]  │
│  6. Reconcile v2                    [▶]  │
│  7. WF-C-3 Публикатор               [▶]  │
│  8. Остатки SB → YM                 [▶]  │
│  9. Остатки SB → WB                 [▶]  │
└──────────────────────────────────────────┘
```

**Поведение чекбокса + стрелки:**
- Чекбокс «По шагам» по умолчанию снят
- Когда снят — стрелка серая, неактивная (`disabled`, `cursor-not-allowed`, `opacity-40`), список свёрнут и не раскрывается
- Когда включён — стрелка кликабельна, открывает/закрывает список
- Снятие чекбокса при открытом списке — автоматически сворачивает список
- Состояние чекбокса — локальный React state, не сохраняется в storage (при перезагрузке страницы сброс — это намеренно)

**Почему так:** защита от случайного раскрытия списка на мобиле (иначе палец легко попадает на стрелку и вываливается простыня шагов). Чекбокс делает намерение «я хочу режим дебага» явным.

### 5.2. Блокировка по конфликту

**Матрица конфликтов плейбуков:**

| Идёт ↓ / Запускаем → | `sync_stocks` | `sync_prices` | `sync_all` |
|---|:---:|:---:|:---:|
| **`sync_stocks`** | ❌ | ✅ | ❌ |
| **`sync_prices`** | ✅ | ❌ | ❌ |
| **`sync_all`** | ❌ | ❌ | ❌ |

Логика:
- `sync_all` конфликтует со всем (пересекается с остатками и ценами)
- `sync_stocks` и `sync_prices` **совместимы** между собой (работают с разными целями)
- Нельзя запустить плейбук дважды параллельно

**Одиночные шаги** проверяются по корневому плейбуку: шаг `sync_stocks__step_5` конфликтует с тем же, с чем конфликтует `sync_stocks`.

**Реализация на стороне RPC** — автоматически. UI просто показывает ответ:
- `status: 'enqueued'` → всё ок
- `status: 'already_running'` → кнопка остаётся disabled (показываем почему)

**UI-состояние карточки:**

Каждая карточка держит собственный флаг доступности. Получить:
```typescript
await rpc.isPlaybookAvailable('sync_stocks')  // boolean
```

Или через список активных runs: для карточки `sync_stocks` кнопка disabled если в `get_active_runs()` есть run с `playbook_root === 'sync_stocks' || 'sync_all'`.

Когда заблокирована — под кнопкой «Запустить целиком» появляется текст: «Идёт «Всё целиком», подождите».

### 5.3. Защита от двойного клика

На клик любой кнопки запуска:
1. Кнопка моментально становится `disabled` (локальный state `isTriggering`)
2. Вызов RPC (обычно 100-300мс)
3. После ответа:
   - `status === 'enqueued'` → кнопка остаётся disabled (теперь из-за конфликта от Realtime), появляется блок «Текущий запуск»
   - `status === 'already_running'` → всплывающее уведомление, кнопка разблокируется (но сразу снова заблокируется из-за Realtime-обновления)
   - `status === 'error'` → уведомление с текстом ошибки, кнопка разблокируется

### 5.4. Визуальный feedback запуска

Карточка плейбука, которая сейчас запущена (или одиночный шаг которой запущен):
- Фон меняется на `bg-blue-950/30 border-blue-900`
- Под заголовком — прогресс «Шаг 3 из 9 · 00:42» (из `get_active_runs`)
- После завершения — карточка возвращается в обычный цвет
- Если завершилась с ошибкой — короткая вспышка `bg-red-950/30`, потом обычный цвет

Для одиночного шага — выделяется конкретная строка шага (синий фон), а не вся карточка.

### 5.5. Блок «Текущий запуск»

Под карточками, если есть активный run:
- Название (плейбук или «Остатки: шаг 5»)
- Прогресс-бар (done/total)
- Список шагов со статусами (queued / running / done / failed / cancelled)
- Под шагом в `failed` — спойлер с `error_message`
- Кнопка «Отменить» → `cancel_run(run_id)`

При параллельных запусках (`sync_stocks` + `sync_prices`) — показываем **оба** блока «Текущий запуск».

### 5.6. Блок «История»

Скроллируемая таблица последних 20 запусков:
- Колонки: Когда | Что | Статус | Длительность | Шаги (done/total)
- «Что» — человеческое название: `sync_stocks` → «Остатки», `sync_stocks__step_5` → «Остатки: шаг 5»
- Клик по строке → модалка с полными деталями (`get_run_status`)

### 5.7. Обновление состояния

**Только Realtime, без polling:**
- Подписка на `playbook_run` — ловим смены статуса
- Подписка на `job_queue` — ловим смены статуса шагов
- На каждое событие — ре-фетч `get_active_runs()` и `get_recent_runs(20)`
- Доступность плейбуков пересчитывается из `get_active_runs` на клиенте (матрица конфликтов дублируется в JS-константе)

### 5.8. Стиль

- **Тёмная тема, плотная, таблично-ориентированная** (как Linear / Datadog / Supabase Studio)
- Не «лендинг», не «маркетинг». Это dev-tool.
- Моноширинные цифры для колонок времени и длительности
- Статусы цветом: queued — серый, running — синий с пульсацией, done — зелёный, failed — красный, cancelled — тёмно-серый
- Адаптивность: mobile — карточки в столбик, desktop — grid 3 колонки
- Контраст карточек: `bg-neutral-900 border-neutral-800` поверх `bg-neutral-950`
- Переходы: `transition-colors duration-150`, `active:scale-[0.98]`

### 5.9. Auth (MVP)

**Без auth.** Защита на MVP держится на:
1. URL Vercel-деплоя никому не известен
2. anon-ключ Supabase в `.env` (без него UI ничего не покажет)
3. RPC-функции `SECURITY DEFINER` — не раскрывают таблицы напрямую

Если в будущем потребуется — добавим magic link + RLS.

---

## 6. Стек и окружение

- **Next.js 14** (App Router)
- **TypeScript** (strict mode)
- **Tailwind CSS** + **shadcn/ui** (Dialog, Button, Badge, Progress, Checkbox)
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

---

## 7. Структура проекта

```
vinyl-project/
├── src/
│   ├── app/
│   │   ├── page.tsx                    # Главная: карточки + активный запуск + история
│   │   ├── layout.tsx                  # Root layout, тёмная тема
│   │   └── globals.css
│   ├── components/
│   │   ├── PlaybookCard.tsx            # Карточка плейбука с чекбоксом и раскрытием
│   │   ├── StepList.tsx                # Список шагов (показывается когда checkbox=on)
│   │   ├── ActiveRun.tsx               # Блок «Текущий запуск»
│   │   ├── RunHistory.tsx              # Таблица истории
│   │   ├── RunDetailsDialog.tsx        # Модалка с деталями
│   │   └── ui/                         # shadcn/ui
│   ├── lib/
│   │   ├── supabase.ts                 # createClient(), singleton
│   │   ├── types.ts                    # TypeScript-типы
│   │   ├── rpc.ts                      # Типизированные обёртки
│   │   ├── conflict.ts                 # isPlaybookBlocked() — JS-копия матрицы конфликтов
│   │   └── formatters.ts               # formatDuration, formatTime, playbookLabel
│   └── hooks/
│       ├── useActiveRuns.ts
│       ├── useRecentRuns.ts
│       ├── usePlaybookSteps.ts
│       └── useRunStatus.ts
├── public/
├── .env.local                          # (не в git)
├── .env.example
├── .gitignore
└── package.json
```

---

## 8. TypeScript-типы (для `src/lib/types.ts`)

```typescript
export type PlaybookName = 'sync_stocks' | 'sync_prices' | 'sync_all';

export type RunStatus =
  | 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export type StepStatus =
  | 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

// run.playbook_name может быть PlaybookName ИЛИ "<PlaybookName>__step_<N>"
// — оставляем string для гибкости
export interface ActiveRun {
  run_id: number;
  playbook_name: string;
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
  playbook_name: string;
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
    playbook_name: string;
    status: RunStatus;
    triggered_by: string | null;
    started_at: string;
    finished_at: string | null;
    notes: string | null;
  };
  steps: RunStep[];
}

export interface PlaybookStep {
  playbook_name: PlaybookName;
  step_order: number;
  label: string;
  workflow_id: string;
  required: boolean;
}

export type TriggerResult =
  | { status: 'enqueued'; run_id: number; playbook_name: PlaybookName }
  | {
      status: 'already_running';
      active_run_id: number;
      active_playbook: string;
      reason: string;
    }
  | { status: 'error'; error: string; playbook_name?: string };

export type TriggerStepResult =
  | {
      status: 'enqueued';
      run_id: number;
      job_id: number;
      playbook_name: PlaybookName;
      step_order: number;
      label: string;
    }
  | {
      status: 'already_running';
      active_run_id: number;
      active_playbook: string;
      reason: string;
    }
  | {
      status: 'error';
      error: 'step_not_found' | 'webhook_path_missing';
      playbook_name: string;
      step_order: number;
    };

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

## 8.1. Матрица конфликтов (для `src/lib/conflict.ts`)

Клиентская копия правил блокировки — чтобы UI мог дизэйблить кнопки без лишнего round-trip к БД. Серверная проверка в `trigger_*` RPC остаётся авторитетной (на случай гонок).

```typescript
import type { PlaybookName, ActiveRun } from './types';

/**
 * Вернуть корень плейбука из имени run'а.
 * 'sync_stocks__step_5' → 'sync_stocks'
 * 'sync_all'            → 'sync_all'
 */
export function playbookRoot(name: string): string {
  return name.split('__step_')[0];
}

/**
 * Конфликтуют ли два плейбука между собой (симметрично).
 * Правила:
 *   - одинаковые имена конфликтуют
 *   - sync_all конфликтует со всем
 */
export function playbooksConflict(a: string, b: string): boolean {
  return a === b || a === 'sync_all' || b === 'sync_all';
}

/**
 * Можно ли запустить target прямо сейчас,
 * учитывая массив активных прогонов.
 */
export function isPlaybookAvailable(
  target: PlaybookName,
  activeRuns: ActiveRun[]
): boolean {
  return !activeRuns.some(r =>
    playbooksConflict(playbookRoot(r.playbook_name), target)
  );
}
```

---

## 9. Порядок разработки

1. ✅ **Инициализация.** `create-next-app` в корне репо.
2. ✅ **Supabase client** + **types** + **RPC-обёртки**.
3. ✅ **Главная страница (skeleton)** — три карточки, тёмная тема, адаптивность.
4. **Хуки** `useRecentRuns`, `useActiveRuns`, `usePlaybookSteps`.
5. **Матрица конфликтов** `src/lib/conflict.ts` + использование `isPlaybookAvailable()` для disabled-состояний кнопок.
6. **Кнопки «Запустить целиком»** — реальный вызов `triggerPlaybook` + обработка ответов + защита от двойного клика.
7. **Чекбокс «По шагам» + стрелка** — локальный state `showSteps: Record<PlaybookName, boolean>`. Стрелка disabled пока checkbox false. При сворачивании через snятие checkbox — список тоже сворачивается.
8. **Раскрытие карточек** — список шагов из `usePlaybookSteps`, кнопки «▶» → `triggerSingleStep`. Дизэйбл кнопок шагов по той же матрице конфликтов (для шагов проверяется корневой плейбук).
9. **Блок «Текущий запуск»** — имя + прогресс + список шагов + «Отменить». Может быть два одновременно (stocks + prices).
10. **Блок «История»** — таблица из `useRecentRuns`.
11. **Realtime-подписка** — инвалидация всех списков при событиях.
12. **Модалка деталей** — `RunDetailsDialog` через shadcn/ui Dialog.
13. **Стилистика и полировка.**
14. **Deploy на Vercel** (Андрей сам).

---

## 10. Чего НЕ делать

- ❌ Не писать свой backend. Всё идёт напрямую в Supabase.
- ❌ Не использовать `localStorage` / `sessionStorage` для состояния чекбоксов и UI — это контролируемо reset-ом при reload.
- ❌ Не делать polling (`setInterval`) — только Realtime.
- ❌ Не хардкодить имена плейбуков в разных местах — использовать `PlaybookName` и const-массив.
- ❌ Не тащить данные напрямую из `claude_meta.*` таблиц (кроме Realtime) — только через RPC.
- ❌ Не коммитить `.env.local`.
- ❌ **Не вызывать `triggerPlaybook` / `triggerSingleStep` из своего окружения для теста** — это запускает боевую синхронизацию на реальные маркетплейсы.

---

## 11. Ссылки на контекст

- **`CLAUDE.md`** — общий контекст проекта. Раздел 19.
- **Supabase Dashboard → SQL Editor** для проверки: `SELECT * FROM public.get_active_runs();`
- **Когда застрял** — показать проблему и кусок кода в чате Claude.ai (тот же проект).
