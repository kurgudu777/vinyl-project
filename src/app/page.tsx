'use client';

import { useEffect, useState, type ReactNode } from 'react';
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
import { useScheduler } from '@/hooks/useScheduler';
import { TimerControl } from '@/components/TimerControl';
import type { SchedulerRow } from '@/lib/rpc';

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

// Иконки и цветовые тона плашки иконки для каждого плейбука.
// Полка с пластинками — Остатки. Знак рубля — Цены. Для «Всё целиком» — обе иконки рядом.
function PlaybookIcon({ name }: { name: PlaybookName }) {
  if (name === 'sync_stocks' || name === 'sync_all') {
    const shelf = (
      <svg width="26" height="26" viewBox="0 0 28 28" fill="none" aria-hidden="true">
        <line x1="4" y1="4" x2="4" y2="24" stroke="#85B7EB" strokeWidth="1.8" strokeLinecap="round" />
        <line x1="24" y1="4" x2="24" y2="24" stroke="#85B7EB" strokeWidth="1.8" strokeLinecap="round" />
        <line x1="3" y1="24" x2="25" y2="24" stroke="#85B7EB" strokeWidth="1.8" strokeLinecap="round" />
        <line x1="3" y1="4" x2="25" y2="4" stroke="#85B7EB" strokeWidth="1.8" strokeLinecap="round" />
        <line x1="7" y1="8" x2="7" y2="23.2" stroke="#85B7EB" strokeWidth="2.2" strokeLinecap="round" />
        <line x1="9.8" y1="8" x2="9.8" y2="23.2" stroke="#85B7EB" strokeWidth="2.2" strokeLinecap="round" />
        <line x1="12.6" y1="8" x2="12.6" y2="23.2" stroke="#85B7EB" strokeWidth="2.2" strokeLinecap="round" />
        <line x1="15.2" y1="8.37" x2="18.5" y2="23.2" stroke="#85B7EB" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
    );
    if (name === 'sync_stocks') return shelf;
    // sync_all — две раздельные плашки рядом, каждая в своём цвете
    return (
      <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/15 sm:h-11 sm:w-11">
          {shelf}
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/15 sm:h-11 sm:w-11">
          <span className="text-[20px] font-bold leading-none text-emerald-400 sm:text-[22px]" aria-hidden="true">₽</span>
        </div>
      </div>
    );
  }
  // sync_prices — знак рубля
  return (
    <span className="text-[22px] font-bold leading-none text-emerald-400 sm:text-[24px]" aria-hidden="true">₽</span>
  );
}

// Тон фона плашки иконки для одиночных иконок.
// Для sync_all плашки рендерятся внутри PlaybookIcon (две раздельные).
const PLAYBOOK_ICON_BG: Record<PlaybookName, string | null> = {
  sync_stocks: 'bg-blue-500/15',
  sync_prices: 'bg-emerald-500/15',
  sync_all: null,
};

const PLAYBOOK_LABEL: Record<PlaybookName, string> = PLAYBOOKS.reduce(
  (acc, p) => {
    acc[p.name] = p.label;
    return acc;
  },
  {} as Record<PlaybookName, string>,
);

type BoolByPlaybook = Record<PlaybookName, boolean>;

type TriggerPhase = 'idle' | 'triggering' | 'confirmed' | 'already_running' | 'error';
type TriggerState = { phase: TriggerPhase; message?: string };
type TriggerStateMap = Record<PlaybookName, TriggerState>;

const INITIAL_FALSE: BoolByPlaybook = {
  sync_stocks: false,
  sync_prices: false,
  sync_all: false,
};

const INITIAL_TRIGGER_STATE: TriggerStateMap = {
  sync_stocks: { phase: 'idle' },
  sync_prices: { phase: 'idle' },
  sync_all: { phase: 'idle' },
};

export default function HomePage() {
  const [triggerState, setTriggerState] = useState<TriggerStateMap>(INITIAL_TRIGGER_STATE);
  const [stepMode, setStepMode] = useState<BoolByPlaybook>(INITIAL_FALSE);
  const [expanded, setExpanded] = useState<BoolByPlaybook>(INITIAL_FALSE);

  // Активные плейбуки (running/pending). Используется для логики:
  // - блокировки карточек, конфликтующих с уже идущими ранами
  // - сброса confirmed-состояния когда плейбук завершился
  // Правила конфликта (зеркалят бэкенд _playbooks_conflict):
  //   sync_all конфликтует со всем; одинаковые плейбуки конфликтуют;
  //   sync_stocks + sync_prices параллельно разрешены.
  const { runs: activeRuns } = useCurrentRun();
  const activePlaybooks = new Set<PlaybookName>(
    activeRuns.map((r) => r.playbook_name),
  );

  // Конфигурация автозапусков (claude_meta.scheduler_config) с Realtime-обновлением.
  // Используется внутри карточки плейбука для отрисовки <TimerControl/>.
  const { rows: schedulerRows } = useScheduler();
  const schedulerByPlaybook: Partial<Record<PlaybookName, SchedulerRow>> = {};
  schedulerRows.forEach((r) => {
    schedulerByPlaybook[r.playbook_name] = r;
  });

  // Если плейбук был confirmed, а его активный ран закончился —
  // сбрасываем карточку в idle.
  useEffect(() => {
    setTriggerState((prev) => {
      let changed = false;
      const next = { ...prev };
      (Object.keys(prev) as PlaybookName[]).forEach((name) => {
        if (prev[name].phase === 'confirmed' && !activePlaybooks.has(name)) {
          next[name] = { phase: 'idle' };
          changed = true;
        }
      });
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRuns]);

  const setPhase = (name: PlaybookName, state: TriggerState) => {
    setTriggerState((prev) => ({ ...prev, [name]: state }));
  };

  const handleTrigger = async (name: PlaybookName) => {
    setPhase(name, { phase: 'triggering' });
    try {
      const result = await triggerPlaybook(name);
      console.log('trigger result', name, result);

      if (result.status === 'enqueued') {
        // Успех: состояние 'confirmed' держится пока activeRun этого плейбука
        // не завершится — сброс делает эффект в компоненте. Это даёт визуальный
        // «залип» кнопки: пользователь понимает, что она уже сработала.
        setPhase(name, { phase: 'confirmed', message: `run #${result.run_id}` });
      } else if (result.status === 'already_running') {
        setPhase(name, {
          phase: 'already_running',
          message: `уже выполняется (run #${result.run_id})`,
        });
        setTimeout(() => {
          setTriggerState((prev) =>
            prev[name].phase === 'already_running'
              ? { ...prev, [name]: { phase: 'idle' } }
              : prev,
          );
        }, 3000);
      } else {
        setPhase(name, { phase: 'error', message: result.error ?? 'unknown error' });
      }
    } catch (err) {
      console.error('trigger failed', name, err);
      setPhase(name, {
        phase: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
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
    <main className="mx-auto max-w-6xl px-4 py-3 sm:px-6 sm:py-6">
      <header className="mb-1.5 sm:mb-5">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl md:text-3xl">
          Синхронизация
        </h1>
      </header>

      <section className="grid gap-3 sm:gap-4 sm:grid-cols-3">
        {PLAYBOOKS.map((p) => (
          <PlaybookCardView
            key={p.name}
            card={p}
            triggerState={triggerState[p.name]}
            stepMode={stepMode[p.name]}
            expanded={expanded[p.name]}
            activePlaybooks={activePlaybooks}
            schedulerRow={schedulerByPlaybook[p.name]}
            onTrigger={() => handleTrigger(p.name)}
            onToggleStepMode={() => toggleStepMode(p.name)}
            onToggleExpanded={() => toggleExpanded(p.name)}
          />
        ))}
      </section>

      <section className="mt-3 sm:mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
            Текущий запуск
          </h2>
          <RealtimeIndicator />
        </div>
        <CurrentRunCard />
      </section>

      <section className="mt-3 sm:mt-6">
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
  triggerState: TriggerState;
  stepMode: boolean;
  expanded: boolean;
  activePlaybooks: Set<PlaybookName>;
  schedulerRow: SchedulerRow | undefined;
  onTrigger: () => void;
  onToggleStepMode: () => void;
  onToggleExpanded: () => void;
};

function PlaybookCardView({
  card,
  triggerState,
  stepMode,
  expanded,
  activePlaybooks,
  schedulerRow,
  onTrigger,
  onToggleStepMode,
  onToggleExpanded,
}: PlaybookCardViewProps) {
  const phase = triggerState.phase;
  const isActive = activePlaybooks.has(card.name);
  const busy = phase === 'triggering';

  // Логика конфликта зеркалит бэкенд claude_meta._playbooks_conflict:
  //   - sync_all конфликтует со всем
  //   - одинаковые плейбуки конфликтуют (повторный запуск того же)
  //   - sync_stocks и sync_prices между собой НЕ конфликтуют → параллельны
  const conflictsWithActive = Array.from(activePlaybooks).some((active) => {
    if (active === card.name) return true; // тот же
    if (active === 'sync_all' || card.name === 'sync_all') return true; // sync_all со всем
    return false;
  });

  const disabled = busy || conflictsWithActive;

  // Цвет рамки/фона зависит от фазы и активности
  const borderBg =
    phase === 'triggering'
      ? 'border-blue-700 bg-blue-950/40'
      : phase === 'confirmed' || isActive
        ? 'border-emerald-700 bg-emerald-950/30'
        : phase === 'already_running'
          ? 'border-amber-700 bg-amber-950/30'
          : phase === 'error'
            ? 'border-red-800 bg-red-950/30'
            : conflictsWithActive
              ? 'border-neutral-800 bg-neutral-900 opacity-50'
              : 'border-neutral-800 bg-neutral-900 hover:border-neutral-700 hover:bg-[#1a1a1a]';

  const cursor = busy ? 'cursor-wait' : disabled ? 'cursor-not-allowed' : '';
  const containerClass = `group flex flex-col gap-2 rounded-lg border p-3 sm:p-4 transition duration-150 ${borderBg} ${cursor}`;

  // Подпись под заголовком — меняется в зависимости от фазы, чтобы была явная
  // обратная связь о том, что запуск реально произошёл.
  let statusLine: ReactNode;
  if (phase === 'triggering') {
    statusLine = (
      <span className="inline-flex items-center gap-1.5 text-blue-300">
        <Spinner />
        Запускаем…
      </span>
    );
  } else if (phase === 'confirmed' || isActive) {
    statusLine = (
      <span className="inline-flex items-center gap-1.5 text-emerald-300">
        <RunningDot />
        Выполняется
      </span>
    );
  } else if (phase === 'already_running') {
    statusLine = (
      <span className="text-amber-300">⚠ {triggerState.message}</span>
    );
  } else if (phase === 'error') {
    statusLine = (
      <span className="text-red-300">✗ {triggerState.message}</span>
    );
  } else {
    statusLine = <span>{card.description}</span>;
  }

  return (
    <div className={containerClass}>
      <div className="flex items-center gap-1.5 sm:gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-3">
          {PLAYBOOK_ICON_BG[card.name] ? (
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg sm:h-11 sm:w-11 sm:rounded-xl ${PLAYBOOK_ICON_BG[card.name]}`}
              aria-hidden="true"
            >
              <PlaybookIcon name={card.name} />
            </div>
          ) : (
            <PlaybookIcon name={card.name} />
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <button
              type="button"
              disabled={disabled}
              onClick={onTrigger}
              className="-m-1 rounded-md p-1 text-left transition active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:cursor-not-allowed"
            >
              <div className="text-[13px] font-medium sm:text-base">{card.label}</div>
              <div className="font-mono text-[10px] text-neutral-400 min-h-[14px] mt-0.5 sm:text-xs sm:min-h-[16px]">
                {statusLine}
              </div>
            </button>
          </div>
        </div>

        <div className="w-24 shrink-0 sm:w-32">
          <TimerControl playbook={card.name} row={schedulerRow} />
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-neutral-800/70 pt-2">
        <label className="flex cursor-pointer select-none items-center gap-2 text-[11px] text-neutral-400 sm:text-xs">
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
          parentPlaybookActive={activePlaybooks.has(card.name)}
        />
      )}
    </div>
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

function RunningDot() {
  return (
    <span className="relative inline-flex h-2 w-2">
      <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500/70" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
    </span>
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
  const [stepsOpen, setStepsOpen] = useState(false);

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

  // Истина — details.steps (один снимок из job_queue). Поля run.steps_*
  // приходят отдельным запросом и могут отставать на сотни мс от details.
  // Fallback на run.steps_* только если details ещё не загружен.
  const total = details?.steps.length ?? run.steps_total ?? 0;
  const done =
    details?.steps.filter((s) => s.status === 'done').length ??
    run.steps_done ??
    0;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  const currentStep =
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
            {run.triggered_by ? ` · ${formatTriggeredBy(run.triggered_by)}` : null}
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

      {currentStep ? (
        <CurrentStepRow step={currentStep} />
      ) : (
        <div className="rounded-md bg-neutral-950/60 px-3 py-2.5 text-xs text-neutral-500">
          завершается…
        </div>
      )}

      {details && details.steps.length > 0 && (
        <div className="mt-3 border-t border-neutral-800 pt-3">
          <button
            type="button"
            onClick={() => setStepsOpen((v) => !v)}
            aria-expanded={stepsOpen}
            className="flex w-full items-center justify-between rounded-md px-1 py-1 text-xs text-neutral-400 transition hover:text-neutral-200"
          >
            <span>
              {stepsOpen ? 'Скрыть шаги' : 'Показать все шаги'}
            </span>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={'transition-transform ' + (stepsOpen ? 'rotate-180' : '')}
              aria-hidden="true"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {stepsOpen && (
            <ol className="mt-2 flex flex-col gap-0 rounded-md bg-neutral-950/40 px-2 py-1.5">
              {details.steps.map((s) => (
                <StepDetailRow key={s.job_id} step={s} />
              ))}
            </ol>
          )}
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

  // Если раскрытый запуск стал активным (running/pending) — сворачиваем его,
  // шаги активного запуска показываются в «Текущий запуск».
  useEffect(() => {
    if (expandedRunId === null) return;
    const run = runs.find((r) => r.run_id === expandedRunId);
    if (!run) return;
    if (run.status === 'running' || run.status === 'pending') {
      setExpandedRunId(null);
    }
  }, [runs, expandedRunId]);

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

  // Активные запуски не раскрываем в истории — шаги показываются в «Текущий запуск»
  const isActive = effectiveStatus === 'running' || effectiveStatus === 'pending';

  return (
    <li>
      <button
        type="button"
        onClick={isActive ? undefined : onToggle}
        aria-expanded={expanded}
        disabled={isActive}
        className={
          'flex w-full items-center gap-3 px-4 py-3 text-left transition focus:outline-none ' +
          (isActive
            ? 'cursor-default'
            : 'hover:bg-neutral-800/50 focus-visible:bg-neutral-800/50')
        }
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
            {formatAbsoluteTime(run.started_at)}
            {duration ? ` · ${duration}` : ''}
            {run.triggered_by ? ` · ${formatTriggeredBy(run.triggered_by)}` : ''}
            {isActive ? ' · показывается в «Текущий запуск»' : ''}
          </div>
        </div>

        {!isActive && (
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
        )}
      </button>

      {expanded && !isActive && <RunDetailsPanel runId={run.run_id} />}
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

/**
 * Абсолютное время. Если сегодня — HH:MM, если вчера — "вчера HH:MM",
 * если в этом году — "DD MMM HH:MM", иначе — "DD.MM.YYYY HH:MM".
 */
function formatTriggeredBy(value: string | null): string | null {
  if (!value) return null;
  switch (value) {
    case 'web_ui':
    case 'manual_step':
      return 'пользователь';
    case 'scheduler':
      return 'авто';
    default:
      return value;
  }
}

function formatAbsoluteTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();

  const hm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return hm;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();
  if (isYesterday) return `вчера ${hm}`;

  const sameYear = d.getFullYear() === now.getFullYear();
  if (sameYear) {
    const dm = d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
    return `${dm} ${hm}`;
  }

  const dmy = d.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  return `${dmy} ${hm}`;
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
