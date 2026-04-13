# Splendor Duel — Claude Instructions

See `README.md` for project overview, setup, and run instructions.

## Monorepo Structure

| Package | Purpose |
|---|---|
| `packages/game-engine` | Core game logic: state types, reducer, legal moves, board helpers |
| `packages/server` | Express + WebSocket server for multiplayer sessions |
| `packages/cli-client` | Terminal-based interactive client for local play |
| `packages/ai-game-sim` | HTTP server wrapping game-engine for Python AI training |
| `packages/ai-trainer` | Python RL training pipeline (PPO, self-play, evaluation) |
| `packages/client` | React + Vite frontend (not actively developed yet) |

## Architecture Principles

- The goal is a **correct, well-architected implementation** — not speed of delivery.
- Prioritize **clean, maintainable code** with clear separation of concerns.
- Game state is immutable — always return new state objects, never mutate in place.
- Keep the reducer pure: no side effects, no I/O, deterministic given the same inputs.
- Separate concerns clearly: types in `types.ts`, pure helpers in `helpers.ts`, state transitions in `reducer.ts`, move validation in `legalMoves.ts`.

## Game Rules

- **Always ask** before making any assumption about an ambiguous rule — even if a prior clarification exists in memory. Game correctness depends on exact rule interpretation.
- The `rulebook.md` at the project root is the authoritative source.
- Memory may contain resolved clarifications, but confirm with the user before acting on them.

## Testing

- Use **Jest** with `ts-jest` (already configured in `game-engine`).
- Follow the **Arrange / Act / Assert** pattern with descriptive `describe` and `it` blocks.
- Tests live in `src/__tests__/` alongside the source they cover.
- Test behavior, not implementation — assert on output state and return values, not internal calls.
- Run tests after every meaningful change to `game-engine`.

## What Not To Do

- Do not add speculative features or abstractions beyond what is asked.
- Do not guess at game rules — stop and ask.
- Do not commit unless explicitly asked.

