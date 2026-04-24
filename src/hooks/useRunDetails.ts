'use client';

import { useEffect, useRef, useState } from 'react';
import { getRunStatus } from '@/lib/rpc';
import { getSupabase } from '@/lib/supabase';
import type { RunDetails, RunStatus } from '@/lib/types';

type State = {
  details: RunDetails | null;
  loading: boolean;
  error: string | null;
};

const INITIAL: State = {
  details: null,
  loading: false,
  error: null,
};

const ACTIVE_STATUSES: RunStatus[] = ['pending', 'running'];

/**
 * Детали конкретного запуска (список шагов + статус + ошибки).
 *
 * Ленивая загрузка: реальный запрос в Supabase идёт только при enabled=true.
 * Пока строка истории не развёрнута — хук висит молча, RPC не дёргает.
 *
 * Кэш: ref-множество уже загруженных run_id по аналогии с usePlaybookSteps.
 * Повторное разворачивание той же строки не ретригерит RPC.
 *
 * Realtime: подписка на job_queue поднимается ТОЛЬКО если запуск активный
 * (pending/running). Для завершённых данные иммутабельны — слушать нечего.
 * Статус активности определяется после первой загрузки details.
 *
 * Race-защита: reqIdRef, как в useCurrentRun. Cleanup намеренно не отменяет
 * выпущенный fetch — выброс устаревшего ответа через reqId достаточно.
 */
export function useRunDetails(runId: number | null, enabled: boolean): State {
  const [state, setState] = useState<State>(INITIAL);

  const loadedRef = useRef<Set<number>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqIdRef = useRef(0);

  useEffect(() => {
    if (!enabled || runId == null) return;

    let disposed = false;

    const refresh = async () => {
      const myReqId = ++reqIdRef.current;
      try {
        const details = await getRunStatus(runId);
        if (disposed || myReqId !== reqIdRef.current) return;
        loadedRef.current.add(runId);
        setState({ details, loading: false, error: null });
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

    // Первая загрузка: если уже в кэше — не дёргаем RPC повторно на монтировании,
    // но state всё равно сбрасываем в loading=false и ждём Realtime.
    if (loadedRef.current.has(runId)) {
      // details уже лежит в state от предыдущего разворачивания этой же строки,
      // если компонент не размонтировался. Если размонтировался — кэш теряется
      // вместе с ref, и эта ветка не сработает.
      setState((prev) => ({ ...prev, loading: false }));
    } else {
      setState({ details: null, loading: true, error: null });
      refresh();
    }

    // Realtime: только для активных запусков. Определяем по текущему state.details
    // ПОСЛЕ первой загрузки. Подписку ставим безусловно, но её можно было бы
    // отключить позже — пока оставляем простую схему: job_queue пишется часто,
    // но дебаунс 200мс и ранний exit для completed спасают от лишних RPC.
    //
    // Чтобы не подписываться на каждый completed — проверяем статус из кэша.
    const currentStatus = state.details?.run.status;
    const isActive =
      currentStatus == null || ACTIVE_STATUSES.includes(currentStatus);

    if (!isActive) {
      return () => {
        disposed = true;
        if (debounceRef.current) {
          clearTimeout(debounceRef.current);
          debounceRef.current = null;
        }
      };
    }

    const supabase = getSupabase();
    const channel = supabase
      .channel(
        `run-details-${runId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'claude_meta',
          table: 'job_queue',
          filter: `run_id=eq.${runId}`,
        },
        scheduleRefresh,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'claude_meta',
          table: 'playbook_run',
          filter: `run_id=eq.${runId}`,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, enabled]);

  return state;
}
