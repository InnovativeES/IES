@echo off
title Innovative Engineering Solutions - Server
echo ---------------------------------------------------
echo   Innovative Engineering Solutions - Local Server
echo ---------------------------------------------------
echo.
echo Starting server on Port 8080...
echo.

:: Open Edge after a brief timeout to ensure server starts
timeout /t 2 >nul
start msedge http://localhost:8080/admin.html

:: Start the server (cache disabled)
call npx http-server . -p 8080 -c-1

pause
