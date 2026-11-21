@echo off
setlocal
cd /d "%~dp0"
title Tutorial Tracker

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get Node 22.13 or newer from https://nodejs.org
  pause
  exit /b 1
)
node -e "const[a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 (
  echo Your Node.js is too old. Tutorial Tracker needs Node 22.13 or newer.
  node -v
  pause
  exit /b 1
)

REM open the browser a moment after the server is up
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:4173"
node --disable-warning=ExperimentalWarning server\index.js
pause
