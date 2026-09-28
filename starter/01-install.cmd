@echo off
chcp 65001 >nul
node "%~dp0toolkit\starter\runner.mjs" install %*
set "TECH_RESUME_EXIT=%ERRORLEVEL%"
if not "%TECH_RESUME_NO_PAUSE%"=="1" pause
exit /b %TECH_RESUME_EXIT%
