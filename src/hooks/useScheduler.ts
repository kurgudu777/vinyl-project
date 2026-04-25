'use client';

import { useEffect, useState } from 'react';
import { getSchedulerConfig, type SchedulerRow } from '@/lib/rpc';
import { getSupabase } from '@/lib/supabase';

/**
 * Подписка на claude_meta.scheduler_config с Realtime-обновлением.
 * Возвращает список строк (по одной на плейбук) и индикатор загрузки.
 */
export function useScheduler() {
  const [rows, setRows] = useState<SchedulerRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await getSchedulerConfig();
        if (!cancelled) {
          setRows(data);
          setLoading(false);
        }
      } catch (err) {
        console.error('useScheduler load failed', err);
        if (!cancelled) setLoading(false);
      }
    }

    load();

    // Уникальный канал, чтобы не конфликтовать со Strict Mode (двойной mount)
    const channelName = `scheduler-config-${Date.now()}-${Math.random()}`;
    const channel = getSupabase()
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'claude_meta',
          table: 'scheduler_config',
        },
        () => {
          // При любом изменении — перечитываем все 3 строки.
          // Дёшево (3 строки), проще чем мерджить delta вручную.
          load();
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      getSupabase().removeChannel(channel);
    };
  }, []);

  return { rows, loading };
}
