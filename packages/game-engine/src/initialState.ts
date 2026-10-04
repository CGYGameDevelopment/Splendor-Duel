import type { GameState, PlayerState, TokenPool, Card } from './types';
import { SPIRAL_ORDER } from './board';
import { shuffle, randomSeed, type Seed } from './rng';
import {
  emptyPool, PYRAMID_LEVEL1_COUNT, PYRAMID_LEVEL2_COUNT, PYRAMID_LEVEL3_COUNT,
  STARTING_GEM_COUNT, STARTING_PEARL_COUNT, STARTING_GOLD_COUNT, BOARD_SIZE,
  INITIAL_SECOND_PLAYER_PRIVILEGES, INITIAL_TABLE_PRIVILEGES_SECOND, INITIAL_TABLE_PRIVILEGES_FIRST,
} from './helpers';
import cardsData from './data/jewel-cards.json';
import royalCardsData from './data/royal-cards.json';

const ALL_CARDS: Card[] = cardsData as Card[];
const ALL_ROYAL_CARDS: Card[] = royalCardsData as Card[];

function makePlayer(): PlayerState {
  return {
    tokens: emptyPool(),
    purchasedCards: [],
    reservedCards: [],
    privileges: 0,
    crowns: 0,
    prestige: 0,
    royalCards: [],
  };
}

/**
 * Returns a fresh game state ready to play.
 *
 * `seed` makes the whole game reproducible: the same seed always produces the
 * same deck order, the same board layout and the same bag draws during later
 * replenishes. Omit it for a real game and an unpredictable seed is drawn;
 * pass one in tests, AI training runs and bug reproductions. Callers that need
 * to replay a game later should record the seed they passed, or read the seed
 * back off `state.rngSeed` before the first action is dispatched.
 */
export function createInitialState(
  secondPlayerGetsPrivilege = true,
  seed: Seed = randomSeed(),
): GameState {
  let rngSeed = seed;

  const shuffled = <T>(items: readonly T[]): T[] => {
    const result = shuffle(items, rngSeed);
    rngSeed = result.seed;
    return result.items;
  };

  const level1 = shuffled(ALL_CARDS.filter(card => card.level === 1));
  const level2 = shuffled(ALL_CARDS.filter(card => card.level === 2));
  const level3 = shuffled(ALL_CARDS.filter(card => card.level === 3));
  const royalDeck = shuffled(ALL_ROYAL_CARDS);

  // Reveal pyramid: PYRAMID_LEVEL1_COUNT, PYRAMID_LEVEL2_COUNT, PYRAMID_LEVEL3_COUNT
  const pyramid = {
    level1: level1.slice(0, PYRAMID_LEVEL1_COUNT),
    level2: level2.slice(0, PYRAMID_LEVEL2_COUNT),
    level3: level3.slice(0, PYRAMID_LEVEL3_COUNT),
  };
  const decks = {
    level1: level1.slice(PYRAMID_LEVEL1_COUNT),
    level2: level2.slice(PYRAMID_LEVEL2_COUNT),
    level3: level3.slice(PYRAMID_LEVEL3_COUNT),
  };

  // Build and place tokens on board in spiral order
  const startingTokens: TokenPool = {
    black: STARTING_GEM_COUNT,
    red: STARTING_GEM_COUNT,
    green: STARTING_GEM_COUNT,
    blue: STARTING_GEM_COUNT,
    white: STARTING_GEM_COUNT,
    pearl: STARTING_PEARL_COUNT,
    gold: STARTING_GOLD_COUNT,
  };

  // Flatten tokens into a shuffled bag, then place on spiral
  const tokenList: Array<keyof TokenPool> = [];
  for (const [color, count] of Object.entries(startingTokens) as [keyof TokenPool, number][]) {
    for (let tokenIndex = 0; tokenIndex < count; tokenIndex++) tokenList.push(color);
  }
  const shuffledTokens = shuffled(tokenList);

  const board = new Array(BOARD_SIZE).fill(null);
  for (let spiralIndex = 0; spiralIndex < Math.min(shuffledTokens.length, BOARD_SIZE); spiralIndex++) {
    board[SPIRAL_ORDER[spiralIndex]] = shuffledTokens[spiralIndex];
  }

  const bag = emptyPool(); // all tokens start on board

  const players: [PlayerState, PlayerState] = [makePlayer(), makePlayer()];

  // Second player (index 1) gets 1 privilege to compensate for going second
  if (secondPlayerGetsPrivilege) {
    players[1] = { ...players[1], privileges: INITIAL_SECOND_PLAYER_PRIVILEGES };
  }
  const tablePrivileges = secondPlayerGetsPrivilege ? INITIAL_TABLE_PRIVILEGES_SECOND : INITIAL_TABLE_PRIVILEGES_FIRST;

  return {
    board,
    bag,
    pyramid,
    decks,
    royalDeck,
    privileges: tablePrivileges,
    players,
    currentPlayer: 0,
    phase: 'mandatory',
    repeatTurn: false,
    pendingCrownCheck: false,
    pendingAbility: null,
    lastPurchasedCard: null,
    winner: null,
    winCondition: null,
    rngSeed,
  };
}
