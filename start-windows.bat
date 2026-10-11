@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 24 LTS from https://nodejs.org/ and try again.
  pause
  exit /b 1
)
node -e "const [major,minor]=process.versions.node.split('.').map(Number);process.exit(major>22 || major===22 && minor>=12 ? 0 : 1)"
if errorlevel 1 (
  echo Node.js 22.12 or newer is required. Please install Node.js 24 LTS.
  pause
  exit /b 1
)
echo Preparing Our days dependencies...
call npm ci --no-audit --no-fund
if errorlevel 1 (
  echo Installation failed. Please check your internet connection.
  pause
  exit /b 1
)
call npm run dev -- --host 127.0.0.1 --port 3000 --strictPort --open
pause
