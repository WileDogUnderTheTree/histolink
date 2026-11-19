@echo off
setlocal
set "ROOT=%~dp0"
start "" "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\launch.ps1" %*
endlocal
exit /b 0
