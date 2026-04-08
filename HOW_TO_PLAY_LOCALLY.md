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

## Notes

- The client (`packages/client`) is not yet implemented.
- Session state is held **in memory** on the server — restarting the server clears all sessions.
- Two players connect via WebSocket, create/join a session, then exchange game actions through the socket.
