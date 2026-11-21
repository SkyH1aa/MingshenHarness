@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"

set "MSH_PACKAGE_NODE="
for %%P in (node.exe) do if not defined MSH_PACKAGE_NODE if exist "%%~$PATH:P" set "MSH_PACKAGE_NODE=%%~$PATH:P"
if not defined MSH_PACKAGE_NODE if exist "D:\NodeJs\node.exe" set "MSH_PACKAGE_NODE=D:\NodeJs\node.exe"
if not defined MSH_PACKAGE_NODE if exist "%ProgramFiles%\nodejs\node.exe" set "MSH_PACKAGE_NODE=%ProgramFiles%\nodejs\node.exe"
if not defined MSH_PACKAGE_NODE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "MSH_PACKAGE_NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined MSH_PACKAGE_NODE if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set "MSH_PACKAGE_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not defined MSH_PACKAGE_NODE goto missing_node
for %%D in ("%MSH_PACKAGE_NODE%") do set "PATH=%%~dpD;%PATH%"

set "MSH_PACKAGE_PNPM="
for %%P in (pnpm.cmd pnpm.exe) do if not defined MSH_PACKAGE_PNPM if exist "%%~$PATH:P" set "MSH_PACKAGE_PNPM=%%~$PATH:P"
if not defined MSH_PACKAGE_PNPM if exist "%APPDATA%\npm\pnpm.cmd" set "MSH_PACKAGE_PNPM=%APPDATA%\npm\pnpm.cmd"
if not defined MSH_PACKAGE_PNPM if exist "%LOCALAPPDATA%\pnpm\pnpm.cmd" set "MSH_PACKAGE_PNPM=%LOCALAPPDATA%\pnpm\pnpm.cmd"
if not defined MSH_PACKAGE_PNPM if exist "%LOCALAPPDATA%\pnpm\pnpm.exe" set "MSH_PACKAGE_PNPM=%LOCALAPPDATA%\pnpm\pnpm.exe"
if not defined MSH_PACKAGE_PNPM if exist "D:\NodeJs\pnpm.cmd" set "MSH_PACKAGE_PNPM=D:\NodeJs\pnpm.cmd"
if not defined MSH_PACKAGE_PNPM if exist "%ProgramFiles%\nodejs\pnpm.cmd" set "MSH_PACKAGE_PNPM=%ProgramFiles%\nodejs\pnpm.cmd"
if not defined MSH_PACKAGE_PNPM if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd" set "MSH_PACKAGE_PNPM=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd"
if not defined MSH_PACKAGE_PNPM goto missing_pnpm
for %%D in ("%MSH_PACKAGE_PNPM%") do set "PATH=%%~dpD;%PATH%"

echo Node: "%MSH_PACKAGE_NODE%"
echo pnpm: "%MSH_PACKAGE_PNPM%"
"%MSH_PACKAGE_NODE%" -e "if(Number(process.versions.node.split('.')[0])<24){console.error('Node.js 24 or newer is required.');process.exit(1)}"
if errorlevel 1 exit /b 2
call "%MSH_PACKAGE_PNPM%" --version
if errorlevel 1 exit /b 3

if /I "%~1"=="--check" goto check
if /I "%~1"=="--dir" goto directory
if not "%~1"=="" goto usage
echo Building Mingshen Harness 1.3.4 Windows installer...
call "%MSH_PACKAGE_PNPM%" package:win
if errorlevel 1 goto failed
echo Installer build completed. See the verified output path above.
exit /b 0

:directory
echo Building and checking the unpacked application without creating an installer...
call "%MSH_PACKAGE_PNPM%" --filter @mingshen/desktop run package:win --dir
if errorlevel 1 goto failed
exit /b 0

:check
echo Checking packaging prerequisites without building an installer...
call "%MSH_PACKAGE_PNPM%" package:check
exit /b %ERRORLEVEL%

:missing_node
echo Node.js was not found. Install Node.js 24 or newer.
exit /b 2

:missing_pnpm
echo pnpm was not found. Install pnpm 11 or newer, then rerun this script.
exit /b 3

:usage
echo Usage: package-win.cmd [--check^|--dir]
exit /b 4

:failed
echo Installer build failed. See the error above.
exit /b 1
