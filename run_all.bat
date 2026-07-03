@echo off
REM Double-click launcher for NATIVE Windows only (uv/npm/ollama installed
REM directly on Windows). If you use WSL, this will not work -- use
REM ./run_all.sh from your WSL terminal instead, see README.md.
cd /d "%~dp0"

where uv >nul 2>nul
if errorlevel 1 (
    echo Error: uv is not installed or not in PATH.
    pause
    exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
    echo Error: npm/node is not installed or not in PATH.
    pause
    exit /b 1
)

REM The backend port is fixed (CORS/the frontend proxy both assume 8000) --
REM if it's already in use, fail clearly instead of uvicorn crashing a few
REM lines into its own startup log where it's easy to miss.
netstat -ano | findstr /r /c:"LISTENING" | findstr ":8000 " >nul
if not errorlevel 1 (
    echo Error: port 8000 is already in use by another program.
    echo Stop whatever's using it, then run this again.
    echo ^(Run 'netstat -ano ^| findstr :8000' to see what's using it.^)
    pause
    exit /b 1
)

REM First-run frontend deps: without this, a fresh clone's npm run dev fails
REM instantly with nothing installed, and the browser opens to a white
REM screen a few seconds later with no explanation why.
if not exist "web\node_modules" (
    echo First run: installing frontend dependencies ^(one-time, ~1-2 min^)...
    pushd web
    call npm install
    popd
)

start "Jignasa Backend" cmd /k uv run uvicorn api.main:app --reload --host 127.0.0.1 --port 8000
cd web
start "Jignasa Frontend" cmd /k npm run dev
cd ..

REM Poll for the backend actually being up instead of a blind timeout --
REM first-run startup (loading the embedding model, etc.) can take well
REM over a few seconds, and opening the browser before it's ready is
REM exactly what produces a white screen with no explanation. Waits up to
REM 60s. Doesn't pre-detect the frontend's actual port the way run_all.sh
REM does -- if 5173 is already taken, Vite picks the next free one on its
REM own and prints it in the "Jignasa Frontend" window; check that window's
REM output if the tab that opens below looks broken.
set WAITED=0
:waitloop
netstat -ano | findstr /r /c:"LISTENING" | findstr ":8000 " >nul
if not errorlevel 1 goto backendready
set /a WAITED+=1
if %WAITED% GEQ 60 goto backendready
timeout /t 1 /nobreak >nul
goto waitloop
:backendready
start http://localhost:5173
