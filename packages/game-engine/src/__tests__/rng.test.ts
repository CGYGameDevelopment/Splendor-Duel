import { nextRandom, randomInt, shuffle, randomSeed } from '../rng';

describe('nextRandom', () => {
  it('returns the same value for the same seed', () => {
    // Arrange
    const seed = 12345;

    // Act
    const first = nextRandom(seed);
    const second = nextRandom(seed);

    // Assert
    expect(first.value).toBe(second.value);
    expect(first.seed).toBe(second.seed);
  });

  it('returns a value in [0, 1)', () => {
    // Arrange
    let seed = 1;

    // Act / Assert
    for (let draw = 0; draw < 1000; draw++) {
      const result = nextRandom(seed);
      expect(result.value).toBeGreaterThanOrEqual(0);
      expect(result.value).toBeLessThan(1);
      seed = result.seed;
    }
  });

  it('produces different values as the seed advances', () => {
    // Arrange
    let seed = 99;
    const values = new Set<number>();

    // Act
    for (let draw = 0; draw < 500; draw++) {
      const result = nextRandom(seed);
      values.add(result.value);
      seed = result.seed;
    }

    // Assert — a 32-bit generator should not repeat within 500 draws
    expect(values.size).toBe(500);
  });
});

describe('randomInt', () => {
  it('stays within [0, boundExclusive)', () => {
    // Arrange
    let seed = 7;

    // Act / Assert
    for (let draw = 0; draw < 1000; draw++) {
      const result = randomInt(seed, 5);
      expect(result.value).toBeGreaterThanOrEqual(0);
      expect(result.value).toBeLessThan(5);
      expect(Number.isInteger(result.value)).toBe(true);
      seed = result.seed;
    }
  });

  it('covers every value in a small range', () => {
    // Arrange
    let seed = 2024;
    const seen = new Set<number>();

    // Act
    for (let draw = 0; draw < 500; draw++) {
      const result = randomInt(seed, 3);
      seen.add(result.value);
      seed = result.seed;
    }

    // Assert
    expect([...seen].sort()).toEqual([0, 1, 2]);
  });

  it('yields 0 and still advances the seed for a non-positive bound', () => {
    // Arrange
    const seed = 42;

    // Act
    const result = randomInt(seed, 0);

    // Assert
    expect(result.value).toBe(0);
    expect(result.seed).not.toBe(seed);
  });
});

describe('shuffle', () => {
  it('returns the same permutation for the same seed', () => {
    // Arrange
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

    // Act
    const first = shuffle(items, 555);
    const second = shuffle(items, 555);

    // Assert
    expect(first.items).toEqual(second.items);
    expect(first.seed).toBe(second.seed);
  });

  it('preserves every element exactly once', () => {
    // Arrange
    const items = Array.from({ length: 67 }, (_, index) => index);

    // Act
    const result = shuffle(items, 888);

    // Assert
    expect([...result.items].sort((a, b) => a - b)).toEqual(items);
  });

  it('does not mutate the input array', () => {
    // Arrange
    const items = [1, 2, 3, 4, 5];
    const before = [...items];

    // Act
    shuffle(items, 31337);

    // Assert
    expect(items).toEqual(before);
  });

  it('produces different permutations for different seeds', () => {
    // Arrange
    const items = Array.from({ length: 20 }, (_, index) => index);

    // Act
    const a = shuffle(items, 1);
    const b = shuffle(items, 2);

    // Assert
    expect(a.items).not.toEqual(b.items);
  });

  it('returns a copy for an empty or single-element input without advancing the seed', () => {
    // Arrange / Act
    const empty = shuffle([], 5);
    const single = shuffle([9], 5);

    // Assert
    expect(empty.items).toEqual([]);
    expect(empty.seed).toBe(5);
    expect(single.items).toEqual([9]);
    expect(single.seed).toBe(5);
  });
});

describe('randomSeed', () => {
  it('returns a 32-bit integer', () => {
    // Act / Assert
    for (let draw = 0; draw < 100; draw++) {
      const seed = randomSeed();
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(-2147483648);
      expect(seed).toBeLessThanOrEqual(2147483647);
    }
  });
});
