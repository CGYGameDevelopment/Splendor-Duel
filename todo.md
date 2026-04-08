# Splendor Duel - Development TODO

## Current Status
**Last Updated**: 2026-04-08


---

## 🔄 In Progress

- [ ] Verify server session persistence and cleanup

---

## 📋 Pending Tasks

### Core Logic & Validation (High Priority)
- [ ] Add client-side legal move validation
- [ ] Build and test full end-to-end game flow

### Game State & Connectivity (Medium Priority)
- [ ] Create client-side game state management and WebSocket connection logic
- [ ] Implement game action handlers (take tokens, purchase cards, reserve, etc.)
- [ ] Implement real-time game state sync from server
- [ ] Add error handling and connection state management

### User Interface (Low Priority)
- [ ] Build game lobby and session management UI
- [ ] Build main game board UI component
- [ ] Build player hand and reserved cards UI
- [ ] Build token pool and board display
- [ ] Implement React client application with game UI
- [ ] Style UI with CSS (responsive design for different screen sizes)

### Deployment
- [ ] Deploy server and client to production environment

---

## Project Structure

```
Splendor Duel (monorepo)
├── packages/
│   ├── game-engine/          [TypeScript, ~90% complete]
│   │   ├── types.ts          [All game types defined]
│   │   ├── reducer.ts        [Full state management]
│   │   ├── legalMoves.ts     [Move validation]
│   │   ├── board.ts          [Board logic & adjacency]
│   │   ├── helpers.ts        [Game utilities]
│   │   ├── initialState.ts   [Initial game state factory]
│   │   ├── index.ts          [Package entry point]
│   │   ├── data/cards.json   [Card definitions]
│   │   └── __tests__/        [74 tests: all passing]
│   │
│   ├── server/               [Express + WebSocket, ~50% complete]
│   │   ├── index.ts          [HTTP & WebSocket server]
│   │   ├── sessionManager.ts [Game session handling]
│   │   └── protocol.ts       [Message types]
│   │
│   └── client/               [React + Vite, 0% — not yet started]
│       └── package.json      [Dependencies configured]
```

---

## Next Steps

**Immediate (Next Task)**
1. Verify server session persistence and cleanup
2. Ensure sessions properly create/join/disconnect and test multi-player session handling

**Short Term**
1. Build client-side WebSocket integration
2. Implement game state synchronization
3. Add client-side legal move validation
4. Build core game loop

**Medium Term**
1. Implement UI components (board, hand, tokens)
2. Test end-to-end game flow
3. Add error handling and reconnection logic

**Long Term**
1. Polish UI/UX
2. Performance optimization
3. Deployment & hosting

