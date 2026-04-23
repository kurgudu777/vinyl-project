import { getSupabase } from './supabase';
import type {
  ActiveRun,
  CancelResult,
  PlaybookName,
  PlaybookStep,
  RecentRun,
  RunDetails,
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
