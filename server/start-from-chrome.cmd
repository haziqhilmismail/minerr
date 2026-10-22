@echo off
rem cmd /c closes the window when the launcher ends; start alone would run a batch file with cmd /K and leave a prompt.
start "" /D "%~dp0.." cmd /c "Start WhisperX server.cmd"
