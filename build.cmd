@echo off
rem Rebuilds dist\C182_FlightPlanner.html from src\ and opens it.
rem (Do NOT double-click any .js file directly: Windows runs bare .js with
rem  the legacy Windows Script Host, which cannot run Node programs.)
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get the LTS version from https://nodejs.org
  echo then run this file again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\esbuild" (
  echo First run: installing build dependencies, this takes a moment...
  call npm install
  if errorlevel 1 (
    echo npm install failed - check your internet connection and try again.
    echo.
    pause
    exit /b 1
  )
)

call npm run build
if errorlevel 1 (
  echo.
  echo Build failed - nothing was written to dist. See the message above.
  echo.
  pause
  exit /b 1
)

echo.
echo Opening dist\C182_FlightPlanner.html ...
start "" "dist\C182_FlightPlanner.html"
echo.
pause
