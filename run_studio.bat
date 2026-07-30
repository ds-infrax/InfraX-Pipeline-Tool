@echo off
setlocal

cd /d "%~dp0"
if errorlevel 1 (
    echo [InfraX Studio] Failed to open the tool folder.
    pause
    exit /b 1
)

set "PYTHON_EXE="
if exist "%~dp0python_embeded\python.exe" (
    set "PYTHON_EXE=%~dp0python_embeded\python.exe"
) else if exist "%~dp0.venv\Scripts\python.exe" (
    set "PYTHON_EXE=%~dp0.venv\Scripts\python.exe"
) else (
    set "PYTHON_EXE=python"
)

"%PYTHON_EXE%" "%~dp0studio_bridge.py" %*
set "STUDIO_EXIT_CODE=%ERRORLEVEL%"

if not "%STUDIO_EXIT_CODE%"=="0" (
    echo.
    echo [InfraX Studio] The local Studio stopped with exit code %STUDIO_EXIT_CODE%.
    pause
)

exit /b %STUDIO_EXIT_CODE%
