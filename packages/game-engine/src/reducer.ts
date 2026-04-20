import type {
  GameState, Action, PlayerState, PlayerId, Card, TokenColor, GemColor, TokenPool,
} from './types';
import { SPIRAL_ORDER, isValidTokenLine } from './board';
import {
  emptyPool, totalTokens, netCost, canAfford, grantPrivileges,
  checkVictory, GEM_COLORS, TOKEN_COLORS, MAX_TOKENS, MAX_RESERVED, MAX_PRIVILEGES,
  CROWN_MILESTONES, CARD_LEVELS, PENALTY_SAME_COLOR_COUNT, PENALTY_PEARL_COUNT,
} from './helpers';

// ─── Immutable player updater ─────────────────────────────────────────────────

function updatePlayer(state: GameState, id: PlayerId, playerStateUpdate: Partial<PlayerState>): GameState {
  const players: [PlayerState, PlayerState] = [{ ...state.players[0] }, { ...state.players[1] }];
  players[id] = { ...players[id], ...playerStateUpdate };
  return { ...state, players };
}

// ─── Replenish board from bag ─────────────────────────────────────────────────

function replenishBoard(state: GameState): GameState {
  let bag = { ...state.bag };
  const board = [...state.board];

  for (const index of SPIRAL_ORDER) {
    if (board[index] !== null) continue; // already occupied
    // Find a color available in bag
    const available = TOKEN_COLORS.filter(c => bag[c] > 0);
    if (available.length === 0) break;
    // Pick randomly (deterministic in tests; real game shuffles)
    const color = available[Math.floor(Math.random() * available.length)];
    board[index] = color;
    bag = { ...bag, [color]: bag[color] - 1 };
  }

  return { ...state, board, bag };
}

// ─── Replace pyramid slot ─────────────────────────────────────────────────────

function refillPyramidSlot(
  state: GameState,
  level: 1 | 2 | 3,
  removedCardId: number
): GameState {
  const levelKey = `level${level}` as 'level1' | 'level2' | 'level3';
  const pyramid = { ...state.pyramid, [levelKey]: state.pyramid[levelKey].filter(c => c.id !== removedCardId) };
  const decks = { ...state.decks };

  if (decks[levelKey].length > 0) {
    const [next, ...rest] = decks[levelKey];
    pyramid[levelKey] = [...pyramid[levelKey], next];
    decks[levelKey] = rest;
  }

  return { ...state, pyramid, decks };
}

// ─── Pyramid card lookup ──────────────────────────────────────────────────────

function findCardInPyramid(
  pyramid: GameState['pyramid'],
  cardId: number
): { card: Card; level: 1 | 2 | 3 } | null {
  for (const lvl of CARD_LEVELS) {
    const key = `level${lvl}` as 'level1' | 'level2' | 'level3';
    const found = pyramid[key].find(c => c.id === cardId);
    if (found) return { card: found, level: lvl };
  }
  return null;
}

function locateCardForPurchase(
  pyramid: GameState['pyramid'],
  reservedCards: Card[],
  cardId: number
): { card: Card; fromReserve: boolean; level?: 1 | 2 | 3 } | null {
  const pyramidResult = findCardInPyramid(pyramid, cardId);
  if (pyramidResult) return { card: pyramidResult.card, fromReserve: false, level: pyramidResult.level };
  const found = reservedCards.find(c => c.id === cardId);
  if (found) return { card: found, fromReserve: true };
  return null;
}

// ─── Token cost deduction ─────────────────────────────────────────────────────

function deductTokenCost(
  playerTokens: TokenPool,
  bag: TokenPool,
  cost: Partial<Record<TokenColor, number>>,
  goldUsage: Partial<Record<GemColor | 'pearl', number>>
): { playerTokens: TokenPool; bag: TokenPool } {
  let tokens = { ...playerTokens };
  let newBag = { ...bag };
  let goldSpent = 0;

  for (const [colorStr, needed] of Object.entries(cost) as [TokenColor, number][]) {
    const gold = goldUsage[colorStr as GemColor | 'pearl'] ?? 0;
    const fromWallet = needed - gold;
    tokens = { ...tokens, [colorStr]: tokens[colorStr] - fromWallet };
    newBag = { ...newBag, [colorStr]: newBag[colorStr] + fromWallet };
    goldSpent += gold;
  }
  tokens = { ...tokens, gold: tokens.gold - goldSpent };
  newBag = { ...newBag, gold: newBag.gold + goldSpent };

  return { playerTokens: tokens, bag: newBag };
}

// ─── Purchase application ─────────────────────────────────────────────────────

// Applies the mechanical effects of buying a card: deducts tokens, updates player
// stats, removes card from its source, and refills the pyramid slot if applicable.
// Does NOT resolve abilities or check crown milestones — caller is responsible.
function applyPurchase(
  state: GameState,
  cp: PlayerId,
  purchasedCard: Card,
  fromReserve: boolean,
  level: 1 | 2 | 3 | undefined,
  goldUsage: Partial<Record<GemColor | 'pearl', number>>
): GameState {
  const player = state.players[cp];
  const cost = netCost(purchasedCard, player);
  const { playerTokens, bag } = deductTokenCost(player.tokens, state.bag, cost, goldUsage);

  const purchasedCards = [...player.purchasedCards, purchasedCard];
  const reservedCards = fromReserve
    ? player.reservedCards.filter(c => c.id !== purchasedCard.id)
    : player.reservedCards;
  const crowns = player.crowns + purchasedCard.crowns;
  const prestige = player.prestige + purchasedCard.points;

  let newState = updatePlayer(state, cp, { tokens: playerTokens, purchasedCards, reservedCards, crowns, prestige });
  newState = { ...newState, bag, lastPurchasedCard: purchasedCard };

  if (!fromReserve && level) {
    newState = refillPyramidSlot(newState, level, purchasedCard.id);
  }

  return newState;
}

// ─── Post-purchase transition ─────────────────────────────────────────────────

// Determines the next phase after a card purchase.
// If an interactive ability is pending, defers the crown check via pendingCrownCheck.
// Note: crossing both milestones (3 and 6) in a single purchase is impossible —
// no card awards more than 3 crowns, so at most one milestone can cross per purchase.
function postPurchaseTransition(state: GameState, milestoneCrossed: boolean): GameState {
  if (state.phase === 'resolve_ability' || state.phase === 'assign_wild') {
    return milestoneCrossed ? { ...state, pendingCrownCheck: true } : state;
  }
  if (milestoneCrossed) return { ...state, phase: 'choose_royal' };
  return endOfTurnSequence(state);
}

// ─── Phase 4: End of Turn Sequence ───────────────────────────────────────────
//
// Mirrors the rulebook's Phase 4 order:
//   4.1  Victory Check
//   4.2  Discard Check  (may park the game in 'discard' phase)
//   4.3  Advance Turn   (repeat or switch player)
//
// Call endOfTurnSequence after every mandatory action (including ability and
// royal-card resolution). Call advanceTurn directly after DISCARD_TOKENS —
// victory was already verified before the discard phase was entered, and no
// victory-relevant state can change during a discard, so step 4.1 is skipped.

// Phase 4.3 — repeat or switch player.
function advanceTurn(state: GameState): GameState {
  const cp = state.currentPlayer;
  const nextPlayerId = state.repeatTurn ? cp : (1 - cp) as PlayerId;
  const nextPlayer = state.players[nextPlayerId];
  const bagEmpty = totalTokens(state.bag) === 0;
  const phase = nextPlayer.privileges > 0
    ? 'optional_privilege'
    : bagEmpty ? 'mandatory' : 'optional_replenish';

  if (state.repeatTurn) {
    return { ...state, repeatTurn: false, phase, lastPurchasedCard: null };
  }
  return { ...state, currentPlayer: nextPlayerId, phase, lastPurchasedCard: null };
}

// Phase 4 (full) — steps 4.1 → 4.2 → 4.3.
function endOfTurnSequence(state: GameState): GameState {
  const cp = state.currentPlayer;
  const player = state.players[cp];

  // 4.1 Victory Check
  const victoryCondition = checkVictory(player);
  if (victoryCondition) {
    return {
      ...state,
      phase: 'game_over',
      winner: cp,
      winCondition: victoryCondition,
    };
  }

  // 4.2 Discard Check
  if (totalTokens(player.tokens) > MAX_TOKENS) {
    return { ...state, phase: 'discard' };
  }

  // 4.3 Advance Turn
  return advanceTurn(state);
}

// ─── Resolve card ability ─────────────────────────────────────────────────────
// Returns updated state but does NOT call endOfTurnSequence — the caller is responsible.
// Interactive abilities (Token, Take, Wild) set an intermediate phase; the
// caller must call endOfTurnSequence after the player resolves those actions.

function resolveAbility(state: GameState, card: Card): GameState {
  if (!card.ability) return state;

  switch (card.ability) {
    case 'Turn': {
      return {
        ...state,
        repeatTurn: true,
        pendingAbility: null,
        lastPurchasedCard: null,
      };
    }

    case 'Privilege': {
      const { privileges, players } = grantPrivileges(state, state.currentPlayer, 1);
      return { ...state, privileges, players, pendingAbility: null };
    }

    case 'Token': {
      // Player must take 1 token matching the card's effective color from the board
      // If card has no gem color, skip the token effect
      if (card.color === 'wild' || card.color === null) {
        return { ...state, pendingAbility: null };
      }
      const color = card.color as TokenColor;
      const hasToken = state.board.some(cell => cell === color);
      if (!hasToken) return { ...state, pendingAbility: null };
      return { ...state, phase: 'resolve_ability', pendingAbility: 'Token', lastPurchasedCard: card };
    }

    case 'Take': {
      const opp = (1 - state.currentPlayer) as PlayerId;
      const oppTokens = state.players[opp].tokens;
      const hasEligible = GEM_COLORS.some(c => oppTokens[c] > 0) || oppTokens.pearl > 0;
      if (!hasEligible) return { ...state, pendingAbility: null };
      return { ...state, phase: 'resolve_ability', pendingAbility: 'Take', lastPurchasedCard: card };
    }

    case 'Wild':
    case 'Wild/Turn': {
      // Player must own at least one Jewel Card with a GemColor to assign this wild
      const player = state.players[state.currentPlayer];
      const hasColoredCard = player.purchasedCards.some(
        c => c.id !== card.id && c.color !== 'wild' && c.color !== null
      );
      if (!hasColoredCard) {
        return { ...state, pendingAbility: null };
      }
      return { ...state, phase: 'assign_wild', pendingAbility: card.ability, lastPurchasedCard: card };
    }

    default:
      return { ...state, pendingAbility: null };
  }
}

// ─── Main reducer ─────────────────────────────────────────────────────────────

export function reducer(state: GameState, action: Action): GameState {
  const cp = state.currentPlayer;
  const player = state.players[cp];

  switch (action.type) {

    case 'END_OPTIONAL_PHASE': {
      if (state.phase === 'optional_privilege') {
        return { ...state, phase: totalTokens(state.bag) === 0 ? 'mandatory' : 'optional_replenish' };
      }
      if (state.phase === 'optional_replenish') return { ...state, phase: 'mandatory' };
      return state;
    }

    case 'SKIP_TO_MANDATORY': {
      if (state.phase === 'optional_privilege' || state.phase === 'optional_replenish') {
        return { ...state, phase: 'mandatory' };
      }
      return state;
    }

    // ── Optional: Use Privilege ───────────────────────────────────────────────
    case 'USE_PRIVILEGE': {
      if (state.phase !== 'optional_privilege') return state;
      const { indices } = action;
      const privilegesUsed = indices.length;

      // Validate: must use at least 1 privilege, can't exceed privileges held
      if (privilegesUsed === 0 || privilegesUsed > player.privileges) return state;

      // Validate: no duplicate indices
      if (new Set(indices).size !== indices.length) return state;

      let board = [...state.board];
      let playerTokens = { ...player.tokens };
      const tablePrivileges = state.privileges + privilegesUsed;

      for (const idx of indices) {
        const cell = board[idx];
        if (!cell || cell === 'gold') return state; // cell must have a non-gold token
        board[idx] = null;
        playerTokens = { ...playerTokens, [cell]: playerTokens[cell] + 1 };
      }

      const newPrivileges = player.privileges - privilegesUsed;
      let newState = updatePlayer(state, cp, { tokens: playerTokens, privileges: newPrivileges });
      newState = { ...newState, board, privileges: tablePrivileges };

      // Stay in optional_privilege phase so the player can use additional privileges one at a time.
      // The rulebook says "Return 1 or more Privilege Scrolls" as a single decision, which could
      // imply the player must commit all scrolls upfront. However, allowing sequential single-scroll
      // actions is intentional here: legalMoves already generates all multi-index combinations for
      // AI/automated clients that want to commit atomically, and the small information advantage this
      // gives a human player is acceptable for this implementation.
      return newState;
    }

    // ── Optional: Replenish Board ─────────────────────────────────────────────
    case 'REPLENISH_BOARD': {
      if (state.phase !== 'optional_replenish' && state.phase !== 'mandatory') return state;
      if (totalTokens(state.bag) === 0) return state;
      let newState = replenishBoard(state);
      // Opponent gets 1 privilege as penalty
      const opp = (1 - cp) as PlayerId;
      const { privileges, players } = grantPrivileges(newState, opp, 1);
      newState = { ...newState, privileges, players, phase: 'mandatory' };
      return newState;
    }

    // ── Mandatory: Take Tokens ────────────────────────────────────────────────
    case 'TAKE_TOKENS': {
      if (state.phase !== 'mandatory') return state;
      const { indices } = action;
      if (!isValidTokenLine(indices)) return state;

      const board = [...state.board];
      let playerTokens = { ...player.tokens };
      const taken: TokenColor[] = [];

      for (const idx of indices) {
        const color = board[idx];
        if (!color || color === 'gold') return state;
        board[idx] = null;
        playerTokens = { ...playerTokens, [color]: playerTokens[color] + 1 };
        taken.push(color);
      }

      // Penalty: PENALTY_SAME_COLOR_COUNT same color or PENALTY_PEARL_COUNT pearls → opponent gets 1 privilege
      const allSame = taken.length === PENALTY_SAME_COLOR_COUNT && taken.every(c => c === taken[0]);
      const twoPearls = taken.filter(c => c === 'pearl').length >= PENALTY_PEARL_COUNT;
      let newState = updatePlayer(state, cp, { tokens: playerTokens });
      newState = { ...newState, board };

      if (allSame || twoPearls) {
        const opp = (1 - cp) as PlayerId;
        const { privileges, players } = grantPrivileges(newState, opp, 1);
        newState = { ...newState, privileges, players };
      }

      return endOfTurnSequence(newState);
    }

    // ── Mandatory: Reserve Card (from pyramid by id) ──────────────────────────
    case 'RESERVE_CARD_FROM_PYRAMID': {
      if (state.phase !== 'mandatory') return state;
      if (player.reservedCards.length >= MAX_RESERVED) return state;

      const board = [...state.board];
      const goldIdx = board.findIndex(c => c === 'gold');
      if (goldIdx === -1) return state;

      // Find card in pyramid
      const pyramidResult = findCardInPyramid(state.pyramid, action.cardId);
      if (!pyramidResult) return state;
      const { card, level } = pyramidResult;

      board[goldIdx] = null;
      const playerTokens = { ...player.tokens, gold: player.tokens.gold + 1 };
      const reservedCards = [...player.reservedCards, card];

      let newState = updatePlayer(state, cp, { tokens: playerTokens, reservedCards });
      newState = { ...newState, board };
      newState = refillPyramidSlot(newState, level, card.id);
      return endOfTurnSequence(newState);
    }

    // ── Mandatory: Reserve Card (from deck top) ───────────────────────────────
    case 'RESERVE_CARD': {
      if (state.phase !== 'mandatory') return state;
      if (player.reservedCards.length >= MAX_RESERVED) return state;

      const board = [...state.board];
      const goldIdx = board.findIndex(c => c === 'gold');
      if (goldIdx === -1) return state;

      const sourceToLevel: Record<'deck_1' | 'deck_2' | 'deck_3', 1 | 2 | 3> = { deck_1: 1, deck_2: 2, deck_3: 3 };
      const level = sourceToLevel[action.source];
      const key = `level${level}` as 'level1' | 'level2' | 'level3';

      if (state.decks[key].length === 0) return state;
      const [card, ...rest] = state.decks[key];

      board[goldIdx] = null;
      const playerTokens = { ...player.tokens, gold: player.tokens.gold + 1 };
      const reservedCards = [...player.reservedCards, card];

      let newState = updatePlayer(state, cp, { tokens: playerTokens, reservedCards });
      newState = { ...newState, board, decks: { ...state.decks, [key]: rest } };
      return endOfTurnSequence(newState);
    }

    // ── Mandatory: Purchase Card ──────────────────────────────────────────────
    case 'PURCHASE_CARD': {
      if (state.phase !== 'mandatory') return state;
      const { cardId, goldUsage } = action;

      const location = locateCardForPurchase(state.pyramid, player.reservedCards, cardId);
      if (!location) return state;
      const { card, fromReserve, level } = location;

      if (!canAfford(card, player, goldUsage)) return state;

      const purchasedCard = { ...card };

      const prevCrowns = player.crowns;
      let newState = applyPurchase(state, cp, purchasedCard, fromReserve, level, goldUsage);

      const milestoneCrossed = CROWN_MILESTONES.some(m => prevCrowns < m && newState.players[cp].crowns >= m)
        && newState.royalDeck.length > 0;

      newState = resolveAbility(newState, purchasedCard);
      return postPurchaseTransition(newState, milestoneCrossed);
    }

    // ── Choose Royal Card (crown milestone) ──────────────────────────────────
    case 'CHOOSE_ROYAL_CARD': {
      if (state.phase !== 'choose_royal') return state;
      const royalCard = state.royalDeck.find(c => c.id === action.cardId);
      if (!royalCard) return state;

      const royalDeck = state.royalDeck.filter(c => c.id !== action.cardId);

      let newState = updatePlayer(state, cp, {
        royalCards: [...player.royalCards, royalCard],
        prestige: player.prestige + royalCard.points,
      });
      newState = { ...newState, royalDeck, pendingCrownCheck: false };
      newState = resolveAbility(newState, royalCard);
      if (newState.phase === 'resolve_ability') return newState;
      return endOfTurnSequence(newState);
    }

    // ── Ability: Assign Wild card color ──────────────────────────────────────
    case 'ASSIGN_WILD_COLOR': {
      if (state.phase !== 'assign_wild') return state;
      const { wildCardId, color } = action;
      const wildCard = player.purchasedCards.find(c => c.id === wildCardId);
      if (!wildCard || wildCard.color !== 'wild') return state;

      // Validate: player owns at least one Jewel Card with this color
      const hasColor = player.purchasedCards.some(
        c => c.id !== wildCardId && c.color !== 'wild' && c.color !== null && c.color === color
      );
      if (!hasColor) return state;

      const updatedCards = player.purchasedCards.map(c =>
        c.id === wildCardId ? { ...c, assignedColor: color } : c
      );
      let newState = updatePlayer(state, cp, { purchasedCards: updatedCards });

      // If Wild/Turn, grant an extra turn
      if (state.pendingAbility === 'Wild/Turn') {
        newState = { ...newState, repeatTurn: true, pendingAbility: null };
      } else {
        newState = { ...newState, pendingAbility: null };
      }

      if (newState.pendingCrownCheck) return { ...newState, phase: 'choose_royal', pendingCrownCheck: false };
      return endOfTurnSequence(newState);
    }

    // ── Ability: Token — take 1 token of card's color from board ─────────────
    case 'TAKE_TOKEN_FROM_BOARD': {
      if (state.phase !== 'resolve_ability') return state;
      const { index } = action;
      const card = state.lastPurchasedCard;
      if (!card) return state;

      const color = card.color as TokenColor;
      const board = [...state.board];
      if (board[index] !== color) return state;

      board[index] = null;
      const playerTokens = { ...player.tokens, [color]: player.tokens[color] + 1 };
      let newState = updatePlayer(state, cp, { tokens: playerTokens });
      newState = { ...newState, board, pendingAbility: null, lastPurchasedCard: null };
      if (newState.pendingCrownCheck) return { ...newState, phase: 'choose_royal', pendingCrownCheck: false };
      return endOfTurnSequence(newState);
    }

    // ── Ability: Take — take 1 gem/pearl from opponent ────────────────────────
    case 'TAKE_TOKEN_FROM_OPPONENT': {
      if (state.phase !== 'resolve_ability') return state;
      const { color } = action;
      if (color === 'gold') return state;

      const opp = (1 - cp) as PlayerId;
      const oppTokens = state.players[opp].tokens;
      if (oppTokens[color] === 0) return state;

      let newState = updatePlayer(state, opp, {
        tokens: { ...oppTokens, [color]: oppTokens[color] - 1 },
      });
      const newPlayerTokens = { ...newState.players[cp].tokens, [color]: newState.players[cp].tokens[color] + 1 };
      newState = updatePlayer(newState, cp, { tokens: newPlayerTokens });
      newState = { ...newState, pendingAbility: null, lastPurchasedCard: null };
      if (newState.pendingCrownCheck) return { ...newState, phase: 'choose_royal', pendingCrownCheck: false };
      return endOfTurnSequence(newState);
    }

    // ── Pass mandatory (deadlock — no legal moves exist) ─────────────────────
    case 'PASS_MANDATORY': {
      if (state.phase !== 'mandatory') return state;
      return endOfTurnSequence(state);
    }

    // ── Discard tokens ────────────────────────────────────────────────────────
    case 'DISCARD_TOKENS': {
      if (state.phase !== 'discard') return state;
      let playerTokens = { ...player.tokens };
      let bag = { ...state.bag };

      const colors = Object.keys(action.tokens) as TokenColor[];
      if (colors.length !== 1 || action.tokens[colors[0]] !== 1) return state;
      const color = colors[0];
      if (playerTokens[color] < 1) return state;

      playerTokens = { ...playerTokens, [color]: playerTokens[color] - 1 };
      bag = { ...bag, [color]: bag[color] + 1 };

      let newState = updatePlayer(state, cp, { tokens: playerTokens });
      newState = { ...newState, bag };

      if (totalTokens(playerTokens) > MAX_TOKENS) return { ...newState, phase: 'discard' };

      return advanceTurn(newState);
    }

    default:
      return state;
  }
}
