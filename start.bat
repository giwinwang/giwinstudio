@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
if not exist node_modules (
  echo First run: installing required files...
  call npm install
  if errorlevel 1 goto failed
)
call npm start
if errorlevel 1 goto failed
exit /b 0
:failed
echo.
echo [FAILED] The app could not start. Keep this window open and send a screenshot of the message above.
pause
exit /b 1
