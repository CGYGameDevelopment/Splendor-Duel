# Splendor Duel — Claude Instructions

## Project Overview

A TypeScript monorepo implementing the **Splendor Duel** board game as a personal/hobby project. The goal is a correct, well-architected implementation — not speed of delivery.

## Monorepo Structure

| Package | Purpose |
|---|---|
| `packages/game-engine` | Core game logic: state types, reducer, legal moves, board helpers |
| `packages/server` | Express + WebSocket server for multiplayer sessions |
| `packages/client` | React + Vite frontend (not actively developed yet) |

Build all packages: `npm run build`
Run all tests: `npm run test`

## Active Development Focus

Only `game-engine` and `server` are being actively worked on. **Do not touch the client** until the game engine is complete and solid.

## Architecture Principles

- Prioritize **clean, maintainable code** with clear separation of concerns.
- Game state is immutable — always return new state objects, never mutate in place.
- Keep the reducer pure: no side effects, no I/O, deterministic given the same inputs.
- Separate concerns clearly: types in `types.ts`, pure helpers in `helpers.ts`, state transitions in `reducer.ts`, move validation in `legalMoves.ts`.

## Game Rules

- **Always ask** before making any assumption about an ambiguous rule — even if a prior clarification exists in memory. Game correctness depends on exact rule interpretation.
- The `rulebook.txt` at the project root is the authoritative source.
- Memory may contain resolved clarifications, but confirm with the user before acting on them.

## Testing

- Use **Jest** with `ts-jest` (already configured in `game-engine`).
- Follow the **Arrange / Act / Assert** pattern with descriptive `describe` and `it` blocks.
- Tests live in `src/__tests__/` alongside the source they cover.
- Test behavior, not implementation — assert on output state and return values, not internal calls.
- Run tests after every meaningful change to `game-engine`.

## What Not To Do

- Do not work on `packages/client` until instructed.
- Do not add speculative features or abstractions beyond what is asked.
- Do not guess at game rules — stop and ask.
- Do not commit unless explicitly asked.
