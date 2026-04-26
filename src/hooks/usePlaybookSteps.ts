'use client';

import { useEffect, useRef, useState } from 'react';
import { getPlaybookSteps } from '@/lib/rpc';
import { formatError } from '@/lib/formatError';
import type { PlaybookName, PlaybookStep } from '@/lib/types';

type State = {
  steps: PlaybookStep[];
  loading: boolean;
  error: string | null;
};

const INITIAL: State = { steps: [], loading: false, error: null };

/**
 * Ленивая загрузка шагов плейбука.
 *
 * Устойчив к React Strict Mode: guard через ref-множество уже запрошенных имён.
 * При первом монтировании оба прохода effect увидят одно и то же множество;
 * первый проход добавит имя, второй выйдет по guard'у.
 *
 * deps только [enabled, name] — никаких производных от state, чтобы не зациклить.
 */
export function usePlaybookSteps(name: PlaybookName, enabled: boolean) {
  const [state, setState] = useState<State>(INITIAL);
  const requestedRef = useRef<Set<PlaybookName>>(new Set());

  useEffect(() => {
    if (!enabled) return;
    if (requestedRef.current.has(name)) return;
    requestedRef.current.add(name);

    setState({ steps: [], loading: true, error: null });

    getPlaybookSteps(name)
      .then((steps) => {
        setState({ steps, loading: false, error: null });
      })
      .catch((err: unknown) => {
        // удаляем имя из множества, чтобы следующее раскрытие перезапустило
        requestedRef.current.delete(name);
        setState({
          steps: [],
          loading: false,
          error: formatError(err),
        });
      });
    // cleanup намеренно отсутствует — мы не хотим отменять уже выпущенный запрос
    // в ответ на Strict Mode double-invoke
  }, [enabled, name]);

  return state;
}
