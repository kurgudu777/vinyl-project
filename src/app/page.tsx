'use client';

import { useEffect, useState } from 'react';
import { triggerPlaybook } from '@/lib/rpc';
import type { ActiveRun, PlaybookName, PlaybookStep, RunDetails, RunStep } from '@/lib/types';
import { usePlaybookSteps } from '@/hooks/usePlaybookSteps';
import { useCurrentRun } from '@/hooks/useCurrentRun';

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

const PLAYBOOK_LABEL: Record<PlaybookName, string> = PLAYBOOKS.reduce(
  (acc, p) => {
    acc[p.name] = p.label;
    return acc;
  },
  {} as Record<PlaybookName, string>,
);

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
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
            Текущий запуск
          </h2>
          <RealtimeIndicator />
        </div>
        <CurrentRunCard />
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
        <li key={s.step_order}>
          <button
            type="button"
            onClick={() => console.log('step click', name, s.step_order, s.label)}
            className="flex w-full items-baseline gap-2 py-1.5 text-left text-xs text-neutral-300 transition hover:text-white hover:bg-neutral-800/50 -mx-1 px-1 rounded"
          >
            <span className="w-5 shrink-0 font-mono tabular-nums text-neutral-500">
              {s.step_order}.
            </span>
            <span className="flex-1">{s.label}</span>
            {!s.required && (
              <span className="font-mono text-[10px] text-neutral-600">опц</span>
            )}
          </button>
        </li>
      ))}
    </ol>
  );
}

// ────────────────────────────────────────────────────────────────────
// Текущий запуск
// ────────────────────────────────────────────────────────────────────

function RealtimeIndicator() {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-neutral-500">
      <span className="relative inline-flex h-1.5 w-1.5">
        <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500/60" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
      </span>
      realtime
    </span>
  );
}

function CurrentRunCard() {
  const { run, details, loading, error } = useCurrentRun();

  if (loading) {
    return (
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-6 text-sm text-neutral-500">
        Загружаю…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-900/60 bg-red-950/30 p-6 text-sm text-red-300">
        Ошибка: {error}
      </div>
    );
  }

  if (!run) {
    return (
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-6 text-sm text-neutral-500">
        Сейчас ничего не выполняется
      </div>
    );
  }

  const label = PLAYBOOK_LABEL[run.playbook_name] ?? run.playbook_name;
  const total = run.steps_total || 0;
  const done = run.steps_done || 0;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  const displayStep =
    details?.steps.find((s) => s.status === 'running') ??
    details?.steps.find((s) => s.status === 'queued') ??
    null;

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="text-base font-medium">{label}</div>
          <div className="mt-1 text-xs text-neutral-500">
            запущен <RelativeTime iso={run.started_at} />
            {run.triggered_by ? ` · ${run.triggered_by}` : null}
          </div>
        </div>
        <StatusBadge status={run.status} />
      </div>

      <div className="mb-2 flex items-baseline justify-between text-xs text-neutral-400">
        <span>
          завершено {done} из {total}
        </span>
        <span className="tabular-nums">{percent}%</span>
      </div>

      <div className="mb-4 h-1 overflow-hidden rounded-full bg-neutral-800">
        <div
          className="h-full bg-emerald-500 transition-all duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>

      {displayStep ? (
        <CurrentStepRow step={displayStep} />
      ) : (
        <div className="rounded-md bg-neutral-950/60 px-3 py-2.5 text-xs text-neutral-500">
          завершается…
        </div>
      )}
    </div>
  );
}

function CurrentStepRow({ step }: { step: RunStep }) {
  const elapsed = useElapsed(step.started_at);
  return (
    <div className="flex items-center gap-3 rounded-md bg-neutral-950/60 px-3 py-2.5">
      <span className="relative inline-flex h-2 w-2 shrink-0">
        <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500/70" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] uppercase tracking-wide text-neutral-500">
          сейчас выполняется
        </div>
        <div className="mt-0.5 truncate text-sm font-medium">
          <span className="mr-1.5 font-mono text-xs text-neutral-500">
            {step.step_order}.
          </span>
          {step.label}
        </div>
      </div>
      {elapsed !== null && (
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-neutral-500">
          {elapsed}
        </span>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: ActiveRun['status'] }) {
  const map: Record<ActiveRun['status'], string> = {
    pending: 'bg-neutral-800 text-neutral-300',
    running: 'bg-emerald-950/60 text-emerald-300',
    completed: 'bg-neutral-800 text-neutral-400',
    failed: 'bg-red-950/60 text-red-300',
    cancelled: 'bg-neutral-800 text-neutral-500',
  };
  return (
    <span
      className={
        'shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ' + map[status]
      }
    >
      {status}
    </span>
  );
}

// ─── helpers ──────────────────────────────────────────────────────

function RelativeTime({ iso }: { iso: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);
  return <span>{formatRelative(iso, now)}</span>;
}

function formatRelative(iso: string, now: number): string {
  const delta = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (delta < 5) return 'только что';
  if (delta < 60) return `${delta} сек назад`;
  const min = Math.floor(delta / 60);
  if (min < 60) return `${min} мин назад`;
  const hrs = Math.floor(min / 60);
  return `${hrs} ч назад`;
}

function useElapsed(startedAt: string | null): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  if (!startedAt) return null;
  const sec = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  if (sec < 60) return `${sec}с`;
  const min = Math.floor(sec / 60);
  const rest = sec % 60;
  return `${min}м ${rest}с`;
}
