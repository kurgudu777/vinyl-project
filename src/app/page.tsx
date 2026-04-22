'use client';

import { useState } from 'react';
import { triggerPlaybook } from '@/lib/rpc';
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

type TriggeringState = Record<PlaybookName, boolean>;

const INITIAL_TRIGGERING: TriggeringState = {
  sync_stocks: false,
  sync_prices: false,
  sync_all: false,
};

export default function HomePage() {
  const [isTriggering, setIsTriggering] = useState<TriggeringState>(INITIAL_TRIGGERING);

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
        {PLAYBOOKS.map((p) => {
          const pending = isTriggering[p.name];
          return (
            <button
              key={p.name}
              type="button"
              disabled={pending}
              onClick={() => handleTrigger(p.name)}
              className={
                'group flex flex-col gap-2 rounded-lg border p-5 text-left transition duration-150 ' +
                'focus:outline-none focus:ring-2 focus:ring-blue-500/40 active:scale-[0.98] ' +
                (pending
                  ? 'cursor-wait border-blue-900 bg-blue-950/30'
                  : 'border-neutral-800 bg-neutral-900 hover:border-neutral-700 hover:bg-[#1a1a1a]')
              }
            >
              <div className="text-lg font-medium">{p.label}</div>
              <div className="font-mono text-xs text-neutral-500">
                {pending ? 'Запущено…' : p.description}
              </div>
              <div className="mt-2 text-xs text-neutral-600">Последний запуск: —</div>
            </button>
          );
        })}
      </section>

      <section className="mt-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Текущий запуск
        </h2>
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-6 text-sm text-neutral-500">
          Сейчас ничего не выполняется
        </div>
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
