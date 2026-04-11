import type { GameState } from '@splendor-duel/game-engine';

const store = new Map<string, GameState>();

export function get(id: string): GameState | undefined {
  return store.get(id);
}

export function set(id: string, state: GameState): void {
  store.set(id, state);
}

export function remove(id: string): void {
  store.delete(id);
}

export function size(): number {
  return store.size;
}
