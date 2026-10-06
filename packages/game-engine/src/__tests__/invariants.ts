import type { GameState, TokenColor } from '../types';
import {
  TOKEN_COLORS, GEM_COLORS, MAX_TOKENS, MAX_PRIVILEGES, MAX_RESERVED, BOARD_SIZE,
  STARTING_GEM_COUNT, STARTING_PEARL_COUNT, STARTING_GOLD_COUNT,
  totalTokens, totalTokensByColor, totalPrivileges, totalCardCount, playerBonuses,
} from '../helpers';

/** Jewel cards in the data set. */
export const TOTAL_JEWEL_CARDS = 67;
/** Royal cards in the data set. */
export const TOTAL_ROYAL_CARDS = 4;

export const STARTING_TOKENS_BY_COLOR: Record<TokenColor, number> = {
  white: STARTING_GEM_COUNT,
  blue: STARTING_GEM_COUNT,
  green: STARTING_GEM_COUNT,
  red: STARTING_GEM_COUNT,
  black: STARTING_GEM_COUNT,
  pearl: STARTING_PEARL_COUNT,
  gold: STARTING_GOLD_COUNT,
};

/**
 * Everything that must be true of a Splendor Duel state at every point in a
 * game, regardless of how it was reached.
 *
 * These are the assertions a fuzz run leans on, so each failure message names
 * the invariant and the offending value — a bare `expect(x).toBe(y)` deep in a
 * 300-step playthrough is very hard to diagnose.
 *
 * Throws on the first violation. Returns nothing on success.
 */
export function assertStateInvariants(state: GameState, context = ''): void {
  const where = context ? ` (${context})` : '';
  const fail = (message: string): never => {
    throw new Error(`Invariant violated${where}: ${message}`);
  };

  // ── Token conservation ──────────────────────────────────────────────────────
  // Tokens only move between the bag, the board and the two players. None are
  // created or destroyed, so every color's total is fixed for the whole game.
  const byColor = totalTokensByColor(state);
  for (const color of TOKEN_COLORS) {
    if (byColor[color] !== STARTING_TOKENS_BY_COLOR[color]) {
      fail(`${color} token count is ${byColor[color]}, expected ${STARTING_TOKENS_BY_COLOR[color]}`);
    }
  }

  // ── Token pools are well-formed ─────────────────────────────────────────────
  // A non-integer or negative count means arithmetic ran on an unvalidated
  // payload; NaN in particular is invisible to the conservation sums above
  // because it propagates into the total rather than changing a known color.
  const pools: Array<[string, GameState['bag']]> = [
    ['bag', state.bag],
    ['player 0 tokens', state.players[0].tokens],
    ['player 1 tokens', state.players[1].tokens],
  ];
  for (const [label, pool] of pools) {
    const keys = Object.keys(pool);
    if (keys.length !== TOKEN_COLORS.length) {
      fail(`${label} has unexpected keys: ${keys.join(', ')}`);
    }
    for (const color of TOKEN_COLORS) {
      const count = pool[color];
      if (!Number.isInteger(count)) fail(`${label}.${color} is ${count}, expected an integer`);
      if (count < 0) fail(`${label}.${color} is negative (${count})`);
    }
  }

  // ── Token holdings ──────────────────────────────────────────────────────────
  // The 10-token limit is enforced by the Discard Check, which is step 2 of the
  // rulebook's END OF TURN sequence — not an immediate cap. So the player whose
  // turn it is may legitimately hold more than 10 part-way through: using a
  // privilege at the start of the turn can push them to 11 before they have
  // taken their mandatory action, and they are forced down again when the turn
  // ends. (A fuzz run found this; the engine was right and an earlier version of
  // this invariant was wrong.)
  //
  // What does always hold: no action adds tokens to the player who is *not* on
  // turn, and the Discard Check runs before the turn passes, so the opponent is
  // never over the limit.
  const idlePlayerId = (1 - state.currentPlayer) as 0 | 1;
  const idleHeld = totalTokens(state.players[idlePlayerId].tokens);
  if (idleHeld > MAX_TOKENS) {
    fail(`player ${idlePlayerId} holds ${idleHeld} tokens while not on turn`);
  }

  // ── Privilege conservation ──────────────────────────────────────────────────
  // Three scrolls exist and are never created or destroyed; they only move
  // between the table and the two players.
  const privileges = totalPrivileges(state);
  if (privileges !== MAX_PRIVILEGES) {
    fail(`total privileges is ${privileges}, expected ${MAX_PRIVILEGES}`);
  }
  if (state.privileges < 0) fail(`table privileges is negative (${state.privileges})`);
  for (const playerId of [0, 1] as const) {
    const held = state.players[playerId].privileges;
    if (held < 0) fail(`player ${playerId} privileges is negative (${held})`);
    if (held > MAX_PRIVILEGES) fail(`player ${playerId} holds ${held} privileges`);
  }

  // ── Card conservation ───────────────────────────────────────────────────────
  const cards = totalCardCount(state);
  if (cards.jewel !== TOTAL_JEWEL_CARDS) {
    fail(`jewel card count is ${cards.jewel}, expected ${TOTAL_JEWEL_CARDS}`);
  }
  if (cards.royal !== TOTAL_ROYAL_CARDS) {
    fail(`royal card count is ${cards.royal}, expected ${TOTAL_ROYAL_CARDS}`);
  }

  // ── No card exists in two places at once ────────────────────────────────────
  // Jewel and royal ids are separate namespaces that overlap, so uniqueness is
  // checked per namespace.
  const jewelZoneCards = [
    ...state.decks.level1, ...state.decks.level2, ...state.decks.level3,
    ...state.pyramid.level1, ...state.pyramid.level2, ...state.pyramid.level3,
    ...state.players[0].purchasedCards, ...state.players[0].reservedCards,
    ...state.players[1].purchasedCards, ...state.players[1].reservedCards,
  ];
  const jewelIds = jewelZoneCards.map(card => card.id);
  if (new Set(jewelIds).size !== jewelIds.length) {
    fail('a jewel card appears in more than one zone');
  }
  const royalZoneCards = [
    ...state.royalDeck, ...state.players[0].royalCards, ...state.players[1].royalCards,
  ];
  const royalIds = royalZoneCards.map(card => card.id);
  if (new Set(royalIds).size !== royalIds.length) {
    fail('a royal card appears in more than one zone');
  }

  // ── The two decks never mix ─────────────────────────────────────────────────
  // Jewel and royal cards are separate decks with separate id spaces, so the
  // uniqueness checks above are only sound while each zone holds its own kind:
  // a royal card sitting in a jewel zone would be compared against jewel ids it
  // shares numbers with. `level` is what tells the two apart.
  for (const card of jewelZoneCards) {
    if (card.level === 'royal') {
      fail(`royal card ${card.id} is in a jewel zone`);
    }
  }
  for (const card of royalZoneCards) {
    if (card.level !== 'royal') {
      fail(`jewel card ${card.id} (level ${card.level}) is in a royal zone`);
    }
  }

  // ── Reserve limit ───────────────────────────────────────────────────────────
  for (const playerId of [0, 1] as const) {
    const reserved = state.players[playerId].reservedCards.length;
    if (reserved > MAX_RESERVED) {
      fail(`player ${playerId} has ${reserved} reserved cards, max is ${MAX_RESERVED}`);
    }
  }

  // ── Board shape ─────────────────────────────────────────────────────────────
  if (state.board.length !== BOARD_SIZE) {
    fail(`board has ${state.board.length} cells, expected ${BOARD_SIZE}`);
  }
  for (const [index, cell] of state.board.entries()) {
    if (cell !== null && !(TOKEN_COLORS as string[]).includes(cell)) {
      fail(`board cell ${index} holds "${cell}", which is not a token color`);
    }
  }

  // ── Derived player stats match their cards ──────────────────────────────────
  // prestige and crowns are maintained incrementally by the reducer, so they can
  // drift from the cards that justify them. Recompute and compare.
  for (const playerId of [0, 1] as const) {
    const player = state.players[playerId];

    const expectedCrowns = player.purchasedCards.reduce((sum, card) => sum + card.crowns, 0)
      + player.royalCards.reduce((sum, card) => sum + card.crowns, 0);
    if (player.crowns !== expectedCrowns) {
      fail(`player ${playerId} crowns is ${player.crowns}, cards justify ${expectedCrowns}`);
    }

    const expectedPrestige = player.purchasedCards.reduce((sum, card) => sum + card.points, 0)
      + player.royalCards.reduce((sum, card) => sum + card.points, 0);
    if (player.prestige !== expectedPrestige) {
      fail(`player ${playerId} prestige is ${player.prestige}, cards justify ${expectedPrestige}`);
    }

    // Bonuses are derived, so this guards the wild-assignment path: an
    // unassigned wild must not contribute a gem bonus.
    const bonuses = playerBonuses(player);
    for (const color of GEM_COLORS) {
      if (!Number.isInteger(bonuses[color]) || bonuses[color] < 0) {
        fail(`player ${playerId} ${color} bonus is ${bonuses[color]}`);
      }
    }
  }

  // ── Royal deck size ─────────────────────────────────────────────────────────
  if (state.royalDeck.length > TOTAL_ROYAL_CARDS) {
    fail(`royalDeck holds ${state.royalDeck.length} cards`);
  }

  // ── Terminal state consistency ──────────────────────────────────────────────
  if (state.phase === 'game_over') {
    if (state.winner === null) fail('game_over with no winner');
    if (state.winCondition === null) fail('game_over with no win condition');
  } else if (state.winner !== null) {
    fail(`winner is set to ${state.winner} but the phase is ${state.phase}`);
  }

  // ── Wild cards ──────────────────────────────────────────────────────────────
  // An assigned color is permanent, so it must always be a real gem color.
  for (const playerId of [0, 1] as const) {
    for (const card of state.players[playerId].purchasedCards) {
      if (card.assignedColor !== null && !(GEM_COLORS as string[]).includes(card.assignedColor)) {
        fail(`player ${playerId} card ${card.id} has assignedColor "${card.assignedColor}"`);
      }
    }
  }

  // ── Seed ────────────────────────────────────────────────────────────────────
  if (!Number.isInteger(state.rngSeed)) {
    fail(`rngSeed is ${state.rngSeed}, expected an integer`);
  }
}
