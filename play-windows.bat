@echo off
setlocal

rem Run this from inside the cloned Quest-for-Data-codebase folder (Windows branch).
rem Full sequence per WINDOWS_PHASE.md (verified 2026-07-12).

cd /d "%~dp0"

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
