@echo off
rem Builds site\ and serves it on this machine and the local network, then
rem opens the browser. Double-click this file; close the window to stop.
rem
rem   http://localhost:8182     this PC. A secure context, so the service
rem                             worker runs and VFR chart tiles are cached
rem                             for offline use.
rem   http://<your-ip>:8182     a phone or tablet on the same wifi, or on
rem                             this PC's hotspot. Plain http on a LAN
rem                             address is NOT a secure context: the planner
rem                             works, but caches no chart tiles.
rem
rem Windows may ask to allow Node.js through the firewall the first time.
rem Say yes for PRIVATE networks, or the phone will just time out.
rem
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
  echo Build failed - nothing was written to site. See the message above.
  echo.
  pause
  exit /b 1
)

rem Give the server a moment to bind before the browser asks for the page.
start "" cmd /c "timeout /t 2 >nul & start """" http://localhost:8182"

echo.
node tools\serve.mjs

rem Reached when the server stops (Ctrl+C, or the port was already taken).
echo.
echo Server stopped.
pause
