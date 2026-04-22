'use client';

import type { PlaybookName } from '@/lib/types';

type PlaybookCard = {
  name: PlaybookName;
  label: string;
  description: string;
};

const PLAYBOOKS: PlaybookCard[] = [
  { name: 'sync_stocks', label: 'Остатки', description: '8 шагов · ~3 мин' },
  { name: 'sync_prices', label: 'Цены', description: '4 шага · ~2–10 мин' },
  { name: 'sync_all', label: 'Всё целиком', description: '~12 шагов · ~5–15 мин' },
];

export default function HomePage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Синхронизация</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Запуск плейбуков через очередь Supabase
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        {PLAYBOOKS.map((p) => (
          <button
            key={p.name}
            type="button"
            onClick={() => console.log('clicked', p.name)}
            className="group flex flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-900 p-5 text-left transition hover:border-neutral-700 hover:bg-neutral-800/60 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          >
            <div className="text-lg font-medium">{p.label}</div>
            <div className="font-mono text-xs text-neutral-500">{p.description}</div>
            <div className="mt-2 text-xs text-neutral-600">Последний прогон: —</div>
          </button>
        ))}
      </section>

      <section className="mt-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Активный прогон
        </h2>
        <div className="rounded-lg border border-dashed border-neutral-800 p-6 text-sm text-neutral-500">
          Нет активных прогонов
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">
          История
        </h2>
        <div className="rounded-lg border border-dashed border-neutral-800 p-6 text-sm text-neutral-500">
          История прогонов появится здесь
        </div>
      </section>
    </main>
  );
}
