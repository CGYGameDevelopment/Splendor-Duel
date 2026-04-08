import type { GameState, PlayerState, TokenPool, Card } from './types';
import { SPIRAL_ORDER } from './board';
import {
  emptyPool, PYRAMID_LEVEL1_COUNT, PYRAMID_LEVEL2_COUNT, PYRAMID_LEVEL3_COUNT,
  STARTING_GEM_COUNT, STARTING_PEARL_COUNT, STARTING_GOLD_COUNT, BOARD_SIZE,
  INITIAL_SECOND_PLAYER_PRIVILEGES, INITIAL_TABLE_PRIVILEGES_SECOND, INITIAL_TABLE_PRIVILEGES_FIRST,
} from './helpers';
import cardsData from './data/cards.json';

const ALL_CARDS: Card[] = cardsData as Card[];

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

function shuffle<T>(arr: T[]): T[] {
  const array = [...arr];
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/** Returns a fresh game state ready to play. secondPlayerGetsPrivilege = true by default. */
export function createInitialState(secondPlayerGetsPrivilege = true): GameState {
  // Separate cards by level (royal cards not yet in data — they'll be added later)
  const level1 = shuffle(ALL_CARDS.filter(card => card.level === 1));
  const level2 = shuffle(ALL_CARDS.filter(card => card.level === 2));
  const level3 = shuffle(ALL_CARDS.filter(card => card.level === 3));

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
    for (let i = 0; i < count; i++) tokenList.push(color);
  }
  const shuffledTokens = shuffle(tokenList);

  const board = new Array(BOARD_SIZE).fill(null);
  for (let i = 0; i < Math.min(shuffledTokens.length, BOARD_SIZE); i++) {
    board[SPIRAL_ORDER[i]] = shuffledTokens[i];
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
    royalDeck: [], // Royal cards added when provided
    privileges: tablePrivileges,
    players,
    currentPlayer: 0,
    phase: 'optional_privilege',
    extraTurns: 0,
    pendingAbility: null,
    lastPurchasedCard: null,
    winner: null,
    winCondition: null,
  };
}
