@echo off
title LinuxBot V1
cd /d "%~dp0"
if not exist node_modules call npm install
if not exist .env (
  echo .env not found. Copy .env.example to .env and configure it.
  pause
  exit /b 1
)
call npm run register
if errorlevel 1 (
  echo Command registration failed.
  pause
  exit /b 1
)
call npm run dev
pause
