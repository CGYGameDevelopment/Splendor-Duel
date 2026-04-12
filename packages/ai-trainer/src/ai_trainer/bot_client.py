"""
WebSocket bot client: connects to the game server and plays as the AI.

Usage:
    play-vs-ai checkpoints/model_iter0500_wr0.80.pt

The bot creates a session, prints the session ID, and waits for a human to join
using the CLI client. Once both players are connected the game starts automatically.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import numpy as np
import requests
import torch
import typer
import websockets

from .action_space import build_legal_mask, index_to_action
from .model import ActorCriticNet
from .state_encoder import encode

app = typer.Typer(add_completion=False)


def _legal_moves_from_state(sim_url: str, state: dict) -> list[dict]:
    """Fetch legal moves for an arbitrary state from the game-sim server."""
    r = requests.post(
        f"{sim_url}/legal-moves-from-state",
        json={"state": state},
        timeout=10,
    )
    r.raise_for_status()
    return r.json()["legalMoves"]


@torch.no_grad()
def _pick_action(
    model: ActorCriticNet,
    state: dict,
    legal_moves: list[dict],
    device: torch.device,
    greedy: bool,
) -> dict | None:
    """Run the model and return a concrete action dict."""
    obs_t = torch.tensor(encode(state), dtype=torch.float32, device=device).unsqueeze(0)
    mask_t = torch.tensor(
        build_legal_mask(legal_moves), dtype=torch.bool, device=device
    ).unsqueeze(0)

    dist = model.masked_policy(obs_t, mask_t)
    action_idx = int(dist.logits.argmax().item()) if greedy else int(dist.sample().item())
    return index_to_action(action_idx, legal_moves)


async def _take_turn(
    ws,
    model: ActorCriticNet,
    state: dict,
    sim_url: str,
    device: torch.device,
    greedy: bool,
) -> None:
    # Run the blocking HTTP call in a thread executor so the asyncio event loop
    # is not blocked while waiting for the game-sim response.
    loop = asyncio.get_running_loop()
    legal_moves = await loop.run_in_executor(
        None, lambda: _legal_moves_from_state(sim_url, state)
    )
    if not legal_moves:
        return
    action = _pick_action(model, state, legal_moves, device, greedy)
    if action is None:
        typer.echo("[AI] Could not map a legal action — skipping.", err=True)
        return
    await ws.send(json.dumps({"type": "DISPATCH_ACTION", "action": action}))


async def _run(
    checkpoint: Path,
    server_url: str,
    sim_url: str,
    bot_name: str,
    greedy: bool,
) -> None:
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    model = ActorCriticNet().to(device)
    ckpt = torch.load(str(checkpoint), map_location=device, weights_only=True)
    model.load_state_dict(ckpt["model_state"])
    model.eval()
    typer.echo(f"Loaded: {checkpoint}")

    # Verify game-sim is reachable (needed for legal move lookups)
    try:
        r = requests.get(f"{sim_url}/health", timeout=3)
        r.raise_for_status()
    except requests.ConnectionError:
        typer.echo(
            f"ERROR: game-sim server not reachable at {sim_url}\n"
            "Start it with: cd packages/game-sim && npm run dev",
            err=True,
        )
        raise typer.Exit(code=1)

    typer.echo(f"Connecting to {server_url} ...")
    async with websockets.connect(server_url) as ws:
        await ws.send(json.dumps({"type": "CREATE_SESSION", "playerName": bot_name}))

        my_player_id: int | None = None

        async for raw in ws:
            msg = json.loads(raw)
            msg_type = msg.get("type")

            if msg_type == "SESSION_CREATED":
                my_player_id = msg["playerId"]  # always 0
                typer.echo(f"\nSession ID: {msg['sessionId']}")
                typer.echo("Share that ID with the human player, then have them join.\n")
                typer.echo("Waiting for opponent...")

            elif msg_type == "GAME_STARTED":
                state: dict = msg["state"]
                typer.echo(f"Game started! Opponent: {msg.get('opponentName', 'Human')}")
                typer.echo(f"AI is Player {my_player_id}. Mode: {'greedy' if greedy else 'sampled'}\n")
                if state.get("currentPlayer") == my_player_id:
                    await _take_turn(ws, model, state, sim_url, device, greedy)

            elif msg_type == "STATE_UPDATE":
                state = msg["state"]
                if state.get("phase") == "game_over":
                    winner = state.get("winner")
                    if winner == my_player_id:
                        typer.echo("Game over — AI wins!")
                    else:
                        typer.echo("Game over — Human wins!")
                    break
                if state.get("currentPlayer") == my_player_id:
                    await _take_turn(ws, model, state, sim_url, device, greedy)

            elif msg_type == "OPPONENT_DISCONNECTED":
                typer.echo("Opponent disconnected.")
                break

            elif msg_type == "ERROR":
                typer.echo(f"[Server] {msg.get('message')}", err=True)

            elif msg_type == "PONG":
                pass


@app.command()
def main(
    checkpoint: Path = typer.Argument(..., help="Path to a .pt checkpoint file"),
    server: str = typer.Option("ws://localhost:3001", help="WebSocket server URL"),
    sim_url: str = typer.Option("http://127.0.0.1:3002", help="game-sim server URL"),
    name: str = typer.Option("AI", help="Display name shown to the human player"),
    greedy: bool = typer.Option(False, help="Pick the highest-probability move instead of sampling"),
) -> None:
    """Run the AI bot. It creates a session and waits for a human to join."""
    asyncio.run(_run(checkpoint, server, sim_url, name, greedy))
