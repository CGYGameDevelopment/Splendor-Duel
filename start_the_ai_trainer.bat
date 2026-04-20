@echo off
setlocal enabledelayedexpansion

set CHECKPOINT_DIR=packages\ai-trainer\checkpoints
set BEST_PT=%CHECKPOINT_DIR%\best.pt
set LATEST_PT=%CHECKPOINT_DIR%\latest.pt
set LOG_CSV=%CHECKPOINT_DIR%\training_log.csv
set ERROR_LOG=trainer_error.log

:: Create checkpoint directory if it doesn't exist
if not exist "%CHECKPOINT_DIR%" mkdir "%CHECKPOINT_DIR%"

:MENU
cls
echo ==============================================
echo   Splendor Duel ^| AI Trainer
echo ==============================================
echo.

:: Detect existing checkpoints
set HAS_BEST=0
set HAS_LATEST=0
set HAS_LOG=0
if exist "%BEST_PT%"   set HAS_BEST=1
if exist "%LATEST_PT%" set HAS_LATEST=1
if exist "%LOG_CSV%"   set HAS_LOG=1

set HAS_ANY_CKPT=0
if %HAS_BEST%==1   set HAS_ANY_CKPT=1
if %HAS_LATEST%==1 set HAS_ANY_CKPT=1

:: Print model status
if %HAS_BEST%==1 (
    echo   [MODEL]  best.pt found
) else if %HAS_LATEST%==1 (
    echo   [MODEL]  No best model yet ^(latest.pt available^)
) else (
    echo   [MODEL]  No trained model found
)
if %HAS_LATEST%==1 echo   [CKPT]   latest.pt found
if %HAS_LOG%==1    echo   [LOG]    training_log.csv found
echo.

:: ---- Build menu ----
echo   Options:
echo.
if %HAS_ANY_CKPT%==1 (
    set NEXT_OPT=1
    if %HAS_BEST%==1 (
        echo   1. Continue training from best model    ^(best.pt^)
        echo   2. Continue training from latest ckpt   ^(latest.pt^)
        echo   3. Start fresh training
        set FRESH_OPT=3
        set NEXT_OPT=4
    ) else (
        echo   1. Continue training from latest ckpt   ^(latest.pt^)
        echo   2. Start fresh training
        set FRESH_OPT=2
        set NEXT_OPT=3
    )
    if %HAS_LOG%==1 (
        echo   !NEXT_OPT!. View training log ^(last 20 rows^)
        set /a EXIT_OPT=NEXT_OPT+1
        echo   !EXIT_OPT!. Exit
    ) else (
        echo   !NEXT_OPT!. Exit
        set EXIT_OPT=!NEXT_OPT!
    )
) else (
    echo   1. Start fresh training ^(default settings^)
    echo   2. Start fresh training ^(custom settings^)
    echo   3. Exit
)

echo.
set /p CHOICE="  Enter option: "

:: ---- Route choice ----
if %HAS_ANY_CKPT%==1 (
    if %HAS_BEST%==1 (
        if "%CHOICE%"=="1" goto RESUME_BEST
        if "%CHOICE%"=="2" goto RESUME_LATEST
        if "%CHOICE%"=="3" goto FRESH
        if %HAS_LOG%==1 (
            if "%CHOICE%"=="4" goto VIEW_LOG
            if "%CHOICE%"=="5" goto EXIT
        ) else (
            if "%CHOICE%"=="4" goto EXIT
        )
    ) else (
        if "%CHOICE%"=="1" goto RESUME_LATEST
        if "%CHOICE%"=="2" goto FRESH
        if %HAS_LOG%==1 (
            if "%CHOICE%"=="3" goto VIEW_LOG
            if "%CHOICE%"=="4" goto EXIT
        ) else (
            if "%CHOICE%"=="3" goto EXIT
        )
    )
) else (
    if "%CHOICE%"=="1" goto FRESH_DEFAULT
    if "%CHOICE%"=="2" goto FRESH_CUSTOM
    if "%CHOICE%"=="3" goto EXIT
)

echo.
echo   Invalid option. Press any key to try again.
pause >nul
goto MENU

:: ============================================================
:RESUME_BEST
cls
echo ==============================================
echo   Resume from best.pt
echo ==============================================
echo.
set /p ITERS="  Additional iterations to train [default: 500]: "
if "%ITERS%"=="" set ITERS=500
goto START_TRAINING_RESUME_BEST

:RESUME_LATEST
cls
echo ==============================================
echo   Resume from latest.pt
echo ==============================================
echo.
if %HAS_LATEST%==0 (
    echo   latest.pt not found. Falling back to best.pt.
    set RESUME_FILE=%BEST_PT%
) else (
    set RESUME_FILE=%LATEST_PT%
)
set /p ITERS="  Additional iterations to train [default: 500]: "
if "%ITERS%"=="" set ITERS=500
goto START_TRAINING_RESUME

:FRESH
cls
echo ==============================================
echo   Start Fresh Training
echo ==============================================
echo.
echo   WARNING: Existing checkpoints will NOT be
echo   deleted, but will be overwritten as training
echo   progresses.
echo.
set /p CONFIRM="  Type YES to confirm: "
if /i not "%CONFIRM%"=="YES" goto MENU
set /p ITERS="  Number of iterations [default: 500]: "
if "%ITERS%"=="" set ITERS=500
goto START_TRAINING_FRESH

:FRESH_DEFAULT
set ITERS=500
goto START_TRAINING_FRESH

:FRESH_CUSTOM
cls
echo ==============================================
echo   Custom Training Settings
echo ==============================================
echo.
set /p ITERS="  Number of iterations        [default: 500]:  "
if "%ITERS%"=="" set ITERS=500
set /p EPS="  Episodes per iteration      [default: 20]:   "
if "%EPS%"=="" set EPS=20
set /p LR="  Learning rate               [default: 3e-4]: "
if "%LR%"=="" set LR=3e-4
goto START_TRAINING_CUSTOM

:VIEW_LOG
cls
echo ==============================================
echo   Training Log (last 20 rows)
echo ==============================================
echo.
powershell -Command "Get-Content '%LOG_CSV%' | Select-Object -Last 20"
echo.
pause
goto MENU

:EXIT
echo.
echo   Goodbye.
exit /b 0

:: ============================================================
:: Start game-sim then launch training
:: ============================================================

:START_TRAINING_FRESH
set TRAINING_TYPE=FRESH
goto DO_TRAINING

:START_TRAINING_RESUME_BEST
set TRAINING_TYPE=RESUME_BEST
goto DO_TRAINING

:START_TRAINING_RESUME
set TRAINING_TYPE=RESUME
goto DO_TRAINING

:START_TRAINING_CUSTOM
set TRAINING_TYPE=CUSTOM
goto DO_TRAINING

:DO_TRAINING
call :LAUNCH_SIM

if "%TRAINING_TYPE%"=="FRESH"     goto RUN_FRESH
if "%TRAINING_TYPE%"=="RESUME_BEST" goto RUN_RESUME_BEST
if "%TRAINING_TYPE%"=="RESUME"    goto RUN_RESUME
if "%TRAINING_TYPE%"=="CUSTOM"    goto RUN_CUSTOM
goto END

:RUN_FRESH
echo   Starting fresh training for %ITERS% iterations...
echo.
call :CHECK_TRAIN_CMD
if %ERRORLEVEL% neq 0 goto ERROR_NOTFOUND
call :LOG_START "fresh training: %ITERS% iterations"
train --iterations %ITERS% --checkpoint-dir %CHECKPOINT_DIR%
call :LOG_EXIT
goto END

:RUN_RESUME_BEST
echo   Resuming from best.pt for %ITERS% iterations...
echo.
call :CHECK_TRAIN_CMD
if %ERRORLEVEL% neq 0 goto ERROR_NOTFOUND
call :LOG_START "resume from %BEST_PT% for %ITERS% iterations"
train --resume %BEST_PT% --iterations %ITERS% --checkpoint-dir %CHECKPOINT_DIR%
call :LOG_EXIT
goto END

:RUN_RESUME
echo   Resuming from %RESUME_FILE% for %ITERS% iterations...
echo.
call :CHECK_TRAIN_CMD
if %ERRORLEVEL% neq 0 goto ERROR_NOTFOUND
call :LOG_START "resume from %RESUME_FILE% for %ITERS% iterations"
train --resume %RESUME_FILE% --iterations %ITERS% --checkpoint-dir %CHECKPOINT_DIR%
call :LOG_EXIT
goto END

:RUN_CUSTOM
echo   Starting fresh training: %ITERS% iters, %EPS% eps/iter, lr=%LR%...
echo.
call :CHECK_TRAIN_CMD
if %ERRORLEVEL% neq 0 goto ERROR_NOTFOUND
call :LOG_START "custom training: %ITERS% iters, %EPS% eps, lr=%LR%"
train --iterations %ITERS% --episodes-per-iter %EPS% --lr %LR% --checkpoint-dir %CHECKPOINT_DIR%
call :LOG_EXIT
goto END

:: ============================================================
:: Error handling subroutines
:: ============================================================

:CHECK_TRAIN_CMD
if exist ".venv\Scripts\activate.bat" (
    call .venv\Scripts\activate.bat
)
where train >nul 2>&1
if %ERRORLEVEL% neq 0 (
    exit /b 1
)
exit /b 0

:LOG_START
setlocal enabledelayedexpansion
for /f "tokens=2-4 delims=/ " %%a in ('date /t') do (set mydate=%%c-%%a-%%b)
for /f "tokens=1-2 delims=/:" %%a in ('time /t') do (set mytime=%%a:%%b)
echo [%mydate% %mytime%] START: %~1 >> %ERROR_LOG%
endlocal
exit /b 0

:LOG_EXIT
setlocal enabledelayedexpansion
for /f "tokens=2-4 delims=/ " %%a in ('date /t') do (set mydate=%%c-%%a-%%b)
for /f "tokens=1-2 delims=/:" %%a in ('time /t') do (set mytime=%%a:%%b)
if %ERRORLEVEL% equ 0 (
    echo [%mydate% %mytime%] SUCCESS (exit code 0) >> %ERROR_LOG%
) else (
    echo [%mydate% %mytime%] FAILED (exit code %ERRORLEVEL%) >> %ERROR_LOG%
)
endlocal
exit /b 0

:ERROR_NOTFOUND
cls
echo ==============================================
echo   ERROR: train command not found
echo ==============================================
echo.
echo   The 'train' command is not available on
echo   your system PATH. This usually means the
echo   ai-trainer package is not installed.
echo.
echo   To fix this, run:
echo.
echo   cd packages\ai-trainer
echo   pip install -e .
echo.
echo   Then try again.
echo.
echo   Error log: %ERROR_LOG%
echo.
pause
goto MENU

:: ============================================================
:: Subroutine: launch game-sim in a new window if not running
:: ============================================================
:LAUNCH_SIM
cls
echo ==============================================
echo   Starting Game Sim (port 3002)
echo ==============================================
echo.
netstat -ano | findstr ":3002 " | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 (
    echo   Game sim already running on port 3002. Skipping.
) else (
    echo   Launching game-sim in a new window...
    start "Splendor Duel Game Sim" cmd /k "cd /d packages\ai-game-sim && npm run dev"
    echo   Waiting 5 seconds for sim to boot...
    timeout /t 5 /nobreak >nul
)
echo.
exit /b 0

:END
echo.
if %ERRORLEVEL% equ 0 (
    echo ==============================================
    echo   Training completed successfully!
    echo ==============================================
) else (
    echo ==============================================
    echo   Training ended with errors
    echo ==============================================
    echo.
    echo   Exit code: %ERRORLEVEL%
    echo.
    echo   Check the error log for details:
    echo   %ERROR_LOG%
    echo.
    if exist "%ERROR_LOG%" (
        echo   Last 10 log entries:
        echo   ---
        powershell -Command "Get-Content '%ERROR_LOG%' | Select-Object -Last 10"
        echo   ---
    )
)
echo.
pause
goto MENU
