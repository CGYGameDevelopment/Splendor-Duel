import type { GameState, PlayerState, Action, PlayerId } from '@splendor-duel/game-engine';

// ─── Hidden information ──────────────────────────────────────────────────────
//
// `GameState` is the engine's complete, omniscient view. Several of its fields
// are secret in a real game and must never reach a player's client:
//
//   decks     The undrawn cards of each level, in draw order. Sending the array
//             tells a player every card that will enter the pyramid and when.
//   rngSeed   The PRNG state. Together with the bag contents it predicts exactly
//             which tokens a replenish will place, and where.
//   players[opponent].reservedCards
//             Reserved cards are kept face-down from the opponent.
//
// `ClientGameState` is the only shape that goes over the wire, and it is derived
// from `GameState` by subtraction, so a new secret field added to the engine is
// a type error here rather than a silent leak.

/** Remaining undrawn card count per level — what a player legitimately knows. */
export interface DeckCounts {
  level1: number;
  level2: number;
  level3: number;
}

/**
 * Player state as seen by a specific client.
 * Own player: reservedCards contains the actual cards.
 * Opponent: reservedCards is empty; reservedCardCount carries the count.
 */
export type ClientPlayerState = Omit<PlayerState, 'reservedCards'> & {
  reservedCards: PlayerState['reservedCards'];
  reservedCardCount: number;
};

export type ClientGameState = Omit<GameState, 'players' | 'decks' | 'rngSeed'> & {
  players: [ClientPlayerState, ClientPlayerState];
  deckCounts: DeckCounts;
};

/** Counts the undrawn cards per level. */
export function deckCountsOf(decks: GameState['decks']): DeckCounts {
  return {
    level1: decks.level1.length,
    level2: decks.level2.length,
    level3: decks.level3.length,
  };
}

/**
 * Replaces the undrawn deck arrays with counts and drops the PRNG seed.
 *
 * Used on its own where both players are controlled by the same caller (the AI
 * training sim, which is omniscient by design and only needs deck *sizes*), and
 * as the first half of `toClientState` for real multiplayer.
 */
export function withoutHiddenEngineState(
  state: GameState,
): Omit<GameState, 'decks' | 'rngSeed'> & { deckCounts: DeckCounts } {
  const { decks, rngSeed: _rngSeed, ...visible } = state;
  return { ...visible, deckCounts: deckCountsOf(decks) };
}

/**
 * Returns the view of the game state that may be sent to `viewerId`.
 *
 * This is the single place the hidden-information rules are applied; both the
 * multiplayer server and any other transport must route through it rather than
 * spreading `GameState` onto the wire.
 */
export function toClientState(state: GameState, viewerId: PlayerId): ClientGameState {
  const visible = withoutHiddenEngineState(state);

  const players = state.players.map((player, index) => ({
    ...player,
    reservedCards: index === viewerId ? player.reservedCards : [],
    reservedCardCount: player.reservedCards.length,
  })) as [ClientPlayerState, ClientPlayerState];

  return { ...visible, players };
}

// ─── Wire decoding ───────────────────────────────────────────────────────────

/**
 * A raw WebSocket payload as the `ws` library delivers it.
 *
 * Mirrors `ws`'s own `RawData` structurally so this package does not need a
 * dependency on `ws` (the browser client has no such type at all).
 */
export type RawWebSocketData = string | Buffer | ArrayBuffer | ArrayBufferView | Buffer[];

/**
 * Decodes a raw WebSocket payload to a string.
 *
 * `ws` delivers a fragmented message as an *array* of Buffers. Calling
 * `.toString()` on that array joins the parts with commas, which silently
 * corrupts the JSON — the message is then rejected as malformed rather than
 * handled, and the fault looks like a client bug. Concatenating first is the
 * only correct reading.
 */
export function decodeWireMessage(data: RawWebSocketData): string {
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
}

// ─── HTTP ─────────────────────────────────────────────────────────────────────

export interface SessionInfo {
  sessionId: string;
  status: 'waiting' | 'playing' | 'finished';
  playerCount: 1 | 2;
  hostName: string;
}

// ─── Client → Server (WebSocket) ─────────────────────────────────────────────

export type ClientMessage =
  | { type: 'CREATE_SESSION'; playerName: string }
  | { type: 'JOIN_SESSION'; sessionId: string; playerName: string }
  | { type: 'DISPATCH_ACTION'; action: Action }
  | { type: 'UNDO_TURN' }
  | { type: 'PING' };

// ─── Server → Client (WebSocket) ─────────────────────────────────────────────

export type ServerMessage =
  /** Sent to player 0 after they create a session. */
  | { type: 'SESSION_CREATED'; sessionId: string; playerId: 0 }
  /** Sent to player 1 after they successfully join. */
  | { type: 'SESSION_JOINED'; sessionId: string; playerId: 1; state: ClientGameState; canUndo: boolean }
  /** Sent to player 0 when player 1 connects, confirming the game can start. */
  | { type: 'GAME_STARTED'; state: ClientGameState; opponentName: string; canUndo: boolean }
  /** Sent to each player individually after every valid action. */
  | { type: 'STATE_UPDATE'; state: ClientGameState; canUndo: boolean }
  /** Sent to the remaining player when the other disconnects mid-game. */
  | { type: 'OPPONENT_DISCONNECTED' }
  | { type: 'ERROR'; message: string }
  | { type: 'PONG' };
