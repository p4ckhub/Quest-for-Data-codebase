@echo off
setlocal

rem Run this from inside the cloned Quest-for-Data-codebase folder (Windows branch).
rem Full sequence per WINDOWS_PHASE.md (verified 2026-07-12).

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo === Node.js not found - installing via winget ===
    where winget >nul 2>nul
    if errorlevel 1 (
        echo winget is not available on this machine.
        echo Install Node.js LTS manually from https://nodejs.org, then re-run this script.
        pause
        exit /b 1
    )

    winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
    if errorlevel 1 goto :error

    rem winget updates the registry, not this already-open cmd session's PATH.
    rem Pull the fresh machine + user PATH from the registry so `node`/`npm`
    rem resolve without having to close and reopen the terminal.
    for /f "usebackq tokens=2,*" %%A in (`reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path`) do set "SYS_PATH=%%B"
    for /f "usebackq tokens=2,*" %%A in (`reg query "HKCU\Environment" /v Path 2^>nul`) do set "USER_PATH=%%B"
    set "PATH=%SYS_PATH%;%USER_PATH%"

    where node >nul 2>nul
    if errorlevel 1 (
        echo Node.js was installed but isn't resolving in this session.
        echo Close this window, re-open a new terminal, and re-run this script.
        pause
        exit /b 1
    )
)

echo === Installing root dependencies ===
call npm ci
if errorlevel 1 goto :error

echo === Installing ui/ dependencies ===
cd ui
call npm ci
if errorlevel 1 goto :error
cd ..

echo === Fetching MinGW-w64 toolchain (~215 MB, first run only) ===
call npm run toolchain:fetch
if errorlevel 1 goto :error

echo === Building renderer (ui/dist) ===
call npm run build
if errorlevel 1 goto :error

echo === Compiling main process (dist/app/main.js) ===
call npx tsc
rem npx tsc exits nonzero on ~100 pre-existing type errors; dist/app/main.js
rem still emits, so don't treat this as fatal.

echo === Launching ===
call npx electron dist/app/main.js
goto :eof

:error
echo.
echo Build step failed - see output above.
pause
exit /b 1
