import { waitUntil } from '@vercel/functions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const base = process.env.N8N_BASE_URL;
  if (!base) {
    return Response.json({ ok: false, error: 'N8N_BASE_URL not set' }, { status: 500 });
  }
  const url = `${base}/webhook/ozon-autoarchive-return`;
  // WF выполняется ~3 мин (адаптивная poll-петля + responseMode=lastNode) —
  // ответ намеренно не ждём. На Vercel serverless-функция может быть заморожена
  // сразу после ответа клиенту, обрывая фоновый fetch; waitUntil() держит
  // рантайм живым, пока запрос к вебхуку не завершится. Итог WF — алертом в Telegram.
  waitUntil(
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }).catch((e) =>
      console.error('[autoarchive-return] webhook fetch failed', (e as Error).message),
    ),
  );
  return Response.json({ ok: true }, { status: 202 });
}
