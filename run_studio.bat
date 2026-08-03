@echo off
setlocal

cd /d "%~dp0"
if errorlevel 1 (
    echo [InfraX Studio] Failed to open the tool folder.
    pause
    exit /b 1
)

set "PYTHON_EXE="
if exist "%~dp0python-3.10.0-embed-amd64\python.exe" (
    set "PYTHON_EXE=%~dp0python-3.10.0-embed-amd64\python.exe"
) else (
    echo [InfraX Studio] Missing embedded Python: %~dp0python-3.10.0-embed-amd64\python.exe
    pause
    exit /b 1
)

"%PYTHON_EXE%" "%~dp0studio_bridge.py" %*
set "STUDIO_EXIT_CODE=%ERRORLEVEL%"

if not "%STUDIO_EXIT_CODE%"=="0" (
    echo.
    echo [InfraX Studio] The local Studio stopped with exit code %STUDIO_EXIT_CODE%.
    pause
)

exit /b %STUDIO_EXIT_CODE%
