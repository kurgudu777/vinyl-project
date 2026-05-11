-- Сводное уведомление по итогам sync_stocks / sync_all.
--
-- Идея: фиксируем срез vinyl_catalog в начале playbook_run (snapshot_pre),
-- в конце сравниваем с текущим состоянием и формируем одно Telegram-сообщение
-- с конкретными изменениями. Боевые workflow не правим.
--
-- Состав:
--   1. ALTER playbook_run + snapshot_pre jsonb
--   2. CREATE OR REPLACE enqueue_playbook — заполняет snapshot_pre для sync_*
--   3. CREATE OR REPLACE sync_summary_format(run_id) RETURNS text
--   4. (отдельно, после создания n8n workflow) INSERT INTO playbook_step

-- ── 1. Колонка для снапшота ───────────────────────────────────────────────────
ALTER TABLE claude_meta.playbook_run
  ADD COLUMN IF NOT EXISTS snapshot_pre jsonb;

COMMENT ON COLUMN claude_meta.playbook_run.snapshot_pre IS
  'Срез vinyl_catalog (offer_id → {s,o,w,y,m}) на момент старта sync_* плейбука. Используется sync_summary_format.';

-- ── 2. enqueue_playbook: ставим snapshot для sync_* плейбуков ─────────────────
CREATE OR REPLACE FUNCTION claude_meta.enqueue_playbook(
  p_playbook text,
  p_triggered_by text DEFAULT 'claude'::text
)
RETURNS bigint
LANGUAGE plpgsql
AS $function$
DECLARE
  v_run_id      bigint;
  v_step        record;
  v_prev_job_id bigint := NULL;
  v_job_id      bigint;
BEGIN
  INSERT INTO claude_meta.playbook_run(playbook_name, status, triggered_by)
  VALUES (p_playbook, 'running', p_triggered_by)
  RETURNING run_id INTO v_run_id;

  IF p_playbook LIKE 'sync_%' THEN
    UPDATE claude_meta.playbook_run
    SET snapshot_pre = (
      SELECT jsonb_object_agg(
        offer_id::text,
        jsonb_build_object(
          's', stock,
          'o', status_ozon,
          'w', status_wb,
          'y', status_yandex,
          'm', status_meshok
        )
      )
      FROM public.vinyl_catalog
    )
    WHERE run_id = v_run_id;
  END IF;

  FOR v_step IN
    SELECT step_order, label, workflow_id, webhook_path, http_method, post_delay_seconds
    FROM claude_meta.playbook_step
    WHERE playbook_name = p_playbook
    ORDER BY step_order
  LOOP
    IF v_step.webhook_path IS NULL THEN
      RAISE EXCEPTION 'Step % of %: webhook_path is NULL', v_step.step_order, p_playbook;
    END IF;

    INSERT INTO claude_meta.job_queue(
      run_id, step_order, label, job_type, payload, depends_on
    ) VALUES (
      v_run_id,
      v_step.step_order,
      v_step.label,
      'workflow_webhook',
      jsonb_build_object(
        'workflow_id',         v_step.workflow_id,
        'webhook_path',        v_step.webhook_path,
        'http_method',         COALESCE(v_step.http_method, 'GET'),
        'post_delay_seconds',  COALESCE(v_step.post_delay_seconds, 0)
      ),
      CASE WHEN v_prev_job_id IS NULL THEN '{}'::bigint[]
           ELSE ARRAY[v_prev_job_id] END
    ) RETURNING job_id INTO v_job_id;

    v_prev_job_id := v_job_id;
  END LOOP;

  RETURN v_run_id;
END;
$function$;

-- ── 3. Форматирование сводки ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION claude_meta.sync_summary_format(p_run_id bigint DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
VOLATILE
AS $function$
DECLARE
  v_run         claude_meta.playbook_run%ROWTYPE;
  v_max         int := 20;       -- кап на секцию (Telegram limit 4096)
  v_title_cut   int := 50;
  v_msg         text;

  v_inc_count   int := 0;
  v_inc_units   int := 0;
  v_inc_list    text;
  v_dec_count   int := 0;
  v_dec_units   int := 0;
  v_dec_list    text;
  v_sale_count  int := 0;
  v_sale_units  int := 0;
  v_sale_list   text;
  v_off_ozon    int := 0;
  v_off_wb      int := 0;
  v_off_ym      int := 0;
  v_off_mesh    int := 0;
  v_off_total   int := 0;
  v_off_list    text;
  v_duration_s  int;
  v_duration    text;
BEGIN
  IF p_run_id IS NULL THEN
    SELECT * INTO v_run
    FROM claude_meta.playbook_run
    WHERE playbook_name LIKE 'sync_%' AND snapshot_pre IS NOT NULL
    ORDER BY started_at DESC LIMIT 1;
  ELSE
    SELECT * INTO v_run FROM claude_meta.playbook_run WHERE run_id = p_run_id;
  END IF;

  IF NOT FOUND OR v_run.snapshot_pre IS NULL THEN
    RETURN '⚠️ Сводка синхронизации недоступна (snapshot_pre пуст)';
  END IF;

  -- Промежуточная таблица per-offer дельт
  CREATE TEMP TABLE _sync_diff ON COMMIT DROP AS
  WITH pre AS (
    SELECT (key)::int                AS offer_id,
           (value->>'s')::int        AS stock,
           (value->>'o')::boolean    AS s_o,
           (value->>'w')::boolean    AS s_w,
           (value->>'y')::boolean    AS s_y,
           (value->>'m')::boolean    AS s_m
    FROM jsonb_each(v_run.snapshot_pre)
  ),
  sold AS (
    SELECT offer_id, SUM(quantity)::int AS qty
    FROM public.processed_orders
    WHERE processed_at >= v_run.started_at
    GROUP BY offer_id
  )
  SELECT
    n.offer_id,
    LEFT(COALESCE(NULLIF(TRIM(n.ozon_name), ''), '—'), v_title_cut) AS title,
    p.stock                              AS s_pre,
    n.stock                              AS s_now,
    p.s_o   AS o_pre, n.status_ozon      AS o_now,
    p.s_w   AS w_pre, n.status_wb        AS w_now,
    p.s_y   AS y_pre, n.status_yandex    AS y_now,
    p.s_m   AS m_pre, n.status_meshok    AS m_now,
    COALESCE(s.qty, 0)                   AS sold
  FROM pre p
  INNER JOIN public.vinyl_catalog n ON n.offer_id = p.offer_id
  LEFT  JOIN sold s ON s.offer_id = p.offer_id;

  -- ── Section A: Увеличены остатки ─────────────────────────────────────────
  SELECT COUNT(*), COALESCE(SUM(s_now - s_pre), 0)::int
    INTO v_inc_count, v_inc_units
    FROM _sync_diff
    WHERE s_now IS NOT NULL AND s_pre IS NOT NULL AND s_now > s_pre;

  SELECT string_agg(line, E'\n')
    INTO v_inc_list
    FROM (
      SELECT '  • #' || offer_id || ' ' || title || ' (' || s_pre || ' → ' || s_now || ')' AS line
      FROM _sync_diff
      WHERE s_now > s_pre
      ORDER BY (s_now - s_pre) DESC, offer_id
      LIMIT v_max
    ) t;

  -- ── Section B: Уменьшены без продаж ──────────────────────────────────────
  SELECT COUNT(*), COALESCE(SUM(s_pre - s_now), 0)::int
    INTO v_dec_count, v_dec_units
    FROM _sync_diff
    WHERE s_now IS NOT NULL AND s_pre IS NOT NULL AND s_now < s_pre AND sold = 0;

  SELECT string_agg(line, E'\n')
    INTO v_dec_list
    FROM (
      SELECT '  • #' || offer_id || ' ' || title || ' (' || s_pre || ' → ' || s_now || ')' AS line
      FROM _sync_diff
      WHERE s_now < s_pre AND sold = 0
      ORDER BY (s_pre - s_now) DESC, offer_id
      LIMIT v_max
    ) t;

  -- ── Section C: Учтено новых продаж ───────────────────────────────────────
  SELECT COUNT(*), COALESCE(SUM(sold), 0)::int
    INTO v_sale_count, v_sale_units
    FROM _sync_diff WHERE sold > 0;

  SELECT string_agg(line, E'\n')
    INTO v_sale_list
    FROM (
      SELECT '  • #' || offer_id || ' ' || title || ' (−' || sold || ')' AS line
      FROM _sync_diff WHERE sold > 0
      ORDER BY sold DESC, offer_id
      LIMIT v_max
    ) t;

  -- ── Section D: Сняты с продажи (true → false) ────────────────────────────
  SELECT
    COUNT(*) FILTER (WHERE o_pre AND NOT o_now),
    COUNT(*) FILTER (WHERE w_pre AND NOT w_now),
    COUNT(*) FILTER (WHERE y_pre AND NOT y_now),
    COUNT(*) FILTER (WHERE m_pre AND NOT m_now)
    INTO v_off_ozon, v_off_wb, v_off_ym, v_off_mesh
    FROM _sync_diff;
  v_off_total := v_off_ozon + v_off_wb + v_off_ym + v_off_mesh;

  SELECT string_agg(line, E'\n')
    INTO v_off_list
    FROM (
      SELECT '  • [' || plat || '] #' || offer_id || ' ' || title AS line
      FROM (
        SELECT offer_id, title, 'Ozon'   AS plat, 1 AS ord FROM _sync_diff WHERE o_pre AND NOT o_now
        UNION ALL
        SELECT offer_id, title, 'WB',                2     FROM _sync_diff WHERE w_pre AND NOT w_now
        UNION ALL
        SELECT offer_id, title, 'YM',                3     FROM _sync_diff WHERE y_pre AND NOT y_now
        UNION ALL
        SELECT offer_id, title, 'Мешок',             4     FROM _sync_diff WHERE m_pre AND NOT m_now
      ) u
      ORDER BY ord, offer_id
      LIMIT v_max
    ) t;

  -- ── Длительность ─────────────────────────────────────────────────────────
  v_duration_s := EXTRACT(EPOCH FROM (COALESCE(v_run.finished_at, now()) - v_run.started_at))::int;
  v_duration := (v_duration_s / 60) || ' мин ' || (v_duration_s % 60) || ' сек';

  -- ── Сборка сообщения ─────────────────────────────────────────────────────
  v_msg := '📊 Сводка ' || v_run.playbook_name || ' (run #' || v_run.run_id || ')' || E'\n\n';

  v_msg := v_msg || '📦 Увеличены остатки: ';
  IF v_inc_count = 0 THEN
    v_msg := v_msg || '—' || E'\n\n';
  ELSE
    v_msg := v_msg || v_inc_count || ' тов. (+' || v_inc_units || ' ед.)' || E'\n' || v_inc_list;
    IF v_inc_count > v_max THEN
      v_msg := v_msg || E'\n  … и ещё ' || (v_inc_count - v_max);
    END IF;
    v_msg := v_msg || E'\n\n';
  END IF;

  v_msg := v_msg || '📦 Уменьшены без продаж: ';
  IF v_dec_count = 0 THEN
    v_msg := v_msg || '—' || E'\n\n';
  ELSE
    v_msg := v_msg || v_dec_count || ' тов. (−' || v_dec_units || ' ед.)' || E'\n' || v_dec_list;
    IF v_dec_count > v_max THEN
      v_msg := v_msg || E'\n  … и ещё ' || (v_dec_count - v_max);
    END IF;
    v_msg := v_msg || E'\n\n';
  END IF;

  v_msg := v_msg || '📉 Учтено новых продаж: ';
  IF v_sale_count = 0 THEN
    v_msg := v_msg || '—' || E'\n\n';
  ELSE
    v_msg := v_msg || v_sale_units || ' ед. на ' || v_sale_count || ' тов.' || E'\n' || v_sale_list;
    IF v_sale_count > v_max THEN
      v_msg := v_msg || E'\n  … и ещё ' || (v_sale_count - v_max);
    END IF;
    v_msg := v_msg || E'\n\n';
  END IF;

  v_msg := v_msg || '🚫 Сняты с продажи: Ozon ' || v_off_ozon ||
                   ' · WB ' || v_off_wb ||
                   ' · YM ' || v_off_ym ||
                   ' · Мешок ' || v_off_mesh;
  IF v_off_total > 0 THEN
    v_msg := v_msg || E'\n' || v_off_list;
    IF v_off_total > v_max THEN
      v_msg := v_msg || E'\n  … и ещё ' || (v_off_total - v_max);
    END IF;
  END IF;
  v_msg := v_msg || E'\n\n';

  v_msg := v_msg || '⏱ ' || v_duration;

  RETURN v_msg;
END;
$function$;

COMMENT ON FUNCTION claude_meta.sync_summary_format(bigint) IS
  'Форматирует Telegram-сообщение со сводкой изменений для playbook_run.run_id (NULL → последний sync_* run).';
