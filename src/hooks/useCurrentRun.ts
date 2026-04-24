'use client';

import { useEffect, useRef, useState } from 'react';
import { getActiveRuns, getRunStatus } from '@/lib/rpc';
import { getSupabase } from '@/lib/supabase';
import type { ActiveRun, RunDetails } from '@/lib/types';

type State = {
  run: ActiveRun | null;
  details: RunDetails | null;
  loading: boolean;
  error: string | null;
};

const INITIAL: State = {
  run: null,
  details: null,
  loading: true,
  error: null,
};

/**
 * Подписка на активный playbook_run.
 *
 * Стратегия: Realtime используется как триггер «пересчитай». На любое
 * событие в claude_meta.playbook_run или claude_meta.job_queue выполняется
 * дебаунс-перезапрос RPC get_active_runs() / get_run_status(). Это
 * проще и надёжнее, чем собирать state по payload-ам событий.
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
          setState({ run: null, details: null, loading: false, error: null });
          return;
        }

        const details = await getRunStatus(run.run_id);
        if (disposed || myReqId !== reqIdRef.current) return;

        setState({ run, details, loading: false, error: null });
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
      .channel('current-run')
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

    return () => {
      disposed = true;
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      supabase.removeChannel(channel);
    };
  }, []);

  return state;
}
