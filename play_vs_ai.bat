@echo off
TITLE Splendor Duel — Play vs AI

:: 1. Build the engine first (sync)
echo Building game engine...
call npm run build --workspace=packages/game-engine
if errorlevel 1 (
    echo Build failed. Aborting.
    pause
    exit /b 1
)

:: 2. Start the WebSocket game server
echo Starting game server on port 3001...
start "Splendor Server" cmd /k "npm run dev --workspace=packages/server"

:: 3. Start the AI game-sim HTTP server
echo Starting AI game-sim on port 3002...
start "AI Game Sim" cmd /k "npm run dev --workspace=packages/ai-game-sim"

:: Wait for both servers to initialize
timeout /t 4 /nobreak > nul

:: 4. Start the AI bot using the project venv (creates session, prints session ID)
echo Starting AI bot...
start "AI Bot" cmd /k ".venv\Scripts\play-vs-ai.exe packages\ai-trainer\checkpoints\best.pt"

:: Wait for bot to create the session and print the ID
timeout /t 3 /nobreak > nul

:: 5. Open the human CLI client
echo Opening human player CLI...
start "Human Player" cmd /k "npm run dev --workspace=packages/cli-client"

echo.
echo All systems launched.
echo Look at the "AI Bot" window for the session ID, then enter it in the "Human Player" window.
pause
