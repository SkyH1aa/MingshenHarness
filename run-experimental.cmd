@echo off
setlocal EnableExtensions
cd /d "%~dp0"

if not defined MSH_USER_DATA_DIR set "MSH_USER_DATA_DIR=%LOCALAPPDATA%\MingshenHarnessExperimental"
set "MSH_EXPERIMENTAL=1"

set "NODE_EXE="
for %%P in (node.exe) do if not defined NODE_EXE if exist "%%~$PATH:P" set "NODE_EXE=%%~$PATH:P"
if not defined NODE_EXE if exist "D:\NodeJs\node.exe" set "NODE_EXE=D:\NodeJs\node.exe"
if not defined NODE_EXE if exist "C:\Program Files\nodejs\node.exe" set "NODE_EXE=C:\Program Files\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE_EXE if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set "NODE_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if defined NODE_EXE for %%D in ("%NODE_EXE%") do set "PATH=%%~dpD;%PATH%"

set "PNPM_CMD="
for %%P in (pnpm.cmd) do if not defined PNPM_CMD if exist "%%~$PATH:P" set "PNPM_CMD=%%~$PATH:P"
if not defined PNPM_CMD if exist "%APPDATA%\npm\pnpm.cmd" set "PNPM_CMD=%APPDATA%\npm\pnpm.cmd"
if not defined PNPM_CMD if exist "%LOCALAPPDATA%\pnpm\pnpm.cmd" set "PNPM_CMD=%LOCALAPPDATA%\pnpm\pnpm.cmd"
if not defined PNPM_CMD if exist "D:\NodeJs\pnpm.cmd" set "PNPM_CMD=D:\NodeJs\pnpm.cmd"
if not defined PNPM_CMD if exist "C:\Program Files\nodejs\pnpm.cmd" set "PNPM_CMD=C:\Program Files\nodejs\pnpm.cmd"
if not defined PNPM_CMD if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd" set "PNPM_CMD=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd"

set "PNPM_COREPACK="
if not defined PNPM_CMD for %%P in (corepack.cmd) do if not defined PNPM_CMD if exist "%%~$PATH:P" set "PNPM_CMD=%%~$PATH:P"
if defined PNPM_CMD echo "%PNPM_CMD%" | findstr /I /E "corepack.cmd" >nul && set "PNPM_COREPACK=1"
if defined PNPM_CMD for %%D in ("%PNPM_CMD%") do set "PATH=%%~dpD;%PATH%"

if "%~1"=="--check" (
  echo Node: %NODE_EXE%
  echo pnpm: %PNPM_CMD%
  echo Data: %MSH_USER_DATA_DIR%
  if not defined NODE_EXE exit /b 2
  if not defined PNPM_CMD exit /b 3
  exit /b 0
)

if not defined NODE_EXE (
  echo Node.js was not found.
  echo Install Node.js 24 or newer, then run this file again.
  goto :error
)

if not defined PNPM_CMD (
  echo pnpm was not found.
  echo Install pnpm 11 or newer, then run this file again.
  goto :error
)

if not exist "apps\desktop\resources\native\codex-sandbox.exe" (
  echo Preparing the verified native Windows sandbox runtime...
  "%NODE_EXE%" scripts\provision-native-runtime.mjs
  if errorlevel 1 goto :error
)

if not exist "node_modules" (
  echo Installing dependencies...
  if defined PNPM_COREPACK (
    call "%PNPM_CMD%" pnpm install
  ) else (
    call "%PNPM_CMD%" install
  )
  if errorlevel 1 goto :error
)

"%NODE_EXE%" scripts\provision-electron-runtime.cjs
if errorlevel 1 goto :error

if exist "apps\desktop\out\main\index.js" goto :launch

echo Building Mingshen Harness experimental version...
if defined PNPM_COREPACK (
  call "%PNPM_CMD%" pnpm build
) else (
  call "%PNPM_CMD%" build
)
if errorlevel 1 goto :error

:launch
echo Starting Mingshen Harness 1.3.2 experimental build...
"%NODE_EXE%" scripts\prepare-experimental-runtime.cjs --launch
if errorlevel 1 goto :error
exit /b 0

:error
echo.
echo Mingshen Harness failed to start.
pause
exit /b 1
