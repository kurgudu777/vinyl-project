'use client';

import { useEffect, useRef, useState } from 'react';
import { getRecentRuns } from '@/lib/rpc';
import { getSupabase } from '@/lib/supabase';
import type { RecentRun } from '@/lib/types';

type State = {
  runs: RecentRun[];
  loading: boolean;
  error: string | null;
};

const INITIAL: State = {
  runs: [],
  loading: true,
  error: null,
};

/**
 * Список последних запусков плейбуков.
 *
 * Стратегия: Realtime используется как триггер «пересчитай». На любое
 * событие в claude_meta.playbook_run или claude_meta.job_queue выполняется
 * дебаунс-перезапрос RPC get_recent_runs(limit). Подход идентичен
 * useCurrentRun — данные берутся атомарным снимком из RPC, а не
 * собираются из payload-ов.
 *
 * Подписка на job_queue нужна потому, что steps_done/steps_failed/duration
 * пересчитываются в get_recent_runs именно из job_queue — без неё
 * агрегаты в строке активного запуска не обновлялись бы в реалтайме.
 */
export function useRecentRuns(limit: number = 10): State {
  const [state, setState] = useState<State>(INITIAL);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqIdRef = useRef(0);

  useEffect(() => {
    let disposed = false;

    const refresh = async () => {
      const myReqId = ++reqIdRef.current;
      try {
        const runs = await getRecentRuns(limit);
        if (disposed || myReqId !== reqIdRef.current) return;
        setState({ runs, loading: false, error: null });
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
      .channel(`recent-runs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
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
  }, [limit]);

  return state;
}
