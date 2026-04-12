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

// ─── End of turn processing ───────────────────────────────────────────────────

function endTurn(state: GameState): GameState {
  const cp = state.currentPlayer;

  // 1. Victory Condition Check
  const player = state.players[cp];
  const victoryCondition = checkVictory(player);
  if (victoryCondition) {
    return {
      ...state,
      phase: 'game_over',
      winner: cp,
      winCondition: victoryCondition,
    };
  }

  // 3. Discard Check
  if (totalTokens(player.tokens) > MAX_TOKENS) {
    return { ...state, phase: 'discard' };
  }

  // 4. End of Turn — repeat or switch player
  if (state.repeatTurn) {
    return {
      ...state,
      repeatTurn: false,
      phase: 'optional_privilege',
      lastPurchasedCard: null,
    };
  }

  const next = (1 - cp) as PlayerId;
  return {
    ...state,
    currentPlayer: next,
    phase: 'optional_privilege',
    lastPurchasedCard: null,
  };
}

// ─── Crown milestone helpers ──────────────────────────────────────────────────

// Returns updated state but does NOT call endTurn — mirrors resolveAbility's contract.
function resolveRoyalAbility(state: GameState, playerId: PlayerId, card: Card): GameState {
  if (!card.ability) return state;

  switch (card.ability) {
    case 'Privilege': {
      const { privileges, players } = grantPrivileges(state, playerId, 1);
      return { ...state, privileges, players };
    }
    case 'Token': {
      if (card.color === null || card.color === 'joker') return state;
      const color = card.color as TokenColor;
      const hasToken = state.board.some(c => c === color);
      if (!hasToken) return state;
      return { ...state, phase: 'resolve_ability', pendingAbility: 'Token', lastPurchasedCard: card };
    }
    case 'Take': {
      const opp = (1 - playerId) as PlayerId;
      const oppTokens = state.players[opp].tokens;
      const hasEligible = GEM_COLORS.some(c => oppTokens[c] > 0) || oppTokens.pearl > 0;
      if (!hasEligible) return state;
      return { ...state, phase: 'resolve_ability', pendingAbility: 'Take', lastPurchasedCard: null };
    }
    default:
      return state;
  }
}

// ─── Resolve card ability ─────────────────────────────────────────────────────
// Returns updated state but does NOT call endTurn — the caller is responsible.
// Interactive abilities (Token, Take, Bonus) set an intermediate phase; the
// caller must handle endTurn after the player resolves those actions.

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
      if (card.color === 'joker' || card.color === null) {
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

    case 'Bonus':
    case 'Bonus/Turn': {
      // Player must choose which card this overlaps — needs a card with a bonus to overlap (excluding itself)
      const player = state.players[state.currentPlayer];
      const eligible = player.purchasedCards.filter(
        c => c.id !== card.id && c.color !== 'joker' && c.color !== null && c.bonus > 0 && c.overlappingCardId === null
      );
      if (eligible.length === 0) {
        // Cannot purchase this card — this should be caught in legalMoves, but guard here
        return { ...state, pendingAbility: null };
      }
      return { ...state, phase: 'place_bonus', pendingAbility: card.ability, lastPurchasedCard: card };
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
      if (state.phase === 'optional_privilege') return { ...state, phase: 'optional_replenish' };
      if (state.phase === 'optional_replenish') return { ...state, phase: 'mandatory' };
      return state;
    }

    // ── Optional: Use Privilege ───────────────────────────────────────────────
    case 'USE_PRIVILEGE': {
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

      // Stay in optional_privilege phase (can use more privileges or move on)
      return newState;
    }

    // ── Optional: Replenish Board ─────────────────────────────────────────────
    case 'REPLENISH_BOARD': {
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

      return endTurn(newState);
    }

    // ── Mandatory: Reserve Card (from pyramid by id) ──────────────────────────
    case 'RESERVE_CARD_FROM_PYRAMID': {
      if (player.reservedCards.length >= MAX_RESERVED) return state;

      const board = [...state.board];
      const goldIdx = board.findIndex(c => c === 'gold');
      if (goldIdx === -1) return state;

      // Find card in pyramid
      let card: Card | undefined;
      let level: 1 | 2 | 3 | undefined;
      for (const lvl of CARD_LEVELS) {
        const key = `level${lvl}` as 'level1' | 'level2' | 'level3';
        const found = state.pyramid[key].find(c => c.id === action.cardId);
        if (found) { card = found; level = lvl; break; }
      }
      if (!card || !level) return state;

      board[goldIdx] = null;
      const playerTokens = { ...player.tokens, gold: player.tokens.gold + 1 };
      const reservedCards = [...player.reservedCards, card];

      let newState = updatePlayer(state, cp, { tokens: playerTokens, reservedCards });
      newState = { ...newState, board };
      newState = refillPyramidSlot(newState, level, card.id);
      return endTurn(newState);
    }

    // ── Mandatory: Reserve Card (from deck top) ───────────────────────────────
    case 'RESERVE_CARD': {
      if (player.reservedCards.length >= MAX_RESERVED) return state;

      const board = [...state.board];
      const goldIdx = board.findIndex(c => c === 'gold');
      if (goldIdx === -1) return state;

      const levelMatch = action.source.match(/deck_(\d)/);
      if (!levelMatch) return state;
      const level = parseInt(levelMatch[1], 10) as 1 | 2 | 3;
      const key = `level${level}` as 'level1' | 'level2' | 'level3';

      if (state.decks[key].length === 0) return state;
      const [card, ...rest] = state.decks[key];

      board[goldIdx] = null;
      const playerTokens = { ...player.tokens, gold: player.tokens.gold + 1 };
      const reservedCards = [...player.reservedCards, card];

      let newState = updatePlayer(state, cp, { tokens: playerTokens, reservedCards });
      newState = { ...newState, board, decks: { ...state.decks, [key]: rest } };
      return endTurn(newState);
    }

    // ── Mandatory: Purchase Card ──────────────────────────────────────────────
    case 'PURCHASE_CARD': {
      const { cardId, goldUsage, jokerColor } = action;

      // Find card in pyramid or reserve
      let card: Card | undefined;
      let fromReserve = false;
      let level: 1 | 2 | 3 | undefined;

      for (const lvl of CARD_LEVELS) {
        const key = `level${lvl}` as 'level1' | 'level2' | 'level3';
        const found = state.pyramid[key].find(c => c.id === cardId);
        if (found) { card = found; level = lvl; break; }
      }
      if (!card) {
        const found = player.reservedCards.find(c => c.id === cardId);
        if (found) { card = found; fromReserve = true; }
      }
      if (!card) return state;

      if (!canAfford(card, player, goldUsage)) return state;

      // Deduct tokens
      const cost = netCost(card, player);
      let playerTokens = { ...player.tokens };
      let bag = { ...state.bag };
      let goldSpent = 0;

      for (const [colorStr, needed] of Object.entries(cost) as [TokenColor, number][]) {
        const gold = (goldUsage[colorStr as GemColor | 'pearl']) ?? 0;
        const fromWallet = needed - gold;
        playerTokens = { ...playerTokens, [colorStr]: playerTokens[colorStr] - fromWallet };
        bag = { ...bag, [colorStr]: bag[colorStr] + fromWallet };
        goldSpent += gold;
      }
      playerTokens = { ...playerTokens, gold: playerTokens.gold - goldSpent };
      bag = { ...bag, gold: bag.gold + goldSpent };

      // Add card to purchased, remove from source
      // For joker cards, assign the chosen color immediately
      const purchasedCard = card.color === 'joker' && jokerColor
        ? { ...card, assignedColor: jokerColor }
        : { ...card };
      const purchasedCards = [...player.purchasedCards, purchasedCard];
      const reservedCards = fromReserve
        ? player.reservedCards.filter(c => c.id !== cardId)
        : player.reservedCards;

      // Update crowns and prestige
      const crowns = player.crowns + card.crowns;
      const prestige = player.prestige + card.points;

      let newState = updatePlayer(state, cp, {
        tokens: playerTokens, purchasedCards, reservedCards, crowns, prestige,
      });
      newState = { ...newState, bag, lastPurchasedCard: purchasedCard };

      // Refill pyramid slot if bought from pyramid
      if (!fromReserve && level) {
        newState = refillPyramidSlot(newState, level, cardId);
      }

      // Resolve purchased card's ability first
      newState = resolveAbility(newState, purchasedCard);

      // Crown milestone check — after ability or deferred if ability needs player interaction
      const milestoneCrossed = CROWN_MILESTONES.some(m => player.crowns < m && crowns >= m)
        && newState.royalDeck.length > 0;
      if (newState.phase === 'resolve_ability' || newState.phase === 'place_bonus') {
        return milestoneCrossed ? { ...newState, pendingCrownCheck: true } : newState;
      }
      if (milestoneCrossed) return { ...newState, phase: 'choose_royal' };
      return endTurn(newState);
    }

    // ── Choose Royal Card (crown milestone) ──────────────────────────────────
    case 'CHOOSE_ROYAL_CARD': {
      const royalCard = state.royalDeck.find(c => c.id === action.cardId);
      if (!royalCard) return state;

      const royalDeck = state.royalDeck.filter(c => c.id !== action.cardId);

      let newState = updatePlayer(state, cp, {
        royalCards: [...player.royalCards, royalCard],
        prestige: player.prestige + royalCard.points,
      });
      newState = { ...newState, royalDeck, pendingCrownCheck: false };
      newState = resolveRoyalAbility(newState, cp, royalCard);
      if (newState.phase === 'resolve_ability') return newState;
      return endTurn(newState);
    }

    // ── Ability: Place Bonus card on target ───────────────────────────────────
    case 'PLACE_BONUS_CARD': {
      const { bonusCardId, targetCardId } = action;
      const bonusCard = player.purchasedCards.find(c => c.id === bonusCardId);
      const targetCard = player.purchasedCards.find(c => c.id === targetCardId);

      if (!bonusCard || !targetCard) return state;
      if (bonusCard.id === targetCard.id) return state;
      if (targetCard.color === 'joker' || targetCard.color === null) return state;
      if (targetCard.bonus === 0) return state;
      if (targetCard.overlappingCardId !== null) return state;
      if (bonusCard.overlappingCardId !== null) return state;

      const assignedColor = targetCard.color as GemColor;
      const updatedCards = player.purchasedCards.map(c => {
        if (c.id === bonusCardId) return { ...c, assignedColor, overlappingCardId: targetCardId };
        return c;
      });

      // Recompute prestige (bonus card contributes 0 prestige change, but color grouping changes)
      let newState = updatePlayer(state, cp, { purchasedCards: updatedCards });

      // If Bonus/Turn, grant an extra turn
      if (state.pendingAbility === 'Bonus/Turn') {
        newState = { ...newState, repeatTurn: true, pendingAbility: null };
      } else {
        newState = { ...newState, pendingAbility: null };
      }

      if (newState.pendingCrownCheck) return { ...newState, phase: 'choose_royal', pendingCrownCheck: false };
      return endTurn(newState);
    }

    // ── Ability: Token — take 1 token of card's color from board ─────────────
    case 'TAKE_TOKEN_FROM_BOARD': {
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
      return endTurn(newState);
    }

    // ── Ability: Take — take 1 gem/pearl from opponent ────────────────────────
    case 'TAKE_TOKEN_FROM_OPPONENT': {
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
      return endTurn(newState);
    }

    // ── Discard tokens ────────────────────────────────────────────────────────
    case 'DISCARD_TOKENS': {
      let playerTokens = { ...player.tokens };
      let bag = { ...state.bag };

      for (const [colorStr, amount] of Object.entries(action.tokens) as [TokenColor, number][]) {
        if (playerTokens[colorStr] < amount) return state;
        playerTokens = { ...playerTokens, [colorStr]: playerTokens[colorStr] - amount };
        bag = { ...bag, [colorStr]: bag[colorStr] + amount };
      }

      if (totalTokens(playerTokens) > MAX_TOKENS) return state; // still too many

      let newState = updatePlayer(state, cp, { tokens: playerTokens });
      newState = { ...newState, bag };

      return endTurn(newState);
    }

    default:
      return state;
  }
}
