# How to Run Splendor Duel Locally

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- npm v8 or later (comes with Node)

---

## 1. Install Dependencies

From the project root:

```bash
npm install
```

This installs dependencies for all packages in the monorepo.

---

## 2. Build the Game Engine

The server depends on the compiled `game-engine` package, so build it first:

```bash
npm run build --workspace=packages/game-engine
```

---

## 3. Start the Server

```bash
npm run dev --workspace=packages/server
```

The server starts on **http://localhost:3001** by default.

- HTTP API: `http://localhost:3001`
- WebSocket: `ws://localhost:3001`
- Health check: `http://localhost:3001/health`
- List sessions: `http://localhost:3001/sessions`

To use a different port, set the `PORT` environment variable:

```bash
PORT=4000 npm run dev --workspace=packages/server
```

---

## 4. Running Tests

```bash
npm run test --workspace=packages/game-engine
```

Or run all tests across the monorepo:

```bash
npm run test
```

---

## 5. Play via CLI Client

Each player runs the CLI client in their own terminal. Open **two terminals** (or share the session ID with a second person).

```bash
npm run dev --workspace=packages/cli-client
```

On startup it will ask for:
1. **Server URL** — press Enter to use `ws://localhost:3001`
2. **Your name**
3. **Create or join** — `c` to host a new session, `j` to join an existing one

The host receives a **session ID** to share with the second player. Once both are connected the game begins automatically.

On your turn the CLI lists all legal moves numbered from 1. Enter the number to play it, or `q` to quit.

---

## 6. Manual Testing via Firefox DevTools

You can interact with the WebSocket server directly from Firefox's DevTools console (`F12` → Console) without any extra tooling.

**Player 1** (host):
```js
const ws = new WebSocket('ws://localhost:3001');
ws.onmessage = e => console.log('←', JSON.parse(e.data));

ws.send(JSON.stringify({ type: 'CREATE_SESSION', playerName: 'Alice' }));
// ← { type: 'SESSION_CREATED', sessionId: '<uuid>', playerId: 0 }
```

**Player 2** (open a second tab and repeat in its console):
```js
const ws = new WebSocket('ws://localhost:3001');
ws.onmessage = e => console.log('←', JSON.parse(e.data));

ws.send(JSON.stringify({ type: 'JOIN_SESSION', sessionId: '<uuid>', playerName: 'Bob' }));
```

Once both players are connected, dispatch actions on your turn:
```js
ws.send(JSON.stringify({ type: 'DISPATCH_ACTION', action: { /* ... */ } }));
```

---

## Notes

- Session state is held **in memory** on the server — restarting the server clears all sessions.
- Rate limiting: max 20 messages per second per WebSocket connection.
