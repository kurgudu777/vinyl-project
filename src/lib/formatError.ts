/**
 * Привести произвольную ошибку (Error, PostgrestError, jsonb из job_queue.result,
 * примитив, объект) к человекочитаемой строке для UI.
 *
 * Приоритет:
 * 1. null/undefined → ''
 * 2. строка → как есть
 * 3. объект с .message (Error, PostgrestError, обёртки) → message [+ ' (code)' если code]
 * 4. объект job_queue.result для упавших шагов
 *    {last_node, http_status, body_snippet} → 'HTTP 503 at "..." : ...'
 * 5. fallback → JSON.stringify(err, null, 2)
 */
export function formatError(err: unknown): string {
  if (err == null) return '';
  if (typeof err === 'string') return err;
  if (typeof err !== 'object') return String(err);

  const obj = err as Record<string, unknown>;

  if (typeof obj.message === 'string' && obj.message.length > 0) {
    const code = typeof obj.code === 'string' && obj.code.length > 0 ? obj.code : null;
    return code ? `${obj.message} (${code})` : obj.message;
  }

  const hasStepShape =
    typeof obj.http_status === 'number' || typeof obj.last_node === 'string';
  if (hasStepShape) {
    const status = typeof obj.http_status === 'number' ? obj.http_status : '?';
    const node = typeof obj.last_node === 'string' ? obj.last_node : 'unknown';
    const snippet =
      typeof obj.body_snippet === 'string' ? obj.body_snippet.slice(0, 200) : '';
    return snippet
      ? `HTTP ${status} at "${node}": ${snippet}`
      : `HTTP ${status} at "${node}"`;
  }

  try {
    return JSON.stringify(err, null, 2);
  } catch {
    return String(err);
  }
}
