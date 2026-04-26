'use client';

import { useEffect, useState } from 'react';
import { getPlaybookSteps } from '@/lib/rpc';
import type { PlaybookName } from '@/lib/types';

type Counts = Partial<Record<PlaybookName, number>>;

type State = {
  counts: Counts;
  loading: boolean;
  error: string | null;
};

const PLAYBOOKS_TO_FETCH: PlaybookName[] = ['sync_stocks', 'sync_prices', 'sync_all'];

/**
 * Загружает количество шагов для всех плейбуков одним Promise.all.
 * Используется в карточках главной страницы для динамической подписи
 * "N шагов · ~T мин" вместо захардкоженных значений.
 *
 * Без cleanup, отменяющего in-flight (по паттерну usePlaybookSteps).
 */
export function usePlaybookStepCounts(): State {
  const [state, setState] = useState<State>({ counts: {}, loading: true, error: null });

  useEffect(() => {
    let cancelled = false;

    Promise.all(PLAYBOOKS_TO_FETCH.map((name) => getPlaybookSteps(name)))
      .then((results) => {
        if (cancelled) return;
        const counts: Counts = {};
        PLAYBOOKS_TO_FETCH.forEach((name, idx) => {
          counts[name] = results[idx].length;
        });
        setState({ counts, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          counts: {},
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
