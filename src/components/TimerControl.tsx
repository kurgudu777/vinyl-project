'use client';

import { useState } from 'react';
import { setSchedulerConfig, type SchedulerRow } from '@/lib/rpc';
import type { PlaybookName } from '@/lib/types';

const ALLOWED_INTERVALS = [1, 2, 3, 4, 6, 8, 12, 24] as const;

type Props = {
  playbook: PlaybookName;
  row: SchedulerRow | undefined;
};

export function TimerControl({ playbook, row }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enabled = row?.enabled ?? false;
  const interval = row?.interval_hours ?? 6;
  const lastRunAt = row?.last_run_at ?? null;

  async function update(nextEnabled: boolean, nextInterval: number) {
    setBusy(true);
    setError(null);
    try {
      await setSchedulerConfig(playbook, nextEnabled, nextInterval);
    } catch (err) {
      console.error('setSchedulerConfig failed', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function onToggle() {
    update(!enabled, interval);
  }

  function onChangeInterval(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = parseInt(e.target.value, 10);
    update(enabled, next);
  }

  const nextSlot = computeNextSlot(interval, enabled);

  const borderClass = enabled
    ? 'border-emerald-800/60 bg-emerald-950/20'
    : 'border-neutral-800 bg-neutral-950/40';

  return (
    <div className={`flex flex-col gap-1.5 rounded-md border px-2.5 py-2 text-[11px] ${borderClass}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-neutral-300">
          <span aria-hidden>⏱</span>
          <span className="font-medium">Авто</span>
        </span>
        <button
          type="button"
          onClick={onToggle}
          disabled={busy}
          aria-pressed={enabled}
          className={
            'relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full transition ' +
            (enabled ? 'b
mkdir -p src/components && cat > src/components/TimerControl.tsx << 'EOF'
'use client';

import { useState } from 'react';
import { setSchedulerConfig, type SchedulerRow } from '@/lib/rpc';
import type { PlaybookName } from '@/lib/types';

const ALLOWED_INTERVALS = [1, 2, 3, 4, 6, 8, 12, 24] as const;

type Props = {
  playbook: PlaybookName;
  row: SchedulerRow | undefined;
};

export function TimerControl({ playbook, row }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enabled = row?.enabled ?? false;
  const interval = row?.interval_hours ?? 6;
  const lastRunAt = row?.last_run_at ?? null;

  async function update(nextEnabled: boolean, nextInterval: number) {
    setBusy(true);
    setError(null);
    try {
      await setSchedulerConfig(playbook, nextEnabled, nextInterval);
    } catch (err) {
      console.error('setSchedulerConfig failed', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function onToggle() {
    update(!enabled, interval);
  }

  function onChangeInterval(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = parseInt(e.target.value, 10);
    update(enabled, next);
  }

  const nextSlot = computeNextSlot(interval, enabled);

  const borderClass = enabled
    ? 'border-emerald-800/60 bg-emerald-950/20'
    : 'border-neutral-800 bg-neutral-950/40';

  return (
    <div className={`flex flex-col gap-1.5 rounded-md border px-2.5 py-2 text-[11px] ${borderClass}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-neutral-300">
          <span aria-hidden>⏱</span>
          <span className="font-medium">Авто</span>
        </span>
        <button
          type="button"
          onClick={onToggle}
          disabled={busy}
          aria-pressed={enabled}
          className={
            'relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full transition ' +
            (enabled ? 'bg-emerald-600' : 'bg-neutral-700') +
            (busy ? ' opacity-50' : '')
          }
        >
          <span
            className={
              'inline-block h-3 w-3 transform rounded-full bg-white transition ' +
              (enabled ? 'translate-x-3.5' : 'translate-x-0.5')
            }
          />
        </button>
      </div>

      <label className="flex items-center justify-between gap-2 text-neutral-400">
        <span>период</span>
        <select
          value={interval}
          onChange={onChangeInterval}
          disabled={busy}
          className="rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-[11px] text-neutral-200 outline-none hover:border-neutral-600 focus:border-neutral-500 disabled:opacity-50"
        >
          {ALLOWED_INTERVALS.map((h) => (
            <option key={h} value={h}>{h}ч</option>
          ))}
        </select>
      </label>

      <div className="text-[10px] leading-tight text-neutral-500">
        {enabled ? (
          <>
            <div>след: {nextSlot}</div>
            <div>посл: {formatLastRun(lastRunAt)}</div>
          </>
        ) : (
          <div className="text-neutral-600">выкл</div>
        )}
      </div>

      {error && (
        <div className="font-mono text-[10px] text-red-400 break-words">{error}</div>
      )}
    </div>
  );
}

function computeNextSlot(intervalHours: number, enabled: boolean): string {
  if (!enabled) return '—';
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcMin = now.getUTCMinutes();
  const mskHour = (utcHour + 3) % 24;

  let nextMskHour = mskHour;
  if (mskHour % intervalHours === 0 && utcMin >= 0) {
    nextMskHour = mskHour + intervalHours;
  } else {
    const remainder = mskHour % intervalHours;
    nextMskHour = mskHour + (intervalHours - remainder);
  }

  const tomorrow = nextMskHour >= 24;
  const displayHour = nextMskHour % 24;
  const hh = displayHour.toString().padStart(2, '0');
  return tomorrow ? `завтра ${hh}:00 МСК` : `сегодня ${hh}:00 МСК`;
}

function formatLastRun(iso: string | null): string {
  if (!iso) return 'не запускался';
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const hm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return hm;
  const dm = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  return `${dm} ${hm}`;
}
