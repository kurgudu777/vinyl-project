'use client';

import { useState } from 'react';
import { triggerPlaybook } from '@/lib/rpc';
import type { PlaybookName, PlaybookStep } from '@/lib/types';
import { usePlaybookSteps } from '@/hooks/usePlaybookSteps';

type PlaybookCard = {
  name: PlaybookName;
  label: string;
  description: string;
};

const PLAYBOOKS: PlaybookCard[] = [
  { name: 'sync_stocks', label: 'Остатки', description: '8 шагов · ~3 мин' },
  { name: 'sync_prices', label: 'Цены', description: '4 шага · ~2-10 мин' },
  { name: 'sync_all', label: 'Всё целиком', description: '~12 шагов · ~5-15 мин' },
];

type BoolByPlaybook = Record<PlaybookName, boolean>;

const INITIAL_FALSE: BoolByPlaybook = {
  sync_stocks: false,
  sync_prices: false,
  sync_all: false,
};

export default function HomePage() {
  const [isTriggering, setIsTriggering] = useState<BoolByPlaybook>(INITIAL_FALSE);
  const [stepMode, setStepMode] = useState<BoolByPlaybook>(INITIAL_FALSE);
  const [expanded, setExpanded] = useState<BoolByPlaybook>(INITIAL_FALSE);

  const handleTrigger = async (name: PlaybookName) => {
    setIsTriggering((prev) => ({ ...prev, [name]: true }));
    try {
      const result = await triggerPlaybook(name);
      console.log('trigger result', name, result);
    } catch (err) {
      console.error('trigger failed', name, err);
    } finally {
      setIsTriggering((prev) => ({ ...prev, [name]: false }));
    }
  };

  const toggleStepMode = (name: PlaybookName) => {
    setStepMode((prev) => {
      const next = !prev[name];
      if (!next) {
        // отключили — свернуть
        setExpanded((e) => ({ ...e, [name]: false }));
      }
      return { ...prev, [name]: next };
    });
  };

  const toggleExpanded = (name: PlaybookName) => {
    setExpanded((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
          Синхронизация
        </h1>
        <p className="mt-1 text-sm text-neutral-400">
          Запуск плейбуков через очередь Supabase
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        {PLAYBOOKS.map((p) => (
          <PlaybookCardView
            key={p.name}
            card={p}
            pending={isTriggering[p.name]}
            stepMode={stepMode[p.name]}
            expanded={expanded[p.name]}
            onTrigger={() => handleTrigger(p.name)}
            onToggleStepMode={() => toggleStepMode(p.name)}
            onToggleExpanded={() => toggleExpanded(p.name)}
          />
        ))}
      </section>

      <section className="mt-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Текущий запуск
        </h2>
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-6 text-sm text-neutral-500">
          Сейчас ничего не выполняется
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">
          История
        </h2>
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-6 text-sm text-neutral-500">
          История запусков появится здесь
        </div>
      </section>
    </main>
  );
}

type PlaybookCardViewProps = {
  card: PlaybookCard;
  pending: boolean;
  stepMode: boolean;
  expanded: boolean;
  onTrigger: () => void;
  onToggleStepMode: () => void;
  onToggleExpanded: () => void;
};

function PlaybookCardView({
  card,
  pending,
  stepMode,
  expanded,
  onTrigger,
  onToggleStepMode,
  onToggleExpanded,
}: PlaybookCardViewProps) {
  const containerClass =
    'group flex flex-col gap-3 rounded-lg border p-5 transition duration-150 ' +
    (pending
      ? 'cursor-wait border-blue-900 bg-blue-950/30'
      : 'border-neutral-800 bg-neutral-900 hover:border-neutral-700 hover:bg-[#1a1a1a]');

  return (
    <div className={containerClass}>
      <button
        type="button"
        disabled={pending}
        onClick={onTrigger}
        className="-m-1 rounded-md p-1 text-left transition active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-blue-500/40"
      >
        <div className="text-lg font-medium">{card.label}</div>
        <div className="font-mono text-xs text-neutral-500">
          {pending ? 'Запущено…' : card.description}
        </div>
        <div className="mt-2 text-xs text-neutral-600">Последний запуск: —</div>
      </button>

      <div className="flex items-center justify-between border-t border-neutral-800/70 pt-3">
        <label className="flex cursor-pointer select-none items-center gap-2 text-xs text-neutral-400">
          <input
            type="checkbox"
            checked={stepMode}
            onChange={onToggleStepMode}
            className="h-3.5 w-3.5 cursor-pointer accent-blue-500"
          />
          По шагам
        </label>

        <button
          type="button"
          disabled={!stepMode}
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          aria-label={expanded ? 'Свернуть шаги' : 'Развернуть шаги'}
          className={
            'rounded p-1 text-neutral-400 transition ' +
            (stepMode
              ? 'hover:bg-neutral-800 hover:text-neutral-200'
              : 'cursor-not-allowed opacity-30')
          }
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={'transition-transform ' + (expanded ? 'rotate-180' : '')}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>

      {stepMode && expanded && <StepList name={card.name} />}
    </div>
  );
}

function StepList({ name }: { name: PlaybookName }) {
  const { steps, loading, error } = usePlaybookSteps(name, true);

  if (loading) {
    return <div className="pl-1 text-xs text-neutral-500">Загружаю шаги…</div>;
  }
  if (error) {
    return <div className="pl-1 text-xs text-red-400">Ошибка: {error}</div>;
  }
  if (steps.length === 0) {
    return <div className="pl-1 text-xs text-neutral-500">Нет шагов</div>;
  }

  return (
    <ol className="flex flex-col divide-y divide-neutral-700 pl-1">
      {steps.map((s: PlaybookStep) => (
        <li
          key={s.step_order}
          className="flex items-baseline gap-2 py-1.5 text-xs text-neutral-300"
        >
          <span className="w-5 shrink-0 font-mono tabular-nums text-neutral-500">
            {s.step_order}.
          </span>
          <span className="flex-1">{s.label}</span>
          {!s.required && (
            <span className="font-mono text-[10px] text-neutral-600">опц</span>
          )}
        </li>
      ))}
    </ol>
  );
}
