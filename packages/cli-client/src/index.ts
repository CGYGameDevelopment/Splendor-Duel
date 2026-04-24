import WebSocket from 'ws';
import * as readline from 'readline';
import { legalMoves, adjacentCells } from '@splendor-duel/game-engine';
import type { Action, PlayerId, Card } from '@splendor-duel/game-engine';
import type { ClientMessage, ServerMessage, ClientGameState } from '@splendor-duel/protocol';

// ─── Session state ────────────────────────────────────────────────────────────

let myPlayerId: PlayerId | null = null;
let gameState: ClientGameState | null = null;
let myName = '';
let opponentName = '';
let awaitingInput = false;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function question(q: string): Promise<string> {
  return new Promise(resolve => rl.question(q, resolve));
}

function send(ws: WebSocket, msg: ClientMessage): void {
  ws.send(JSON.stringify(msg));
}

// ─── Display helpers ──────────────────────────────────────────────────────────

const TOKEN_ABBR: { [key: string]: string } = {
  white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G',
  pearl: 'Pl', gold: 'Au',
};

const CARD_COLOR_ABBR: { [key: string]: string } = {
  white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G',
};

const ALL_TOKEN_COLORS = ['white', 'blue', 'green', 'red', 'black', 'pearl', 'gold'];

function abbr(color: string): string {
  return TOKEN_ABBR[color] ?? color.slice(0, 3);
}

function cardColorAbbr(color: string | null): string {
  if (color == null) return '--';
  return CARD_COLOR_ABBR[color] ?? color.slice(0, 2);
}

function formatPool(pool: { [key: string]: number | undefined }, showZero = false): string {
  const parts = ALL_TOKEN_COLORS
    .filter(c => showZero || (pool[c] ?? 0) > 0)
    .map(c => `${abbr(c)}=${pool[c] ?? 0}`);
  return parts.length > 0 ? parts.join(' ') : '(none)';
}

function formatCost(cost: { [key: string]: number | undefined }): string {
  const parts = ALL_TOKEN_COLORS
    .filter(c => (cost[c] ?? 0) > 0)
    .map(c => `${abbr(c)}=${cost[c]}`);
  return parts.length > 0 ? parts.join(' ') : 'free';
}

function describeCard(card: Card): string {
  const level = card.level === 'royal' ? 'R ' : `L${card.level}`;
  const abil = card.ability ? ` [${card.ability}]` : '';
  const crowns = card.crowns > 0 ? ` 👑${card.crowns}` : '';
  const effectiveColor = card.assignedColor ?? card.color;
  const colorStr = effectiveColor !== null && card.bonus > 0
    ? cardColorAbbr(effectiveColor).repeat(card.bonus)
    : cardColorAbbr(effectiveColor);
  return `#${card.id} ${level} ${colorStr} ⭐${card.points}${crowns}${abil}`;
}

function findCard(state: ClientGameState, cardId: number): Card | undefined {
  const candidates: (Card | null)[] = [
    ...state.pyramid.level1,
    ...state.pyramid.level2,
    ...state.pyramid.level3,
    ...state.royalDeck,
    state.lastPurchasedCard,
    ...state.players[0].reservedCards,
    ...state.players[1].reservedCards,
    ...state.players[0].purchasedCards,
    ...state.players[1].purchasedCards,
    ...state.players[0].royalCards,
    ...state.players[1].royalCards,
  ];
  return candidates.filter((c): c is Card => c !== null).find(c => c.id === cardId);
}

function totalTokens(pool: { [key: string]: number | undefined }): number {
  return ALL_TOKEN_COLORS.reduce((sum, c) => sum + (pool[c] ?? 0), 0);
}

// ─── State display ────────────────────────────────────────────────────────────

function displayBoard(board: ClientGameState['board']): void {
  console.log('\nBOARD:');
  for (let row = 0; row < 5; row++) {
    const cells = [];
    for (let col = 0; col < 5; col++) {
      const idx = row * 5 + col;
      const token = board[idx] ? abbr(board[idx]!) : '.';
      cells.push(`${String(idx).padStart(2)}:${token.padEnd(3)}`);
    }
    console.log('  ' + cells.join('  '));
  }
}

const CARD_DESC_WIDTH = 36;

function displayCardRow(card: Card, indent: string): void {
  const desc = describeCard(card).padEnd(CARD_DESC_WIDTH);
  const cost = formatCost(card.cost);
  console.log(`${indent}${desc}  ${cost}`);
}

function displayPyramid(state: ClientGameState): void {
  console.log('\nPYRAMID:');
  for (const level of [3, 2, 1] as const) {
    const key = `level${level}` as 'level1' | 'level2' | 'level3';
    const cards = state.pyramid[key];
    const deckCount = state.decks[key].length;
    console.log(`  L${level}  (deck: ${deckCount})`);
    if (cards.length === 0) {
      console.log('    (empty)');
    } else {
      for (const c of cards) displayCardRow(c, '    ');
    }
  }
  if (state.royalDeck.length > 0) {
    console.log('  Royals');
    for (const c of state.royalDeck) {
      console.log(`    ${describeCard(c)}`);
    }
  }
}

function displayPlayers(state: ClientGameState): void {
  for (const pid of [0, 1] as PlayerId[]) {
    const player = state.players[pid];
    const isMe = pid === myPlayerId;
    const name = isMe ? `YOU (${myName})` : `OPPONENT (${opponentName || `Player ${pid}`})`;
    const turnMark = state.currentPlayer === pid ? ' ◄ TURN' : '';

    console.log(`\n${name} — ⭐${player.prestige} | 👑${player.crowns} | 📜${player.privileges}${turnMark}`);

    const total = totalTokens(player.tokens as { [key: string]: number });
    console.log(`  Tokens (${total}): ${formatPool(player.tokens as { [key: string]: number })}`);

    const gems: { [key: string]: number } = {};
    for (const card of player.purchasedCards) {
      const effective = card.assignedColor ?? card.color;
      if (effective !== null) {
        gems[effective] = (gems[effective] ?? 0) + card.bonus;
      }
    }
    console.log(`  Gems (${player.purchasedCards.length} cards): ${formatPool(gems)}`);

    const abilCards = player.purchasedCards.filter(c => c.ability !== null);
    if (abilCards.length > 0) {
      console.log(`  Abilities: ${abilCards.map(c => c.ability).join(', ')}`);
    }

    if (isMe && player.reservedCards.length > 0) {
      console.log('  Reserved:');
      for (const c of player.reservedCards) displayCardRow(c, '    ');
    } else if (!isMe) {
      console.log(`  Reserved: ${player.reservedCardCount} (hidden)`);
    }

    if (player.royalCards.length > 0) {
      console.log(`  Royals: ${player.royalCards.map(c => `[${describeCard(c)}]`).join(' ')}`);
    }
  }
}

function displayState(state: ClientGameState): void {
  console.log('\n' + '═'.repeat(70));
  displayPyramid(state);
  displayBoard(state.board);
  displayPlayers(state);
  const bagTotal = totalTokens(state.bag as { [key: string]: number });
  const abil = state.pendingAbility ? ` (pending ability: ${state.pendingAbility})` : '';
  console.log(`\nTable 📜: ${state.privileges} | Bag: ${bagTotal} tokens`);
  console.log(`Phase: ${state.phase}${abil}`);
  console.log('═'.repeat(70));
}

// ─── Move descriptions ────────────────────────────────────────────────────────

function describeMove(action: Action, state: ClientGameState): string {
  switch (action.type) {
    case 'END_OPTIONAL_PHASE':
      return 'Skip optional phase';

    case 'SKIP_TO_MANDATORY':
      return 'Skip all optional phases';

    case 'TAKE_TOKENS': {
      const tokens = action.indices
        .map(i => { const cell = state.board[i]; return cell ? abbr(cell) : '?'; })
        .join(' ');
      return `Take tokens: cells [${action.indices.join(',')}] → ${tokens}`;
    }

    case 'USE_PRIVILEGE': {
      const tokens = action.indices
        .map(i => { const cell = state.board[i]; return cell ? `${abbr(cell)}[${i}]` : '?'; })
        .join(' ');
      return `Use privilege(s): take cells [${action.indices.join(',')}] → ${tokens}`;
    }

    case 'REPLENISH_BOARD':
      return 'Replenish board from bag';

    case 'PURCHASE_CARD': {
      const card = findCard(state, action.cardId);
      const goldStr = Object.values(action.goldUsage).some(v => v > 0)
        ? ` (gold covers: ${formatPool(action.goldUsage as { [key: string]: number })})`
        : '';
      const info = card ? `${describeCard(card)} cost:${formatCost(card.cost)}` : `card #${action.cardId}`;
      return `Purchase ${info}${goldStr}`;
    }

    case 'RESERVE_CARD_FROM_DECK':
      return `Reserve top card from ${action.source}`;

    case 'RESERVE_CARD_FROM_PYRAMID': {
      const card = findCard(state, action.cardId);
      return card ? `Reserve ${describeCard(card)}` : `Reserve card #${action.cardId} from pyramid`;
    }

    case 'CHOOSE_ROYAL_CARD': {
      const card = findCard(state, action.cardId);
      return card ? `Choose royal: ${describeCard(card)}` : `Choose royal card #${action.cardId}`;
    }

    case 'DISCARD_TOKENS':
      return `Discard: ${formatPool(action.tokens as { [key: string]: number })}`;

    case 'ASSIGN_WILD_COLOR': {
      const wild = findCard(state, action.wildCardId);
      const wildStr = wild ? describeCard(wild) : `#${action.wildCardId}`;
      return `Assign wild card ${wildStr} → ${action.color}`;
    }

    case 'TAKE_TOKEN_FROM_BOARD': {
      const cell = state.board[action.index];
      return `Take ${cell ? abbr(cell) : '?'} token from board [${action.index}] (Token ability)`;
    }

    case 'TAKE_TOKEN_FROM_OPPONENT':
      return `Take ${abbr(action.color)} token from opponent (Take ability)`;

    default:
      return JSON.stringify(action);
  }
}

// ─── Token move ordering ──────────────────────────────────────────────────────

/**
 * Returns the TAKE_TOKENS moves in display order:
 *   1. All size-3 sets.
 *   2. Size-2 sets that are NOT a subset of any size-3 set (always keep 2-pearl).
 *   3. Size-1 sets whose cell has no adjacent non-gold token on the board,
 *      but only when larger moves also exist — never hide all token moves.
 */
function orderedTokenMoves(tokenMoves: Action[], board: ClientGameState['board']): Action[] {
  const size3 = tokenMoves.filter(m => m.type === 'TAKE_TOKENS' && m.indices.length === 3);
  const size2 = tokenMoves.filter(m => m.type === 'TAKE_TOKENS' && m.indices.length === 2);
  const size1 = tokenMoves.filter(m => m.type === 'TAKE_TOKENS' && m.indices.length === 1);

  const indices3Sets = size3.map(m => (m as Extract<Action, { type: 'TAKE_TOKENS' }>).indices);

  const filtered2 = size2.filter(m => {
    const idxs = (m as Extract<Action, { type: 'TAKE_TOKENS' }>).indices;
    const isTwoPearls = idxs.every(i => board[i] === 'pearl');
    if (isTwoPearls) return true;
    return !indices3Sets.some(set => idxs.every(i => set.includes(i)));
  });

  const filtered1 = size1.filter(m => {
    const [idx] = (m as Extract<Action, { type: 'TAKE_TOKENS' }>).indices;
    return !adjacentCells(idx).some(adj => {
      const cell = board[adj];
      return cell !== null && cell !== undefined && cell !== 'gold';
    });
  });

  // Safety: never hide all token moves — if filtering removes everything, show all size-1s.
  const result1 = (size3.length > 0 || filtered2.length > 0) ? filtered1 : size1;

  return [...size3, ...filtered2, ...result1];
}

// ─── Move prompt ──────────────────────────────────────────────────────────────

type MoveGroup = { label: string; moves: Action[] };

function buildMoveGroups(allMoves: Action[], state: ClientGameState): MoveGroup[] {
  const tokenMoves = allMoves.filter(m => m.type === 'TAKE_TOKENS');
  const rest = allMoves.filter(m => m.type !== 'TAKE_TOKENS');

  const phaseCtrl  = rest.filter(m => m.type === 'END_OPTIONAL_PHASE' || m.type === 'SKIP_TO_MANDATORY' || m.type === 'REPLENISH_BOARD');
  const tokens     = orderedTokenMoves(tokenMoves, state.board);
  const privileges = rest.filter(m => m.type === 'USE_PRIVILEGE');
  const purchases  = rest.filter(m => m.type === 'PURCHASE_CARD');
  const reserves   = rest.filter(m => m.type === 'RESERVE_CARD_FROM_DECK' || m.type === 'RESERVE_CARD_FROM_PYRAMID');
  const discards   = rest.filter(m => m.type === 'DISCARD_TOKENS');
  const abilities  = rest.filter(m =>
    m.type === 'TAKE_TOKEN_FROM_BOARD' ||
    m.type === 'TAKE_TOKEN_FROM_OPPONENT' ||
    m.type === 'ASSIGN_WILD_COLOR' ||
    m.type === 'CHOOSE_ROYAL_CARD'
  );

  const groups: MoveGroup[] = [];
  if (phaseCtrl.length)  groups.push({ label: 'Phase',         moves: phaseCtrl });
  if (tokens.length)     groups.push({ label: 'Take tokens',   moves: tokens });
  if (privileges.length) groups.push({ label: 'Use privilege', moves: privileges });
  if (purchases.length)  groups.push({ label: 'Purchase',      moves: purchases });
  if (reserves.length)   groups.push({ label: 'Reserve',       moves: reserves });
  if (discards.length)   groups.push({ label: 'Discard',       moves: discards });
  if (abilities.length)  groups.push({ label: 'Ability',       moves: abilities });
  return groups;
}

async function promptMove(state: ClientGameState, ws: WebSocket): Promise<void> {
  if (awaitingInput) return;
  awaitingInput = true;

  const allMoves = legalMoves(state);
  if (allMoves.length === 0) {
    console.log('\nNo legal moves available.');
    awaitingInput = false;
    return;
  }

  const groups = buildMoveGroups(allMoves, state);
  const moves = groups.flatMap(g => g.moves);

  console.log(`\n── YOUR TURN (${state.phase}) ── ${moves.length} move${moves.length !== 1 ? 's' : ''}`);
  let counter = 1;
  for (const group of groups) {
    console.log(`\n  ─ ${group.label} ─`);
    for (const move of group.moves) {
      console.log(`  ${String(counter).padStart(3)}. ${describeMove(move, state)}`);
      counter++;
    }
  }

  let chosen = -1;
  while (chosen < 0) {
    const input = (await question('\nMove number: ')).trim();
    const n = parseInt(input, 10);
    if (!isNaN(n) && n >= 1 && n <= moves.length) {
      chosen = n - 1;
    } else {
      console.log(`  Please enter a number between 1 and ${moves.length}.`);
    }
  }

  awaitingInput = false;
  send(ws, { type: 'DISPATCH_ACTION', action: moves[chosen] });
}

// ─── Message handler ──────────────────────────────────────────────────────────

async function onStateUpdate(state: ClientGameState, ws: WebSocket): Promise<void> {
  displayState(state);
  if (myPlayerId === null) return;
  if (state.phase === 'game_over') {
    const youWon = state.winner === myPlayerId;
    console.log(`\nGame over! ${youWon ? 'You win!' : 'Opponent wins.'} Condition: ${state.winCondition}`);
    rl.close();
    ws.close();
    return;
  }
  if (state.currentPlayer === myPlayerId) {
    await promptMove(state, ws);
  } else {
    console.log("\nWaiting for opponent's move...");
  }
}

async function handleMessage(msg: ServerMessage, ws: WebSocket): Promise<void> {
  switch (msg.type) {
    case 'SESSION_CREATED':
      myPlayerId = msg.playerId;
      console.log(`\nSession created! Share this ID with your opponent:\n  ${msg.sessionId}`);
      console.log('Waiting for opponent to join...');
      break;

    case 'SESSION_JOINED':
      myPlayerId = msg.playerId;
      gameState = msg.state;
      console.log(`\nJoined session as Player ${myPlayerId}.`);
      await onStateUpdate(gameState, ws);
      break;

    case 'GAME_STARTED':
      gameState = msg.state;
      opponentName = msg.opponentName;
      console.log(`\nGame started! Opponent: ${opponentName}`);
      await onStateUpdate(gameState, ws);
      break;

    case 'STATE_UPDATE':
      gameState = msg.state;
      await onStateUpdate(gameState, ws);
      break;

    case 'OPPONENT_DISCONNECTED':
      console.log('\nOpponent disconnected.');
      rl.close();
      ws.close();
      break;

    case 'ERROR':
      console.log(`\n[Server] ${msg.message}`);
      if (gameState && myPlayerId !== null && gameState.currentPlayer === myPlayerId && !awaitingInput) {
        await promptMove(gameState, ws);
      }
      break;

    case 'PONG':
      break;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Splendor Duel — CLI Client');
  console.log('==========================\n');

  const urlInput = await question('Server URL [ws://localhost:3001]: ');
  const url = urlInput.trim() || 'ws://localhost:3001';

  myName = (await question('Your name: ')).trim() || 'Player';

  const ws = new WebSocket(url);

  ws.on('open', async () => {
    console.log(`Connected.\n`);
    const choice = await question('[c]reate new session or [j]oin existing? ');
    if (choice.trim().toLowerCase().startsWith('j')) {
      const sid = (await question('Session ID: ')).trim();
      send(ws, { type: 'JOIN_SESSION', sessionId: sid, playerName: myName });
    } else {
      send(ws, { type: 'CREATE_SESSION', playerName: myName });
    }
  });

  ws.on('message', async (data: WebSocket.RawData) => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(data.toString()) as ServerMessage;
    } catch {
      console.error('Could not parse server message.');
      return;
    }
    await handleMessage(msg, ws);
  });

  ws.on('close', () => {
    console.log('\nDisconnected.');
    process.exit(0);
  });

  ws.on('error', (err: Error) => {
    console.error(`Connection error: ${err.message}`);
    process.exit(1);
  });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
