@echo off
title LinuxBot V1 Installer
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20+ is required.
  pause
  exit /b 1
)
call npm install
if not exist .env copy .env.example .env >nul
echo.
echo Done. Edit .env then run start.bat
pause
