import WebSocket from 'ws';
import type { ServerMessage } from '@splendor-duel/protocol';
import {
  createSession,
  joinSession,
  reconnectSession,
  dispatchAction,
  handleDisconnect,
  listSessions,
} from '../sessionManager';

/**
 * A stand-in for a client socket.
 *
 * sessionManager only ever calls send(), readyState and close(), so a fake is
 * enough and keeps these tests free of real sockets and ports — the behaviour
 * under test is seat bookkeeping, not transport.
 */
class FakeSocket {
  readyState: number = WebSocket.OPEN;
  readonly sent: ServerMessage[] = [];
  closed = false;

  send(raw: string): void {
    this.sent.push(JSON.parse(raw) as ServerMessage);
  }

  close(): void {
    this.closed = true;
    this.readyState = WebSocket.CLOSED;
  }

  /** The most recent message of a given type, if any. */
  last<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }> | undefined {
    for (let i = this.sent.length - 1; i >= 0; i--) {
      if (this.sent[i].type === type) return this.sent[i] as Extract<ServerMessage, { type: T }>;
    }
    return undefined;
  }

  get types(): string[] {
    return this.sent.map(m => m.type);
  }
}

function asSocket(fake: FakeSocket): WebSocket {
  return fake as unknown as WebSocket;
}

/** Creates a session with both seats filled, returning the pieces under test. */
function startGame() {
  const host = new FakeSocket();
  const guest = new FakeSocket();
  const sessionId = createSession('Host', asSocket(host));
  if (!sessionId) throw new Error('session was not created');
  joinSession(sessionId, 'Guest', asSocket(guest));
  return { sessionId, host, guest };
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  // Drain any held sessions so one test's grace timer cannot leak into the next.
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe('seat credentials', () => {
  it('issues a reconnect token to the host', () => {
    // Arrange / Act
    const host = new FakeSocket();
    createSession('Host', asSocket(host));

    // Assert
    const created = host.last('SESSION_CREATED');
    expect(created).toBeDefined();
    expect(typeof created?.reconnectToken).toBe('string');
    expect(created?.reconnectToken.length).toBeGreaterThan(10);
  });

  it('issues a different token to the guest', () => {
    // Arrange / Act
    const { host, guest } = startGame();

    // Assert
    const hostToken = host.last('SESSION_CREATED')?.reconnectToken;
    const guestToken = guest.last('SESSION_JOINED')?.reconnectToken;
    expect(hostToken).toBeDefined();
    expect(guestToken).toBeDefined();
    expect(hostToken).not.toBe(guestToken);
  });
});

describe('reconnecting', () => {
  it('restores the seat and the state after a drop', () => {
    // Arrange
    const { sessionId, host, guest } = startGame();
    const token = host.last('SESSION_CREATED')!.reconnectToken;
    handleDisconnect(sessionId, 0);

    // Act
    const replacement = new FakeSocket();
    const seat = reconnectSession(sessionId, token, asSocket(replacement));

    // Assert
    expect(seat).toBe(0);
    const resumed = replacement.last('SESSION_RESUMED');
    expect(resumed).toBeDefined();
    expect(resumed?.playerId).toBe(0);
    expect(resumed?.opponentName).toBe('Guest');
    expect(resumed?.opponentConnected).toBe(true);
    expect(resumed?.state.players).toHaveLength(2);
    // The opponent is told, so their "disconnected" notice can clear.
    expect(guest.types).toContain('OPPONENT_RECONNECTED');
  });

  it('still hides the opponent\'s reserved cards after a reconnect', () => {
    // Arrange
    const { sessionId, host } = startGame();
    const token = host.last('SESSION_CREATED')!.reconnectToken;
    handleDisconnect(sessionId, 0);

    // Act
    const replacement = new FakeSocket();
    reconnectSession(sessionId, token, asSocket(replacement));

    // Assert — the resumed view goes through the same sanitiser as any update.
    const resumed = replacement.last('SESSION_RESUMED')!;
    expect(resumed.state).not.toHaveProperty('decks');
    expect(resumed.state).not.toHaveProperty('rngSeed');
    expect(resumed.state.players[1].reservedCards).toEqual([]);
  });

  it('refuses a token that belongs to no seat', () => {
    // Arrange
    const { sessionId } = startGame();

    // Act
    const replacement = new FakeSocket();
    const seat = reconnectSession(sessionId, 'not-a-real-token', asSocket(replacement));

    // Assert
    expect(seat).toBeNull();
    expect(replacement.last('ERROR')?.message).toMatch(/not valid/i);
  });

  // A session-wide token would let either client claim either seat, and with it
  // sight of the other player's hidden reserved cards.
  it('binds a token to its own seat', () => {
    // Arrange
    const { sessionId, guest } = startGame();
    const guestToken = guest.last('SESSION_JOINED')!.reconnectToken;

    // Act — the guest's token must resume seat 1, never seat 0.
    const replacement = new FakeSocket();
    const seat = reconnectSession(sessionId, guestToken, asSocket(replacement));

    // Assert
    expect(seat).toBe(1);
    expect(replacement.last('SESSION_RESUMED')?.playerId).toBe(1);
  });

  it('refuses a reconnect to an unknown session', () => {
    // Arrange / Act
    const replacement = new FakeSocket();
    const seat = reconnectSession('0000', 'whatever', asSocket(replacement));

    // Assert
    expect(seat).toBeNull();
    expect(replacement.last('ERROR')?.message).toMatch(/not found/i);
  });

  it('displaces an older socket still holding the seat', () => {
    // Arrange
    const { sessionId, host } = startGame();
    const token = host.last('SESSION_CREATED')!.reconnectToken;

    // Act — reconnect without the first socket having closed.
    const replacement = new FakeSocket();
    const seat = reconnectSession(sessionId, token, asSocket(replacement));

    // Assert
    expect(seat).toBe(0);
    expect(host.closed).toBe(true);
  });
});

describe('the grace period', () => {
  it('tells the remaining player how long the seat is held', () => {
    // Arrange
    const { sessionId, guest } = startGame();

    // Act
    handleDisconnect(sessionId, 0);

    // Assert
    const notice = guest.last('OPPONENT_DISCONNECTED');
    expect(notice?.graceMs).toBeGreaterThan(0);
  });

  it('keeps the session alive while one player is still connected', () => {
    // Arrange
    const { sessionId } = startGame();

    // Act — the host drops, the guest stays.
    handleDisconnect(sessionId, 0);
    jest.advanceTimersByTime(10 * 60_000);

    // Assert
    expect(listSessions().some(s => s.sessionId === sessionId)).toBe(true);
  });

  it('holds the session briefly when both players drop, then discards it', () => {
    // Arrange
    const { sessionId, host } = startGame();
    const token = host.last('SESSION_CREATED')!.reconnectToken;

    // Act
    handleDisconnect(sessionId, 0);
    handleDisconnect(sessionId, 1);

    // Assert — still reclaimable immediately after the drop.
    const during = new FakeSocket();
    expect(reconnectSession(sessionId, token, asSocket(during))).toBe(0);
  });

  it('discards a session nobody returns to', () => {
    // Arrange
    const { sessionId, host } = startGame();
    const token = host.last('SESSION_CREATED')!.reconnectToken;

    // Act
    handleDisconnect(sessionId, 0);
    handleDisconnect(sessionId, 1);
    jest.advanceTimersByTime(10 * 60_000);

    // Assert
    const late = new FakeSocket();
    expect(reconnectSession(sessionId, token, asSocket(late))).toBeNull();
    expect(listSessions().some(s => s.sessionId === sessionId)).toBe(false);
  });

  it('drops a waiting session whose host left, since there is no game to resume', () => {
    // Arrange
    const host = new FakeSocket();
    const sessionId = createSession('Host', asSocket(host))!;

    // Act
    handleDisconnect(sessionId, 0);

    // Assert
    expect(listSessions().some(s => s.sessionId === sessionId)).toBe(false);
  });
});

describe('rejected actions explain themselves', () => {
  it('reports why a move was illegal rather than "Invalid action"', () => {
    // Arrange
    const { sessionId, host } = startGame();

    // Act — a discard during the main action step.
    dispatchAction(sessionId, 0, { type: 'DISCARD_TOKENS', color: 'red' }, asSocket(host));

    // Assert
    const error = host.last('ERROR');
    expect(error?.message).toBeDefined();
    expect(error?.message).not.toMatch(/^Invalid action$/);
    expect(error?.message.length).toBeGreaterThan(12);
  });

  it('reports a malformed payload distinctly', () => {
    // Arrange
    const { sessionId, host } = startGame();

    // Act
    dispatchAction(sessionId, 0, { type: 'DISCARD_TOKENS', color: 'notacolor' } as never, asSocket(host));

    // Assert
    expect(host.last('ERROR')?.message).toMatch(/token color/i);
  });

  it('refuses an action from the player whose turn it is not', () => {
    // Arrange
    const { sessionId, guest } = startGame();

    // Act
    dispatchAction(sessionId, 1, { type: 'PASS_MANDATORY' }, asSocket(guest));

    // Assert
    expect(guest.last('ERROR')?.message).toMatch(/not your turn/i);
  });
});
