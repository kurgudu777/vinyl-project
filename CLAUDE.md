# CLAUDE.md — проектный контекст для нового чата

Это файл-шпаргалка. Кладётся в Project Knowledge и в git-репозиторий проекта. На старте каждой сессии Claude читает его целиком, а также `state_current.md`. Большие API-доки и история сессий — по запросу.

⚠️ **В этом файле НЕТ секретов.** Все токены, API-ключи и пароли хранятся в:

- **Claude userMemories** — для AI-сессий (я помню их между чатами)
- **Supabase Vault** — для SQL-функций (`n8n_bridge_url`, `n8n_api_key`)
- **n8n Credentials** — для воркфлоу (Settings → Credentials в n8n UI)
- **`.env.local`** — для локальной разработки веб-интерфейса (не в git)
- **Vercel Environment Variables** — для продакшна веб-интерфейса

Никогда не коммить реальные ключи в этот файл и в git вообще.

## 0. Инструкции по общению (высший приоритет)

- Не беги вперёд. Двигайся пошагово, жди подтверждения каждого шага.
- Боевые воркфлоу — только по явному подтверждению или прямому указанию. Никаких самостоятельных правок в production.
- Любой новый воркфлоу в n8n через Bridge: обязательно Webhook trigger + `settings.availableInMCP: true`. Без этого — невидим из MCP.
- Следуй архитектурному промту (`prompt_resume_architecture.md`). Если отходим от него — сигнализируй явно.
- Стиль: русский в общении, английский в коде/SQL/JSON. Кратко, без воды. Код давать пошагово, нода за нодой.
- На старте сессии: читаю `state_current.md` и этот файл. `апи_мешок_concise.md` — если работаем с Мешком. Всё остальное (большие API-доки, `session_log`, `workflow_registry`) — только по запросу.
- Резюме сессии: по команде «запиши резюме сессии» → `INSERT INTO claude_meta.session_log (дата, topic, summary, tags)`.

## 1. Контекст проекта

Андрей ведёт автоматизированный маркетплейс винила на 4 площадках: Ozon, Wildberries (WB), Яндекс.Маркет (YM), Мешок. Центральный каталог — Supabase (`vinyl_catalog`). Автоматизация — n8n на Amvera. Управление через Telegram и Claude API Bridge.

Каталог (апрель 2026): ~1594 товара, ~915 в наличии. Все `condition='new'`. Мешок ~809 активных лотов.

## 2. Стек и идентификаторы (без секретов)

### Supabase
- Project ID: `iavjkpzpkgepwcmhcxoq`
- Хост: `iavjkpzpkgepwcmhcxoq.supabase.co`
- Боевая таблица: `public.vinyl_catalog`
- Тестовая: `public.vinyl_catalog_test`
- Служебная схема: `claude_meta` (не путать с `public`)
- **anon key:** → `userMemories` / `.env.local` как `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### Ozon
- **Боевой:** Client-Id `264820` · Api-Key → `userMemories` / n8n Credentials
- **Тест:** Client-Id `4007670` · Api-Key → `userMemories` / n8n Credentials
- Склады:
  - `22603964222000` — основной (цена ≥ 3801 ₽)
  - `22490597296000` — дополнительный (цена ≤ 3800 ₽)
- Выбор склада при пуше SB→Ozon — по цене товара

### Wildberries
- warehouseId: `186173`
- **Токен «Цены и скидки»:** → `userMemories` / n8n Credentials
- Токен для остатков — отдельный, хранится там же

### Яндекс.Маркет
- campaignId: `28867390`
- businessId: `18518066`
- Auth: заголовок `Api-Key:` (НЕ `Bearer`, НЕ `Authorization`)
- **Ключ:** → `userMemories` / n8n Credentials

### Мешок
- **Актуальный токен:** → `userMemories` / n8n Credentials
- ⚠️ Старые токены помечены в `userMemories` как obsolete, не использовать

### n8n
- Bridge (менеджер воркфлоу): workflowId `9t1fFvVypH81NTd1`, webhook `/webhook/claude-bridge`
- Bridge API key (no expiry, 15.04.2026): → Supabase Vault (`n8n_api_key`) + `userMemories`
- MCP connector: `https://kgd-kirgudu.amvera.io/mcp-server/http`
- Загрузка n8n-инструментов: `tool_search("n8n workflow")`

## 3. Принцип синхронизации остатков (критично)

1 физическая единица = 1 на каждой площадке (не суммируется).

- **Ozon = source of truth.** SB = зеркало последнего чтения Ozon.
- Продажа на WB/YM → декремент SB → пуш нового SB в Ozon.
- Reconcile читает Ozon → перезаписывает SB.
- SB→WB/YM = `SB − 1`, минимум 1.
- Если SB = 0 → 0 везде.

Примеры:
- Ozon=3 → WB=2, YM=2
- Ozon=1 → везде 1
- Ozon=0 → везде 0, на Мешке `stopSale`

Команда «синхронизируй остатки» = полный цикл: Reconcile v2 + Meshok delist + SB→WB + SB→YM. Всегда все площадки.

## 4. Схема `vinyl_catalog` (ключевые поля)

```
offer_id         integer PK (от Озона)
ozon_name        text
price            integer (основная цена, Ozon)
price_wb         integer
price_yandex     integer
price_meshok     integer
stock            integer
status_ozon      boolean
status_wb        boolean
status_yandex    boolean
status_meshok    boolean (ДИНАМИЧЕСКОЕ — управляется воркфлоу)
meshok_item_id   bigint
meshok_public    boolean (СТАТИЧЕСКОЕ — только ручная настройка, воркфлоу НЕ трогает)
genre_meshok     integer
condition        text (default 'new')
wb_chrt_id       bigint
wb_nm_id         bigint
wb_warehouse_id  bigint
cover_image      text
discogs_url      text
```

Семантика Мешок-полей:
- `meshok_public` — статическое, только руками. Означает «хотим ли вообще публиковать на Мешке».
- `status_meshok` — динамическое, управляется автоматически. Означает «лот сейчас активен».
- `meshok_item_id = NULL` → нужна первичная публикация (WF-C-3 `listItem`).
- `meshok_item_id` заполнен + `status=true` → активный лот.
- При росте `stock` → WF-C-3 подхватывает автоматически по фильтру.

## 5. Формулы цен

```
price_yandex = CEIL(price * 1.06 / 100) * 100
price_wb     = FLOOR(price * 0.97 / 100) * 100   (минимальная push-цена 1850 ₽, enforced только в WB_PUSH)
price_meshok = CEIL(price / 2.29 / 50) * 50
```

В PostgreSQL — всегда float деление (`/ 100.0`, не `/ 100`), иначе integer truncation.

Политика акций:
- **Ozon:** `auto_action_enabled: 'DISABLED'`, `price_strategy_enabled: 'DISABLED'`, `min_price = price`
- **WB:** `discount: 0`, работать с `discountedPrice` как ценой для покупателя
- **YM:** `discountBase` не передавать (вызывает 400)

## 6. Реестр воркфлоу

Полный реестр: `SELECT * FROM claude_meta.workflow_registry WHERE category='...'`. Ниже — ключевые.

### Синхронизация остатков

| Назначение | Workflow ID | Статус |
|---|---|---|
| Ozon→SB + Meshok delist при stock=0 (Reconcile v2) | `A7MlxZlN7NX5cpD4` | ✅ PRIMARY, MCP ✅ |
| SB→WB | `VJ8upmc0ruUwKKXC` | ✅ |
| SB→YM | `LM3qASEfVnHzoDfb` | ✅ |
| — | `k7WI293I07zQ35dL` | ⚠️ АРХИВ, не использовать |

### Синхронизация цен (всегда все 4 вместе)

| Назначение | Workflow ID |
|---|---|
| Ozon→SB prices | `DG7tgNjcQ0csMDa9` |
| SB→Meshok prices | `EWwu9e6S1koFFmwf` |
| SB→WB prices | `y5Y4dPRsvR7VGsoL` |
| SB→YM prices | `BdabSiHc40jRfQhm` |

### Мешок lifecycle

| Назначение | Workflow ID | Примечание |
|---|---|---|
| WF-C-1 «Отслеживание продаж мешок» | `HKcZ4w6zHdtM3RUZ` | Обнуляет `meshok_item_id` при продаже |
| WF-C-3 Meshok Publisher | `RW8kk2BHG10YRzmz` | ✅ MCP, republish через `listItem` |
| WF-C-2 (миграция описаний) | `dg6cUFGKCYES82lO` | Разовый, выполнен, на удаление |

## 7. Служебная инфраструктура

- `claude_meta.queue_tick()` — воркер очереди (pg_cron каждые 20с + `http` extension)
- **Reconcile snapshot-таблицы:** `reconcile_snapshot_ozon` / `_wb` / `_ym` + VIEW `reconcile_gaps` — кросс-платформенная сверка SKU
- **Дедуп заказов:** `public.processed_orders` с `UNIQUE (platform, order_id, COALESCE(offer_id, -1))`

## 8. Очередь синхронизации (20.04.2026)

**Claude НЕ оркестратор.** На команду «синхронизируй…»:

```sql
SELECT claude_meta.enqueue_playbook('sync_stocks');   -- или 'sync_prices' / 'sync_all'
```

Не вызывать `n8n:execute_workflow` напрямую. Воркер `queue_tick()` сам разберёт очередь.

**Playbooks:** `sync_stocks`, `sync_prices`, `sync_all`. На триггер → `SELECT FROM v_playbook_steps WHERE playbook_name=X ORDER BY step_order` → последовательное выполнение. Error policy: STOP + debug. Новые шаги: сначала построить/протестировать воркфлоу, потом `INSERT INTO playbook_step`.

## 9. Bridge Helpers (правка воркфлоу одной SQL-строкой)

### ⚠️ КРИТИЧЕСКОЕ ПРАВИЛО n8n API

`PUT /api/v1/workflows/{id}` тихо игнорирует изменения, если в payload есть что-то кроме `name`, `nodes`, `connections`, `settings`. HTTP 200, но ничего не применяется. `_bridge_update` сам фильтрует до whitelist.

### Высокоуровневые функции в `claude_meta`

| Функция | Назначение |
|---|---|
| `wf_list_nodes(wf_id)` | Список нод без payload |
| `wf_get_node(wf_id, node_name)` | JSON одной ноды |
| `wf_set_mcp(wf_id, enabled)` | Вкл/выкл `availableInMCP`, идемпотентно |
| `wf_patch_node_parameters(wf_id, node, patch::jsonb)` | Shallow merge в `parameters` |
| `wf_replace_node_code(wf_id, node, code)` | Замена `jsCode` в Code-ноде |
| `wf_replace_node_field(wf_id, node, path[], value::jsonb)` | Замена поля по jsonb-пути |

### Низкоуровневые

- `_bridge_get(wf_id) → jsonb`
- `_bridge_update(wf_id, payload::jsonb) → jsonb` (авто-фильтр)
- `_bridge_call(op, wf_id?, payload?, node_name?)` — `create`/`delete`/`activate`/`deactivate`

### Когда нужен Bridge get/update руками

- Массовые структурные правки (добавить/удалить ноды)
- Смена триггеров, переподключение нод

### Логирование

Каждый вызов пишется в `claude_meta.wf_edit_log` с `before_snapshot` / `after_snapshot` для отката.

### Где живут секреты Bridge

- `n8n_bridge_url` и `n8n_api_key` — в Supabase Vault (`vault.decrypted_secrets`)
- SQL-функции читают их через `vault.decrypted_secrets`
- В коде функций — только имя секрета, не значение
- Это эталонный паттерн, копируется для всех новых интеграций

## 10. Правила создания воркфлоу

- Webhook trigger обязателен (без него MCP не видит воркфлоу)
- `settings.availableInMCP: true` обязательно
- Именование: «текущее имя (код проекта)». Пример: `WF-C Meshok Lifecycle (WF-C)`
- Временные воркфлоу `_tmp_*` — удалять через Bridge (`operation: delete`) без подтверждения
- Не включать `active` при create (read-only поле)
- Ноды с credentials — не обновлять через Bridge (PUT стирает credentials), давать инструкцию для ручного редактирования

## 11. Технические паттерны и грабли

### n8n Code nodes

- `fetch` недоступен → `this.helpers.httpRequest`
- `new URL()` не работает → строковая конкатенация
- `httpRequest({body, json: true})` — авто-сериализация
- Возврат `[]` → downstream ноды не выполняются (используем для условного ветвления)
- `$node['SplitInBatches'].context.currentRunIndex` вызывает тихие падения — избегать, использовать `$input.all()`
- Manual Trigger не запускается через MCP — нужен Webhook или Schedule

### SplitInBatches v3 (контринтуитивно)

- Output 0 = Loop (тело цикла)
- Output 1 = Done (всё готово)

### Merge node v3

- `mergeByPosition` без явных полей падает молча
- Вместо — Code нода с `$input.all()[0]` / `$input.all()[1]`

### HTTP Request v4.2+

- Параметры URL inline (`?select=*&offer_id=eq.123`), НЕ через `sendQuery`

### Supabase

- Max 1000 строк/запрос → пагинация offset
- PATCH с `?offer_id=eq.undefined` → 400
- Массовые апдейты (>500 строк) → только RPC, иначе timeout
- `Prefer: return=minimal` → ответ `[]` на успех (не ошибка)
- Большие IN-списки → через Supabase MCP в SQL, не в query string
- `pg_net` не работает внутри транзакции → для синхронного HTTP из SQL используем `http` extension

### CHANGED_ONLY фильтр

Перед SB_UPDATE обязательный фильтр изменённых записей — иначе timeout.

### Проверка Ozon stocks

```js
ozonStocks.hasOwnProperty(offerId)   // ✅ корректно обрабатывает отсутствующие товары
ozonStocks[offerId] ?? 0              // ❌ некорректно
```

## 12. Ozon API (паттерны)

### Фото

- `/v2/product/pictures/info` требует `product_id` (integer), НЕ `offer_id`
- Маппинг `offer_id → product_id`: сначала `POST /v3/product/info/list`
- Ответ: `primary_photo` (массив, 1 URL) + `photo` (дополнительные). Для YM: объединить и дедуплицировать

### Stocks

- `/v4/product/info/stocks` — cursor pagination, `limit 200`
- `/v1/product/import/stocks` — пуш остатков

### Общее

Raw body + `JSON.stringify()`, заголовки `Client-Id` + `Api-Key`.

## 13. YM API (паттерны)

- **Auth:** `Api-Key: …` (не `Bearer`)
- Pull цен: `POST /v2/businesses/18518066/offer-mappings` с `{offerIds: chunk}` по 100 ID
- НЕ использовать `/offer-prices` без фильтра — возвращает 7500+ чужих позиций
- Фото: `POST /v2/businesses/18518066/offer-mappings/update`
- Частичный `pictures[]` перезаписывает ВСЕ фото — всегда слать полный желаемый массив
- Батч лимит 100, 500мс между батчами (ошибка 420 = rate limit)
- Возврат асинхронный (`status: OK` = принято, не применено)
- Rate limit 420 при ~30+ быстрых запросов

## 14. WB API (паттерны)

- Токен «Цены и скидки» — отдельный от основного
- `discount: 0`, работать с `discountedPrice`
- Stocks: `/api/v3/stocks/{warehouseId}` по `chrtId` (маппинг через `wb_chrt_id`)

## 15. Мешок API (паттерны)

- 1 req/sec для `updateItem`
- 429 при batch `stopSale` → `SplitInBatches(1)` + `Wait 1-2с`
- Авто-репост лотов включён на аккаунте: при истечении (30 дней) Мешок перевыставляет с ТЕМ ЖЕ `meshok_item_id`. `relistItem` через API не нужен.
- После продажи: WF-C-1 обнуляет `meshok_item_id` → WF-C-3 републикует через `listItem` с новым ID
- `getUnsoldFinishedItemList`: `endDateTime` — московское время (MSK, UTC+3), добавлять `+03:00` перед парсингом. Окно 36ч (не 24), чтобы поймать batch-истечения.
- Цена: нельзя менять прямо — снять лот + перевыставить с новой ценой

## 16. Поиск API-документации

Большие API-доки НЕ в Project Knowledge (экономия токенов). Живут в Supabase:

```sql
-- Поиск эндпоинтов
SELECT * FROM search_api_docs(p_tag := 'price');
SELECT * FROM search_api_docs(p_platform := 'ozon', p_tag := 'stock');
SELECT * FROM search_api_docs(p_search := 'offer-mappings');

-- Полный текст раздела (только Мешок, 17 разделов)
SELECT * FROM get_api_details('meshok', 'listItem');
```

Теги: `stock`, `price`, `photo`, `order`, `list`, `info`, `pull`, `push`, `pagination`, `sold`, `unsold`, `stop`, `relist`, `publish`, `update`, `delete`, `account`, `content`, `fbs`, `statistics`, `warehouse`, `stats`.

Если эндпоинт не нашёлся в индексе — значит в проекте не используется. Полные доки в `/mnt/project/ozon_api_docs.txt`, `/Api_YM.txt`, `/wb_api_*.txt` — читать view только по запросу.

Шпаргалка Мешок: `/mnt/project/апи_мешок_concise.md` (1.5k токенов вместо 11k).

## 17. Безопасность секретов (правила для проекта)

**Секреты НИКОГДА не попадают в git.** Канонические места хранения:

| Где используется | Где хранится |
|---|---|
| Claude-сессии (я помню между чатами) | `userMemories` |
| SQL-функции Supabase (Bridge, интеграции) | Supabase Vault (`vault.decrypted_secrets`) |
| n8n воркфлоу | n8n Credentials (Settings → Credentials) |
| Локальная разработка веб-интерфейса | `.env.local` (в `.gitignore`) |
| Продакшн веб-интерфейса | Vercel Environment Variables |

`.gitignore` проекта должен содержать:

```gitignore
.env
.env.local
.env.*.local
!.env.example
node_modules/
.next/
.vscode/
.idea/
*.log
.DS_Store
```

`.env.example` (в git, как шаблон) содержит имена переменных без значений:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

При необходимости нового токена в коде:
1. Добавить в `.env.local` с реальным значением
2. Добавить в `.env.example` с плейсхолдером
3. В продакшне — добавить через Vercel UI
4. Никогда не писать значение в коде/коммитах

## 18. Протокол старта сессии

1. Прочитать `state_current.md`
2. Прочитать этот `CLAUDE.md`
3. Если работаем с Мешком — прочитать `апи_мешок_concise.md`
4. Остальное (`prompt_resume_architecture.md`, `session_log`, `workflow_registry`, полные API-доки) — только по явному запросу
5. Claude автономно читает/правит любые воркфлоу через Bridge без вовлечения пользователя; может включать `availableInMCP: true` через Bridge update

## 19. На горизонте (pending)

### Технический долг

- [ ] Дропнуть колонку `meshok_desc_updated` (временная, 802 записи обновлены)
- [ ] Удалить WF-C-2 `dg6cUFGKCYES82lO` (разовый, выполнен)
- [ ] Активировать Schedule Trigger на Reconcile v2
- [ ] Разобраться со статусом WB Sales workflow `Us0qkxTcAJAYTeJ9` (деактивирован 20.04)

### Веб-интерфейс синхронизации (продумано 21.04, не начато)

Next.js на Vercel + Supabase RPC + Realtime. Три кнопки: «Остатки / Цены / Всё», прогресс шагов в реальном времени, история прогонов. Claude выпадает из цепочки запуска — остаётся только для разработки и отладки. Подробности — в обсуждении от 21.04 и в архитектурной дискуссии.

### Архитектурная дискуссия (отложено)

Андрей обдумывает перенос оркестрации синхронизации из n8n в отдельный код: Next.js фронт читает Supabase напрямую + FastAPI бэкенд на Amvera с domain-level эндпоинтами (`POST /api/sync/full-cycle`). n8n остаётся только для реактивных воркфлоу (WF-C-1, WF-C-3). Решение не принято.

### Новые воркфлоу (не начаты)

- [ ] WF-D-3 / WF-D-3r — WB цены (pull актуальных, токен «Цены и скидки»)
- [ ] WF-D-4 / WF-D-4r — Мешок цены (`updateItem`, 1 req/sec)
- [ ] WF-C аналог для WB — детектирование заказов FBS (`/api/v1/supplier/orders`)
- [ ] WF-C аналог для YM — заказы `PENDING` → обнулять stock, `CANCELLED` → восстанавливать
