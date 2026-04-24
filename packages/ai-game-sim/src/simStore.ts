import type { GameState } from '@splendor-duel/game-engine';

const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

interface Entry {
  state: GameState;
  updatedAt: number;
}

const store = new Map<string, Entry>();

function evictStale(): void {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, entry] of store) {
    if (entry.updatedAt < cutoff) {
      store.delete(id);
    }
  }
}

export function get(id: string): GameState | undefined {
  return store.get(id)?.state;
}

export function set(id: string, state: GameState): void {
  store.set(id, { state, updatedAt: Date.now() });
  // Periodically evict stale sessions to prevent unbounded memory growth.
  if (store.size % 50 === 0) {
    evictStale();
  }
}

export function remove(id: string): void {
  store.delete(id);
}

export function size(): number {
  return store.size;
}
