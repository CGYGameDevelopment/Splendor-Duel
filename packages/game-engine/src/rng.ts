/**
 * Deterministic pseudo-random number generation for the game engine.
 *
 * The reducer must be pure: deterministic given the same inputs. Randomness in
 * Splendor Duel (shuffling decks, drawing tokens from the bag during a
 * replenish) is therefore threaded through an explicit seed carried in
 * `GameState.rngSeed` rather than read from `Math.random()`.
 *
 * Every function here takes a seed and returns the advanced seed alongside its
 * result, so callers thread the seed forward instead of mutating a generator.
 * Two consequences the engine depends on:
 *
 *   - A game is fully reproducible from (initial seed, action sequence). Bug
 *     reports, AI training runs and regression tests can all be replayed.
 *   - A state snapshot is self-contained: replaying from it yields the same
 *     draws, so a server can resynchronise a client without extra bookkeeping.
 *
 * The algorithm is mulberry32: a 32-bit generator with a full 2^32 period,
 * fast, and with distribution quality far beyond what shuffling 67 cards and
 * drawing 25 tokens requires. It is not cryptographically secure and must not
 * be used where unpredictability matters.
 */

/** A 32-bit PRNG state. Any integer is a valid seed. */
export type Seed = number;

/**
 * Advances the seed and returns a float in [0, 1) alongside it.
 * The returned seed must be used for the next draw; reusing the input seed
 * yields the same value again.
 */
export function nextRandom(seed: Seed): { value: number; seed: Seed } {
  const advanced = (seed + 0x6d2b79f5) | 0;
  let mixed = Math.imul(advanced ^ (advanced >>> 15), 1 | advanced);
  mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
  const value = ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  return { value, seed: advanced };
}

/**
 * Returns an integer in [0, boundExclusive) alongside the advanced seed.
 * A bound of 0 or less yields 0 and still advances the seed, so callers that
 * guard against an empty range cannot accidentally stall the generator.
 */
export function randomInt(seed: Seed, boundExclusive: number): { value: number; seed: Seed } {
  const drawn = nextRandom(seed);
  if (boundExclusive <= 0) return { value: 0, seed: drawn.seed };
  return { value: Math.floor(drawn.value * boundExclusive), seed: drawn.seed };
}

/**
 * Returns a shuffled copy of `items` alongside the advanced seed.
 * Fisher-Yates, so every permutation is equally likely.
 */
export function shuffle<T>(items: readonly T[], seed: Seed): { items: T[]; seed: Seed } {
  const shuffled = [...items];
  let currentSeed = seed;

  for (let index = shuffled.length - 1; index > 0; index--) {
    const drawn = randomInt(currentSeed, index + 1);
    currentSeed = drawn.seed;
    const swapIndex = drawn.value;
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return { items: shuffled, seed: currentSeed };
}

/**
 * Returns an unpredictable seed for starting a fresh game.
 *
 * This is the engine's only non-deterministic function and the only place
 * `Math.random()` is permitted. It is never called from the reducer — only from
 * `createInitialState` when the caller does not supply a seed of its own.
 */
export function randomSeed(): Seed {
  return (Math.random() * 0x100000000) | 0;
}
