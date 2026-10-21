@echo off
rem The Chrome native messaging host com.minerr.whisperx: the Start button of the Minerr popup runs this file
rem (server/chrome_start.py registers it). It opens the launcher in a window of its own, as a double-click does, and exits.
rem Chrome then reports to the popup that the host exited, and the popup waits for the server.
start "" "%~dp0..\Start WhisperX server.cmd"
