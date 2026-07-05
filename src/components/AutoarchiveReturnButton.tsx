'use client';

import { useState } from 'react';

type Phase = 'idle' | 'triggering' | 'confirmed' | 'error';

// Разовое ручное действие вне playbook-модели: свой fire-and-forget роут,
// локальное phase-состояние. Компактная иконочная кнопка в шапке (без текста);
// обратная связь — цветом/иконкой + tooltip. Итог WF уходит алертом в Telegram.
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

  const tone =
    phase === 'triggering'
      ? 'border-blue-700 bg-blue-950/40 text-blue-300'
      : phase === 'confirmed'
        ? 'border-emerald-700 bg-emerald-950/40 text-emerald-300'
        : phase === 'error'
          ? 'border-red-800 bg-red-950/40 text-red-300'
          : 'border-neutral-800 bg-neutral-900 text-amber-400 hover:border-neutral-700 hover:bg-[#1a1a1a]';

  const title =
    phase === 'error'
      ? `Разархивация Ozon — ошибка: ${message}`
      : phase === 'confirmed'
        ? 'Разархивация Ozon — запущено (~3 мин, итог в Telegram)'
        : phase === 'triggering'
          ? 'Разархивация Ozon — запускаем…'
          : 'Разархивация Ozon — восстановить авто-архивные лоты (разовое, вне плейбуков, ~3 мин, итог в Telegram)';

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      aria-label="Разархивация Ozon"
      title={title}
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition duration-150 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:cursor-wait sm:h-10 sm:w-10 ${tone} ${busy ? 'cursor-wait' : ''}`}
    >
      {busy ? (
        <Spinner />
      ) : phase === 'confirmed' ? (
        <CheckIcon />
      ) : phase === 'error' ? (
        <span className="text-sm font-bold leading-none" aria-hidden="true">✗</span>
      ) : (
        <ArchiveRestoreIcon />
      )}
    </button>
  );
}

function ArchiveRestoreIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
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

function CheckIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="4 12 10 18 20 6" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg
      width="16"
      height="16"
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
