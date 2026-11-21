@echo off
REM Stops the Tutorial Tracker server (whatever listens on port 4173).
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":4173 " ^| findstr LISTENING') do taskkill /PID %%p /F >nul 2>nul
echo Stopped.
