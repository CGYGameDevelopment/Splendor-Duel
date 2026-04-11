@echo off
TITLE Splendor Duel Launcher

:: 1. Build the engine first (Sync)
echo Building game engine...
call npm run build --workspace=packages/game-engine

:: 2. Start the Server in a new window
echo Starting Server on port 3001...
start "Splendor Server" cmd /k "npm run dev --workspace=packages/server"

:: Wait 3 seconds for server to initialize
timeout /t 3 /nobreak > nul

:: 3. Start Player 1 CLI
echo Opening Player 1 CLI...
start "Player 1 (Alice)" cmd /k "npm run dev --workspace=packages/cli-client"

:: 4. Start Player 2 CLI
echo Opening Player 2 CLI...
start "Player 2 (Bob)" cmd /k "npm run dev --workspace=packages/cli-client"

echo All systems launched.
pause