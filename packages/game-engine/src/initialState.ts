import type { GameState, PlayerState, TokenPool, Card } from './types';
import { SPIRAL_ORDER } from './board';
import { emptyPool } from './helpers';
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
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Returns a fresh game state ready to play. secondPlayerGetsPrivilege = true by default. */
export function createInitialState(secondPlayerGetsPrivilege = true): GameState {
  // Separate cards by level (royal cards not yet in data — they'll be added later)
  const level1 = shuffle(ALL_CARDS.filter(c => c.level === 1));
  const level2 = shuffle(ALL_CARDS.filter(c => c.level === 2));
  const level3 = shuffle(ALL_CARDS.filter(c => c.level === 3));

  // Reveal pyramid: 5 level-1, 4 level-2, 3 level-3
  const pyramid = {
    level1: level1.slice(0, 5),
    level2: level2.slice(0, 4),
    level3: level3.slice(0, 3),
  };
  const decks = {
    level1: level1.slice(5),
    level2: level2.slice(4),
    level3: level3.slice(3),
  };

  // Build and place tokens on board in spiral order
  const startingTokens: TokenPool = {
    black: 4, red: 4, green: 4, blue: 4, white: 4, pearl: 2, gold: 3,
  };

  // Flatten tokens into a shuffled bag, then place on spiral
  const tokenList: Array<keyof TokenPool> = [];
  for (const [color, count] of Object.entries(startingTokens) as [keyof TokenPool, number][]) {
    for (let i = 0; i < count; i++) tokenList.push(color);
  }
  const shuffledTokens = shuffle(tokenList);

  const board = new Array(25).fill(null);
  for (let i = 0; i < Math.min(shuffledTokens.length, 25); i++) {
    board[SPIRAL_ORDER[i]] = shuffledTokens[i];
  }

  const bag = emptyPool(); // all tokens start on board

  const players: [PlayerState, PlayerState] = [makePlayer(), makePlayer()];

  // Second player (index 1) gets 1 privilege to compensate for going second
  if (secondPlayerGetsPrivilege) {
    players[1] = { ...players[1], privileges: 1 };
  }
  const tablePrivileges = secondPlayerGetsPrivilege ? 2 : 3;

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
