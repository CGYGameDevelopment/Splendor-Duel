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
  const player = state.players[state.currentPlayer];
  const victoryCondition = checkVictory(player);

  if (victoryCondition) {
    return {
      ...state,
      phase: 'game_over',
      winner: state.currentPlayer,
      winCondition: victoryCondition,
    };
  }

  // If player needs to discard, move to discard phase
  if (totalTokens(player.tokens) > MAX_TOKENS) {
    return { ...state, phase: 'discard' };
  }

  // Extra turns banked from a Turn-ability card — give the player a full new turn
  if (state.extraTurns > 0) {
    return {
      ...state,
      extraTurns: state.extraTurns - 1,
      phase: 'optional_privilege',
      lastPurchasedCard: null,
    };
  }

  // Normal turn end — switch player
  const next = (1 - state.currentPlayer) as PlayerId;
  return {
    ...state,
    currentPlayer: next,
    phase: 'optional_privilege',
    extraTurns: 0,
    lastPurchasedCard: null,
  };
}

// ─── Resolve card ability ─────────────────────────────────────────────────────

function resolveAbility(state: GameState, card: Card): GameState {
  if (!card.ability) return endTurn(state);

  switch (card.ability) {
    case 'Turn': {
      // Grant an extra turn by banking it in extraTurns, then jump directly to mandatory.
      // Unlike other abilities, we don't call endTurn here — the player continues immediately.
      return {
        ...state,
        extraTurns: state.extraTurns + 1,
        phase: 'mandatory',
        pendingAbility: null,
        lastPurchasedCard: null,
      };
    }

    case 'Privilege': {
      const { privileges, players } = grantPrivileges(state, state.currentPlayer, 1);
      return endTurn({ ...state, privileges, players, pendingAbility: null });
    }

    case 'Token': {
      // Player must take 1 token matching the card's effective color from the board
      // If card is a joker/bonus, it has no token effect (no gem color until assigned)
      if (card.color === 'joker' || card.color === 'points') {
        return endTurn({ ...state, pendingAbility: null });
      }
      const color = card.color as TokenColor;
      const hasToken = state.board.some(cell => cell === color);
      if (!hasToken) return endTurn({ ...state, pendingAbility: null });
      return { ...state, phase: 'resolve_ability', pendingAbility: 'Token', lastPurchasedCard: card };
    }

    case 'Take': {
      const opp = (1 - state.currentPlayer) as PlayerId;
      const oppTokens = state.players[opp].tokens;
      const hasEligible = GEM_COLORS.some(c => oppTokens[c] > 0) || oppTokens.pearl > 0;
      if (!hasEligible) return endTurn({ ...state, pendingAbility: null });
      return { ...state, phase: 'resolve_ability', pendingAbility: 'Take', lastPurchasedCard: card };
    }

    case 'Bonus':
    case 'Bonus/Turn': {
      // Player must choose which card this overlaps — needs a card with a bonus to overlap (excluding itself)
      const player = state.players[state.currentPlayer];
      const eligible = player.purchasedCards.filter(
        c => c.id !== card.id && c.color !== 'joker' && c.color !== 'points' && c.bonus > 0 && c.overlappingCardId === null
      );
      if (eligible.length === 0) {
        // Cannot purchase this card — this should be caught in legalMoves, but guard here
        return endTurn({ ...state, pendingAbility: null });
      }
      return { ...state, phase: 'place_bonus', pendingAbility: card.ability, lastPurchasedCard: card };
    }

    default:
      return endTurn({ ...state, pendingAbility: null });
  }
}

// ─── Crown milestone helpers ──────────────────────────────────────────────────

function resolveRoyalAbility(state: GameState, playerId: PlayerId, card: Card): GameState {
  if (!card.ability) return state;

  switch (card.ability) {
    case 'Privilege': {
      const { privileges, players } = grantPrivileges(state, playerId, 1);
      return { ...state, privileges, players };
    }
    case 'Token': {
      // Resolved immediately — take from board if available; no blocking phase for royal
      if (card.color === 'joker' || card.color === 'points') return state;
      const color = card.color as TokenColor;
      const board = [...state.board];
      const idx = board.findIndex(c => c === color);
      if (idx === -1) return state;
      board[idx] = null;
      const player = state.players[playerId];
      const tokens = { ...player.tokens, [color]: player.tokens[color] + 1 };
      return updatePlayer({ ...state, board }, playerId, { tokens });
    }
    // Turn and Take on royal cards are not standard but handled defensively
    default:
      return state;
  }
}

function checkCrownMilestone(
  state: GameState,
  playerId: PlayerId,
  prevCrowns: number,
  newCrowns: number
): GameState {
  let current = state;

  for (const milestone of CROWN_MILESTONES) {
    if (prevCrowns < milestone && newCrowns >= milestone && current.royalDeck.length > 0) {
      const [royalCard, ...rest] = current.royalDeck;
      const player = current.players[playerId];
      const updatedPlayer: PlayerState = {
        ...player,
        royalCards: [...player.royalCards, royalCard],
        prestige: player.prestige + royalCard.points,
      };
      const players: [PlayerState, PlayerState] = [...current.players] as [PlayerState, PlayerState];
      players[playerId] = updatedPlayer;
      current = { ...current, players, royalDeck: rest };
      // Resolve royal card ability inline (royal cards share jewel card abilities)
      current = resolveRoyalAbility(current, playerId, royalCard);
    }
  }

  return current;
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
      const { cardId, goldUsage } = action;

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
      const purchasedCard = { ...card };
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

      // Check crown milestones (3rd and 6th crown)
      newState = checkCrownMilestone(newState, cp, player.crowns, crowns);

      // Resolve ability
      return resolveAbility(newState, purchasedCard);
    }

    // ── Ability: Place Bonus card on target ───────────────────────────────────
    case 'PLACE_BONUS_CARD': {
      const { bonusCardId, targetCardId } = action;
      const bonusCard = player.purchasedCards.find(c => c.id === bonusCardId);
      const targetCard = player.purchasedCards.find(c => c.id === targetCardId);

      if (!bonusCard || !targetCard) return state;
      if (bonusCard.id === targetCard.id) return state;
      if (targetCard.color === 'joker' || targetCard.color === 'points') return state;
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
        newState = { ...newState, extraTurns: newState.extraTurns + 1, pendingAbility: null };
      } else {
        newState = { ...newState, pendingAbility: null };
      }

      return endTurn(newState);
    }

    // ── Ability: Token — take 1 token of card's color from board ─────────────
    case 'TAKE_TOKEN_FROM_BOARD': {
      const { color } = action;
      const card = state.lastPurchasedCard;
      if (!card || card.color !== color) return state;

      const board = [...state.board];
      const idx = board.findIndex(c => c === color);
      if (idx === -1) return endTurn({ ...state, pendingAbility: null });

      board[idx] = null;
      const playerTokens = { ...player.tokens, [color]: player.tokens[color] + 1 };
      let newState = updatePlayer(state, cp, { tokens: playerTokens });
      newState = { ...newState, board, pendingAbility: null, lastPurchasedCard: null };
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
