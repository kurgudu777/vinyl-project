'use client';

import { useEffect, useRef, useState } from 'react';
import { getActiveRuns, getRunStatus } from '@/lib/rpc';
import { getSupabase } from '@/lib/supabase';
import type { ActiveRun, RunDetails } from '@/lib/types';

type State = {
  /** Все активные раны (running/pending). Используется для определения,
   * какие плейбуки сейчас занимают «слот» — нужно для логики disabled
   * на карточках плейбуков. Бэкенд разрешает параллельные раны если они
   * не конфликтуют (например sync_stocks + sync_prices). */
  runs: ActiveRun[];
  /** Главный активный ран (первый из runs). Показывается в «Текущий запуск». */
  run: ActiveRun | null;
  details: RunDetails | null;
  loading: boolean;
  error: string | null;
};

const INITIAL: State = {
  runs: [],
  run: null,
  details: null,
  loading: true,
  error: null,
};

/** Интервал polling-фоллбэка. Подстраховка на случай если Realtime тихо отвалился. */
const POLL_INTERVAL_MS = 10000;

/**
 * Подписка на активный playbook_run.
 *
 * Стратегия: Realtime используется как триггер «пересчитай». На любое
 * событие в claude_meta.playbook_run или claude_meta.job_queue выполняется
 * дебаунс-перезапрос RPC get_active_runs() / get_run_status(). Это
 * проще и надёжнее, чем собирать state по payload-ам событий.
 *
 * Защита от зависшего UI при слабом интернете:
 * 1. Polling-фоллбэк раз в POLL_INTERVAL_MS — срабатывает если Realtime
 *    тихо отвалился (WS жив для клиента, но события не доходят).
 * 2. visibilitychange — при возврате вкладки в фокус немедленный refresh.
 * 3. online — при восстановлении сети немедленный refresh.
 *
 * Если активных ранов нет — run=null, details=null, loading=false.
 * Если активных несколько — берётся первый (running сортируется по started_at DESC в RPC).
 */
export function useCurrentRun(): State {
  const [state, setState] = useState<State>(INITIAL);

  // debounce-таймер для пересчёта при всплеске событий
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // защита от race: игнорируем ответы от устаревших запросов
  const reqIdRef = useRef(0);

  useEffect(() => {
    let disposed = false;

    const refresh = async () => {
      const myReqId = ++reqIdRef.current;
      try {
        const runs = await getActiveRuns();
        if (disposed || myReqId !== reqIdRef.current) return;

        const run = runs[0] ?? null;
        if (!run) {
          setState({ runs: [], run: null, details: null, loading: false, error: null });
          return;
        }

        const details = await getRunStatus(run.run_id);
        if (disposed || myReqId !== reqIdRef.current) return;

        setState({ runs, run, details, loading: false, error: null });
      } catch (err) {
        if (disposed || myReqId !== reqIdRef.current) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    };

    const scheduleRefresh = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        refresh();
      }, 200);
    };

    // 1. Первичная загрузка
    refresh();

    // 2. Realtime-подписка
    const supabase = getSupabase();
    const channel = supabase
      .channel(`current-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'claude_meta',
          table: 'playbook_run',
        },
        scheduleRefresh,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'claude_meta',
          table: 'job_queue',
        },
        scheduleRefresh,
      )
      .subscribe();

    // 3. Polling-фоллбэк: дёргаем refresh каждые POLL_INTERVAL_MS
    // Поллим всегда (а не только при активном ране) — на случай если
    // ран стартовал с другой вкладки/устройства и WS пропустил событие.
    const pollInterval = setInterval(() => {
      if (disposed) return;
      refresh();
    }, POLL_INTERVAL_MS);

    // 4. Возврат вкладки в фокус — мгновенный refresh
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        scheduleRefresh();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    // 5. Восстановление сети — мгновенный refresh
    const onOnline = () => {
      scheduleRefresh();
    };
    window.addEventListener('online', onOnline);

    return () => {
      disposed = true;
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      clearInterval(pollInterval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('online', onOnline);
      supabase.removeChannel(channel);
    };
  }, []);

  return state;
}
