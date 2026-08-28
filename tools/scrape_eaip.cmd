@echo off
rem Double-clickable Windows wrapper for the eAIP airspace extractor.
rem (Double-clicking the .js directly hands it to Windows Script Host,
rem  which cannot run Node programs - always use this .cmd on Windows.)
setlocal
cd /d "%~dp0.."

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get the LTS version from https://nodejs.org
  echo then run this file again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\jsdom" (
  echo First run: installing the jsdom dependency, this takes a moment...
  call npm install
  if errorlevel 1 (
    echo npm install failed - check your internet connection and try again.
    echo.
    pause
    exit /b 1
  )
)

node "tools\scrape_eaip.js" %*
echo.
pause
