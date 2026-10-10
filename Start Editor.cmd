@echo off
rem Starts the Heart & Soul Save Editor and opens it in the browser.
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install || goto :error
)
start "" http://localhost:5173
call npm run dev -- --port 5173 --strictPort
goto :eof
:error
echo Something went wrong. Make sure Node.js is installed.
pause
