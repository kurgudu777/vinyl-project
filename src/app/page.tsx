'use client';

import { useEffect, useState } from 'react';
import { triggerPlaybook, triggerSingleStep } from '@/lib/rpc';
import type {
  ActiveRun,
  PlaybookName,
  PlaybookStep,
  RecentRun,
  RunStep,
  SingleStepResult,
} from '@/lib/types';
import { usePlaybookSteps } from '@/hooks/usePlaybookSteps';
import { useCurrentRun } from '@/hooks/useCurrentRun';
import { useRecentRuns } from '@/hooks/useRecentRuns';
import { useRunDetails } from '@/hooks/useRunDetails';

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

  // Активный плейбук (если есть) — используется для блокировки кнопок шагов
  const { run: activeRun } = useCurrentRun();
  const activePlaybook: PlaybookName | null = activeRun?.playbook_name ?? null;

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
    <main className="mx-auto max-w-6xl px-6 py-6">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
          Синхронизация
        </h1>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        {PLAYBOOKS.map((p) => (
          <PlaybookCardView
            key={p.name}
            card={p}
            pending={isTriggering[p.name]}
            stepMode={stepMode[p.name]}
            expanded={expanded[p.name]}
            activePlaybook={activePlaybook}
            onTrigger={() => handleTrigger(p.name)}
            onToggleStepMode={() => toggleStepMode(p.name)}
            onToggleExpanded={() => toggleExpanded(p.name)}
          />
        ))}
      </section>

      <section className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
            Текущий запуск
          </h2>
          <RealtimeIndicator />
        </div>
        <CurrentRunCard />
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-400">
          История
        </h2>
        <HistoryList />
      </section>
    </main>
  );
}

type PlaybookCardViewProps = {
  card: PlaybookCard;
  pending: boolean;
  stepMode: boolean;
  expanded: boolean;
  activePlaybook: PlaybookName | null;
  onTrigger: () => void;
  onToggleStepMode: () => void;
  onToggleExpanded: () => void;
};

function PlaybookCardView({
  card,
  pending,
  stepMode,
  expanded,
  activePlaybook,
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

      {stepMode && expanded && (
        <StepList
          name={card.name}
          parentPlaybookActive={activePlaybook === card.name}
        />
      )}
    </div>
  );
}

type StepListProps = {
  name: PlaybookName;
  parentPlaybookActive: boolean;
};

function StepList({ name, parentPlaybookActive }: StepListProps) {
  const { steps, loading, error } = usePlaybookSteps(name, true);
  // состояние запуска отдельных шагов: step_order -> pending / result / error
  const [pendingStep, setPendingStep] = useState<number | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);

  const handleRunStep = async (stepOrder: number) => {
    if (pendingStep !== null) return; // уже что-то запускается
    if (parentPlaybookActive) return;

    setPendingStep(stepOrder);
    setStepError(null);
    try {
      const result: SingleStepResult = await triggerSingleStep(name, stepOrder);
      console.log('single step result', name, stepOrder, result);
      if (!result.ok) {
        setStepError(result.message);
      }
    } catch (err) {
      console.error('single step failed', name, stepOrder, err);
      setStepError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingStep(null);
    }
  };

  if (loading) {
    return <div className="pl-1 text-xs text-neutral-500">Загружаю шаги…</div>;
  }

  if (error) {
    return (
      <div className="pl-1 text-xs text-red-400">Ошибка загрузки: {error}</div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <ol className="flex flex-col divide-y divide-neutral-700 pl-1">
        {steps.map((s: PlaybookStep) => {
          const isPending = pendingStep === s.step_order;
          const isDisabled =
            parentPlaybookActive || (pendingStep !== null && !isPending);

          return (
            <li key={s.step_order}>
              <button
                type="button"
                disabled={isDisabled}
                onClick={() => handleRunStep(s.step_order)}
                title={
                  parentPlaybookActive
                    ? 'Нельзя запустить: активен родной плейбук'
                    : 'Запустить этот шаг отдельно'
                }
                className={
                  'group flex w-full items-baseline gap-2 py-1.5 text-left text-xs transition -mx-1 px-1 rounded ' +
                  (isDisabled
                    ? 'cursor-not-allowed text-neutral-600'
                    : 'text-neutral-300 hover:text-white hover:bg-neutral-800/50')
                }
              >
                <span
                  className={
                    'w-5 shrink-0 font-mono tabular-nums ' +
                    (isDisabled ? 'text-neutral-700' : 'text-neutral-500')
                  }
                >
                  {s.step_order}.
                </span>
                <span className="flex-1">{s.label}</span>

                {!s.required && (
                  <span className="font-mono text-[10px] text-neutral-600">опц</span>
                )}

                {isPending ? (
                  <span className="font-mono text-[10px] text-blue-400">
                    запуск…
                  </span>
                ) : (
                  <span
                    className={
                      'font-mono text-[10px] ' +
                      (isDisabled
                        ? 'text-neutral-700'
                        : 'text-neutral-500 group-hover:text-emerald-400')
                    }
                    aria-hidden="true"
                  >
                    ▶
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>

      {parentPlaybookActive && (
        <div className="pl-1 text-[10px] text-neutral-500">
          Родной плейбук сейчас выполняется — отдельный запуск заблокирован
        </div>
      )}

      {stepError && (
        <div className="pl-1 text-[11px] text-red-400">⚠ {stepError}</div>
      )}
    </div>
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

// ────────────────────────────────────────────────────────────────────
// История запусков
// ────────────────────────────────────────────────────────────────────

function HistoryList() {
  const { runs, loading, error } = useRecentRuns(10);
  const [expandedRunId, setExpandedRunId] = useState<number | null>(null);

  if (loading && runs.length === 0) {
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

  if (runs.length === 0) {
    return (
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-6 text-sm text-neutral-500">
        Запусков ещё не было
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900">
      <ul className="divide-y divide-neutral-800">
        {runs.map((run) => (
          <HistoryRow
            key={run.run_id}
            run={run}
            expanded={expandedRunId === run.run_id}
            onToggle={() =>
              setExpandedRunId((prev) => (prev === run.run_id ? null : run.run_id))
            }
          />
        ))}
      </ul>
    </div>
  );
}

type HistoryRowProps = {
  run: RecentRun;
  expanded: boolean;
  onToggle: () => void;
};

function HistoryRow({ run, expanded, onToggle }: HistoryRowProps) {
  const label = PLAYBOOK_LABEL[run.playbook_name] ?? run.playbook_name;
  const total = run.steps_total || 0;
  const done = run.steps_done || 0;
  const failed = run.steps_failed || 0;

  const effectiveStatus = deriveEffectiveStatus(run);
  const duration = formatDuration(run.duration_sec);

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-neutral-800/50 focus:outline-none focus-visible:bg-neutral-800/50"
      >
        <StatusIcon status={effectiveStatus} />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-sm font-medium text-neutral-200">
              {label}
            </span>
            <span className="font-mono text-[11px] text-neutral-500 tabular-nums">
              {failed > 0 ? `${done}/${total} · ${failed} ✗` : `${done}/${total}`}
            </span>
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-neutral-500">
            <RelativeTime iso={run.started_at} />
            {duration ? ` · ${duration}` : ''}
            {run.triggered_by ? ` · ${run.triggered_by}` : ''}
          </div>
        </div>

        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={
            'shrink-0 text-neutral-500 transition-transform ' +
            (expanded ? 'rotate-180' : '')
          }
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {expanded && <RunDetailsPanel runId={run.run_id} />}
    </li>
  );
}

function RunDetailsPanel({ runId }: { runId: number }) {
  const { details, loading, error } = useRunDetails(runId, true);

  if (loading) {
    return (
      <div className="border-t border-neutral-800 bg-neutral-950/50 px-4 py-3 text-xs text-neutral-500">
        Загружаю шаги…
      </div>
    );
  }

  if (error) {
    return (
      <div className="border-t border-neutral-800 bg-neutral-950/50 px-4 py-3 text-xs text-red-400">
        Ошибка: {error}
      </div>
    );
  }

  if (!details || details.steps.length === 0) {
    return (
      <div className="border-t border-neutral-800 bg-neutral-950/50 px-4 py-3 text-xs text-neutral-500">
        Данных о шагах нет
      </div>
    );
  }

  return (
    <div className="border-t border-neutral-800 bg-neutral-950/50 px-4 py-3">
      <ol className="flex flex-col gap-0">
        {details.steps.map((s) => (
          <StepDetailRow key={s.job_id} step={s} />
        ))}
      </ol>
      {details.run.notes && (
        <div className="mt-2 rounded bg-neutral-900 px-2 py-1.5 text-[11px] text-neutral-400">
          <span className="text-neutral-500">notes: </span>
          {details.run.notes}
        </div>
      )}
    </div>
  );
}

function StepDetailRow({ step }: { step: RunStep }) {
  const dur = formatStepDuration(step);
  const isFailed = step.status === 'failed';

  return (
    <li className="flex items-start gap-2 py-1 text-xs">
      <span className="mt-0.5 shrink-0">
        <StepStatusIcon status={step.status} />
      </span>
      <span className="w-5 shrink-0 font-mono tabular-nums text-neutral-600">
        {step.step_order}.
      </span>
      <div className="min-w-0 flex-1">
        <div
          className={
            'flex items-baseline gap-2 ' +
            (isFailed ? 'text-red-300' : 'text-neutral-300')
          }
        >
          <span className="flex-1 truncate">{step.label}</span>
          {dur && (
            <span className="shrink-0 font-mono text-[10px] tabular-nums text-neutral-500">
              {dur}
            </span>
          )}
        </div>
        {step.error_message && (
          <div className="mt-0.5 font-mono text-[10px] text-red-400 whitespace-pre-wrap break-words">
            {step.error_message}
          </div>
        )}
        {step.attempt > 1 && (
          <div className="mt-0.5 font-mono text-[10px] text-neutral-500">
            попытка {step.attempt} из {step.max_attempts}
          </div>
        )}
      </div>
    </li>
  );
}

// ────────────────────────────────────────────────────────────────────
// Status visuals
// ────────────────────────────────────────────────────────────────────

type EffectiveStatus =
  | 'running'
  | 'success'
  | 'partial'
  | 'failed'
  | 'cancelled'
  | 'pending';

function deriveEffectiveStatus(run: RecentRun): EffectiveStatus {
  if (run.status === 'running') return 'running';
  if (run.status === 'pending') return 'pending';
  if (run.status === 'cancelled') return 'cancelled';
  if (run.status === 'failed') return 'failed';
  // completed — но если среди шагов есть failed, считаем partial
  if (run.status === 'completed' && (run.steps_failed ?? 0) > 0) return 'partial';
  return 'success';
}

function StatusIcon({ status }: { status: EffectiveStatus }) {
  // Крупная круглая иконка слева от строки
  const base =
    'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold';
  switch (status) {
    case 'success':
      return (
        <span className={base + ' bg-emerald-950/60 text-emerald-400'}>✓</span>
      );
    case 'failed':
      return <span className={base + ' bg-red-950/60 text-red-400'}>✗</span>;
    case 'partial':
      return (
        <span className={base + ' bg-amber-950/60 text-amber-400'}>!</span>
      );
    case 'cancelled':
      return (
        <span className={base + ' bg-neutral-800 text-neutral-500'}>−</span>
      );
    case 'running':
      return (
        <span className="relative inline-flex h-5 w-5 shrink-0 items-center justify-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500/40" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
      );
    case 'pending':
    default:
      return (
        <span className={base + ' bg-neutral-800 text-neutral-400'}>·</span>
      );
  }
}

function StepStatusIcon({ status }: { status: RunStep['status'] }) {
  const base =
    'inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] font-bold leading-none';
  switch (status) {
    case 'done':
      return (
        <span className={base + ' bg-emerald-950/60 text-emerald-400'}>✓</span>
      );
    case 'failed':
      return <span className={base + ' bg-red-950/60 text-red-400'}>✗</span>;
    case 'cancelled':
      return (
        <span className={base + ' bg-neutral-800 text-neutral-500'}>−</span>
      );
    case 'running':
      return (
        <span className="relative inline-flex h-3.5 w-3.5 items-center justify-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500/50" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
        </span>
      );
    case 'queued':
    default:
      return (
        <span className={base + ' bg-neutral-800 text-neutral-500'}>·</span>
      );
  }
}

// ────────────────────────────────────────────────────────────────────
// helpers
// ────────────────────────────────────────────────────────────────────

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
  if (hrs < 24) return `${hrs} ч назад`;
  const days = Math.floor(hrs / 24);
  return `${days} дн назад`;
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

/**
 * Длительность запуска из duration_sec (число секунд, может прийти строкой).
 * "193.3" -> "3м 13с", "45" -> "45с", null -> null.
 */
function formatDuration(sec: number | string | null): string | null {
  if (sec == null) return null;
  const n = typeof sec === 'string' ? parseFloat(sec) : sec;
  if (!isFinite(n) || n < 0) return null;
  const whole = Math.round(n);
  if (whole < 60) return `${whole}с`;
  const min = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${min}м ${rest}с`;
}

/**
 * Длительность шага. duration_ms в базе сейчас 0 у всех — считаем из
 * started_at / finished_at если есть оба. Для running / queued — null.
 */
function formatStepDuration(step: RunStep): string | null {
  if (step.duration_ms && step.duration_ms > 0) {
    const sec = Math.round(step.duration_ms / 1000);
    return formatDurationSec(sec);
  }
  if (step.started_at && step.finished_at) {
    const sec = Math.max(
      0,
      Math.round(
        (new Date(step.finished_at).getTime() -
          new Date(step.started_at).getTime()) /
          1000,
      ),
    );
    return formatDurationSec(sec);
  }
  return null;
}

function formatDurationSec(sec: number): string {
  if (sec < 1) return '<1с';
  if (sec < 60) return `${sec}с`;
  const min = Math.floor(sec / 60);
  const rest = sec % 60;
  return `${min}м ${rest}с`;
}
