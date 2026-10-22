@echo off
rem cmd /c closes the window when the launcher ends; start alone would run a batch file with cmd /K and leave a prompt.
rem cmd /c removes the outer quotes of a name with parentheses, so the name has two pairs.
start "" /D "%~dp0.." cmd /c ""Start WhisperX server (WSL).cmd""
