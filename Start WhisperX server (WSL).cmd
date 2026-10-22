@echo off
rem bash -l reads ~/.profile, which adds ~/.local/bin (uv) to the PATH.
rem WSLENV passes LOCALAPPDATA to WSL as a Linux path.
title Minerr WhisperX server
set WSLENV=LOCALAPPDATA/p:%WSLENV%
wsl.exe --cd "%~dp0server" -e bash -lc "command -v uv >/dev/null || { echo 'Minerr cannot find uv in WSL. Install uv from https://docs.astral.sh/uv/, then start this file again.'; exit 1; }; python3 chrome_start.py; PYTHONPYCACHEPREFIX=$HOME/.cache/minerr/pycache exec uv run whisper_server.py"
echo The WhisperX server in this window stopped.
pause
