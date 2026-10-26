export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Кнопка «Разархивация» в приложении синхов.
// 26.10.2026: n8n остановлен (20.10), вебхук ozon-autoarchive-return больше не отвечает —
// ставим ту же задачу воркеру СК, что и кнопка в СК: RPC public.sk_enqueue_ts('ozon.autoarchiveReturn').
// Цепочка фаз ~3 мин, итог приходит в Telegram. Ответ не ждём.
export async function POST() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return Response.json({ ok: false, error: 'Supabase env not set' }, { status: 500 });
  }
  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/sk_enqueue_ts`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_handler: 'ozon.autoarchiveReturn', p_args: { source: 'sync-app' } }),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    const text = await r.text();
    if (!r.ok) {
      console.error('[autoarchive-return] enqueue failed', r.status, text.slice(0, 300));
      return Response.json({ ok: false, error: `enqueue http ${r.status}` }, { status: 502 });
    }
    return Response.json({ ok: true, job_id: Number(text) }, { status: 202 });
  } catch (e) {
    console.error('[autoarchive-return] enqueue error', (e as Error).message);
    return Response.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
