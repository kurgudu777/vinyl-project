export type PlaybookName = 'sync_stocks' | 'sync_prices' | 'sync_all';

export type RunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type StepStatus =
  | 'queued'
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface ActiveRun {
  run_id: number;
  playbook_name: PlaybookName;
  status: RunStatus;
  triggered_by: string | null;
  started_at: string;
  steps_total: number;
  steps_done: number;
  steps_failed: number;
  steps_running: number;
}

export interface RecentRun {
  run_id: number;
  playbook_name: PlaybookName;
  status: RunStatus;
  triggered_by: string | null;
  started_at: string;
  finished_at: string | null;
  duration_sec: number | null;
  steps_total: number;
  steps_done: number;
  steps_failed: number;
}

export interface RunStep {
  job_id: number;
  step_order: number;
  label: string;
  status: StepStatus;
  run_after: string;
  claimed_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  attempt: number;
  max_attempts: number;
  error_message: string | null;
  duration_ms: number | null;
}

export interface RunDetails {
  run: {
    run_id: number;
    playbook_name: PlaybookName;
    status: RunStatus;
    triggered_by: string | null;
    started_at: string;
    finished_at: string | null;
    notes: string | null;
  };
  steps: RunStep[];
}

// trigger_playbook responses
export type TriggerResult =
  | { status: 'enqueued'; run_id: number; playbook_name: PlaybookName }
  | { status: 'already_running'; run_id: number; playbook_name: PlaybookName }
  | { status: 'error'; error: string; playbook_name?: string };

export type CancelResult =
  | {
      status: 'ok';
      run_id: number;
      cancelled_steps: number;
      running_steps_left: number;
      note: string;
    }
  | { status: 'error'; error: 'run_not_found' | 'not_active'; run_id: number };
