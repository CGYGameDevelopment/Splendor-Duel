@echo off
TITLE Splendor Duel GUI Launcher

:: 1. Build the engine first (sync)
echo Building game engine...
call npm run build --workspace=packages/game-engine

:: 2. Kill anything already on port 3001, then start the server
echo Clearing port 3001...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3001 " 2^>nul') do taskkill /PID %%a /F >nul 2>&1
echo Starting Server on port 3001...
start "Splendor Server" cmd /k "npm run dev --workspace=packages/server"

:: Wait 3 seconds for server to initialize
timeout /t 3 /nobreak > nul

:: 3. Kill anything already on port 5173, then start the GUI client
echo Clearing port 5173...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5173 " 2^>nul') do taskkill /PID %%a /F >nul 2>&1
echo Starting GUI client at http://localhost:5173 ...
start "Splendor GUI Client" cmd /k "npm run dev --workspace=packages/client"

:: Wait for Vite to be ready, then open two browser tabs (one per player)
timeout /t 3 /nobreak > nul
echo Opening browser...
start "" "http://localhost:5173"
start "" "http://localhost:5173"

echo All systems launched.
pause
