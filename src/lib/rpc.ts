import { getSupabase } from './supabase';
import type {
  ActiveRun,
  CancelResult,
  PlaybookName,
  PlaybookStep,
  RecentRun,
  RunDetails,
  SingleStepResult,
  TriggerResult,
} from './types';

export async function triggerPlaybook(
  playbookName: PlaybookName,
  triggeredBy: string = 'web_ui',
): Promise<TriggerResult> {
  const { data, error } = await getSupabase().rpc('trigger_playbook', {
    p_playbook_name: playbookName,
    p_triggered_by: triggeredBy,
  });
  if (error) throw error;
  return data as TriggerResult;
}

export async function getActiveRuns(): Promise<ActiveRun[]> {
  const { data, error } = await getSupabase().rpc('get_active_runs');
  if (error) throw error;
  return (data ?? []) as ActiveRun[];
}

export async function getRunStatus(runId: number): Promise<RunDetails> {
  const { data, error } = await getSupabase().rpc('get_run_status', {
    p_run_id: runId,
  });
  if (error) throw error;
  return data as RunDetails;
}

export async function getRecentRuns(limit: number = 20): Promise<RecentRun[]> {
  const { data, error } = await getSupabase().rpc('get_recent_runs', {
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as RecentRun[];
}

export async function cancelRun(runId: number): Promise<CancelResult> {
  const { data, error } = await getSupabase().rpc('cancel_run', {
    p_run_id: runId,
  });
  if (error) throw error;
  return data as CancelResult;
}

export async function getPlaybookSteps(
  playbookName: PlaybookName,
): Promise<PlaybookStep[]> {
  const { data, error } = await getSupabase().rpc('get_playbook_steps', {
    p_playbook_name: playbookName,
  });
  if (error) throw error;
  return (data ?? []) as PlaybookStep[];
}

export async function triggerSingleStep(
  playbookName: PlaybookName,
  stepOrder: number,
  triggeredBy: string = 'manual_step',
): Promise<SingleStepResult> {
  const { data, error } = await getSupabase().rpc('enqueue_single_step', {
    p_playbook: playbookName,
    p_step_order: stepOrder,
    p_triggered_by: triggeredBy,
  });
  if (error) throw error;
  return data as SingleStepResult;
}
// ────────────────────────────────────────────────────────────────────
// Scheduler (auto-trigger by interval grid)
// ────────────────────────────────────────────────────────────────────

export type SchedulerRow = {
  playbook_name: PlaybookName;
  enabled: boolean;
  interval_hours: number;
  last_run_at: string | null;
  updated_at: string;
};

export async function getSchedulerConfig(): Promise<SchedulerRow[]> {
  const { data, error } = await getSupabase().rpc('get_scheduler_config');
  if (error) throw error;
  return (data ?? []) as SchedulerRow[];
}

export async function setSchedulerConfig(
  playbookName: PlaybookName,
  enabled: boolean,
  intervalHours: number,
): Promise<SchedulerRow> {
  const { data, error } = await getSupabase().rpc('set_scheduler_config', {
    p_playbook_name: playbookName,
    p_enabled: enabled,
    p_interval_hours: intervalHours,
  });
  if (error) throw error;
  return data as SchedulerRow;
}
