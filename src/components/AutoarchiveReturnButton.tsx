'use client';

import { useState, type ReactNode } from 'react';

type Phase = 'idle' | 'triggering' | 'confirmed' | 'error';

// Разовое ручное действие вне playbook-модели: свой fire-and-forget роут,
// локальное phase-состояние (как у карточек плейбуков в page.tsx), но без
// прогресс-бара, activeRuns и run-tracking. Итог WF уходит алертом в Telegram.
export function AutoarchiveReturnButton() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState<string | null>(null);

  async function handleClick() {
    if (phase === 'triggering') return;
    setPhase('triggering');
    setMessage(null);
    try {
      const res = await fetch('/api/autoarchive-return', { method: 'POST' });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (res.ok && json?.ok) {
        setPhase('confirmed');
        setTimeout(() => setPhase('idle'), 5000);
      } else {
        setPhase('error');
        setMessage(json?.error ?? `HTTP ${res.status}`);
      }
    } catch (err) {
      setPhase('error');
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  const busy = phase === 'triggering';

  const borderBg =
    phase === 'triggering'
      ? 'border-blue-700 bg-blue-950/40'
      : phase === 'confirmed'
        ? 'border-emerald-700 bg-emerald-950/30'
        : phase === 'error'
          ? 'border-red-800 bg-red-950/30'
          : 'border-neutral-800 bg-neutral-900 hover:border-neutral-700 hover:bg-[#1a1a1a]';

  let statusLine: ReactNode;
  if (phase === 'triggering') {
    statusLine = (
      <span className="inline-flex items-center gap-1.5 text-blue-300">
        <Spinner />
        Запускаем…
      </span>
    );
  } else if (phase === 'confirmed') {
    statusLine = <span className="text-emerald-300">✓ Запущено</span>;
  } else if (phase === 'error') {
    statusLine = <span className="text-red-300">✗ {message}</span>;
  } else {
    statusLine = <span>~3 мин · вне плейбуков</span>;
  }

  const cursor = busy ? 'cursor-wait' : '';

  return (
    <div
      className={`flex flex-col gap-2 rounded-lg border p-3 transition duration-150 sm:p-4 ${borderBg} ${cursor}`}
    >
      <button
        type="button"
        disabled={busy}
        onClick={handleClick}
        className="flex items-center gap-1.5 rounded-md text-left transition active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:cursor-wait sm:gap-3"
      >
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 sm:h-11 sm:w-11 sm:rounded-xl"
          aria-hidden="true"
        >
          <ArchiveRestoreIcon />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[13px] font-medium sm:text-base">Разархивация Ozon</span>
          <span className="min-h-[14px] font-mono text-[10px] text-neutral-400 sm:min-h-[16px] sm:text-xs">
            {statusLine}
          </span>
        </span>
      </button>
      <p className="border-t border-neutral-800/70 pt-2 text-[11px] leading-snug text-neutral-500 sm:text-xs">
        Разовое ручное действие, вне плейбуков. Восстанавливает лоты Ozon,
        залипшие в авто-архиве. Выполняется ~3 мин, итог — алертом в Telegram.
      </p>
    </div>
  );
}

function ArchiveRestoreIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#fbbf24"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="3" width="20" height="5" rx="1" />
      <path d="M4 8v11a2 2 0 0 0 2 2h2" />
      <path d="M20 8v11a2 2 0 0 1-2 2h-2" />
      <path d="m9 15 3-3 3 3" />
      <path d="M12 12v9" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      className="animate-spin"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}
