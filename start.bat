@echo off
echo Starting Bags Index...
echo.

:: Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo Starting local server with Node.js...
    echo Open http://localhost:3000 in your browser
    echo.
    node server.js
) else (
    :: Try Python as fallback
    where python >nul 2>nul
    if %ERRORLEVEL% EQU 0 (
        echo Starting local server with Python...
        echo Open http://localhost:8000 in your browser
        echo.
        python -m http.server 8000
    ) else (
        echo ERROR: Neither Node.js nor Python found!
        echo.
        echo Please install one of the following:
        echo   - Node.js: https://nodejs.org/
        echo   - Python: https://python.org/
        echo.
        echo Or open index.html directly in your browser
        echo (Note: Some features may not work due to CORS)
        pause
    )
)
