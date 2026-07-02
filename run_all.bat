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

start "Jignasa Backend" cmd /k uv run uvicorn api.main:app --reload --host 127.0.0.1 --port 8000
cd web
start "Jignasa Frontend" cmd /k npm run dev
cd ..

REM Unlike run_all.sh, this doesn't pre-detect the frontend's actual port --
REM if 5173 is already taken, Vite will pick the next free one on its own
REM and print it in the "Jignasa Frontend" window; the browser tab opened
REM below may be wrong in that specific case, so check that window's output
REM if the tab that opens looks broken.
timeout /t 3 /nobreak >nul
start http://localhost:5173
