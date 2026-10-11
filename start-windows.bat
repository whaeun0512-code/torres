@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js LTS from https://nodejs.org/ and try again.
  pause
  exit /b 1
)
if not exist node_modules (
  call npm ci
  if errorlevel 1 (
    echo Installation failed. Please check your internet connection.
    pause
    exit /b 1
  )
)
call npm run dev -- --host 127.0.0.1 --port 3000 --strictPort --open
pause
