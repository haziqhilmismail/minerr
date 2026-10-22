@echo off
rem Starts the WhisperX server on Windows. It needs no admin rights and changes no setting of Windows.
title Minerr WhisperX server
setlocal
set "MINERR=%LOCALAPPDATA%\Minerr"
rem The uv release that Minerr downloads, and the SHA-256 of its zip from the .sha256 file of the release.
set "PINNED_UV=0.13.5"
set "PINNED_UV_SHA256=a38b8d1902b7cfbc76b423ba1bb456f623f42064cdc72628b6075b89afd1019a"
if /i not "%PROCESSOR_ARCHITECTURE%"=="AMD64" if /i not "%PROCESSOR_ARCHITEW6432%"=="AMD64" goto not_x64
set "UV=uv"
where uv >nul 2>nul && goto start
set "UV=%MINERR%\uv\uv.exe"
if exist "%UV%" goto start
echo Minerr needs uv, a free program of Astral (https://docs.astral.sh/uv/), to install the WhisperX server.
echo Minerr downloads uv %PINNED_UV% (15 MB) from GitHub to %MINERR%\uv. It changes no setting of Windows.
echo Then uv installs Python and the packages of the server, about 3.7 GB. The first job downloads the model, about 1.6 GB.
choice /c YN /m "Download uv now"
if errorlevel 2 goto declined
set "ZIP=%TEMP%\minerr-uv-%PINNED_UV%.zip"
curl.exe -fL --retry 2 -o "%ZIP%" https://github.com/astral-sh/uv/releases/download/%PINNED_UV%/uv-x86_64-pc-windows-msvc.zip || goto download_failed
certutil -hashfile "%ZIP%" SHA256 | find /i "%PINNED_UV_SHA256%" >nul || goto wrong_file
mkdir "%MINERR%\uv" 2>nul
tar.exe -xf "%ZIP%" -C "%MINERR%\uv" || goto download_failed
del "%ZIP%"

:start
set "PYTHONPYCACHEPREFIX=%MINERR%\pycache"
cd /d "%~dp0server"
"%UV%" run --no-project --python 3.12 chrome_start.py
rem The first start installs the packages of the server. Each start updates the yt-dlp package, because YouTube often breaks
rem old versions of yt-dlp. The server uses that package when the PATH has no yt-dlp.
"%UV%" sync --script whisper_server.py --upgrade-package yt-dlp || echo Minerr could not install or update the packages of the server, for example because the computer is offline.
"%UV%" run whisper_server.py
echo The WhisperX server in this window stopped.
pause
exit /b

:not_x64
echo This file needs Windows on an x64 processor. WhisperX cannot run on Windows on ARM itself, because ctranslate2 has no package for it.
echo On Windows on ARM, run the server in WSL with the Linux steps of the README.
pause
exit /b 1

:declined
echo Minerr downloaded nothing. To install the server later, start this file again.
pause
exit /b 1

:download_failed
del "%ZIP%" 2>nul
echo Minerr could not download or unpack uv. Check the internet connection, then start this file again.
pause
exit /b 1

:wrong_file
del "%ZIP%"
echo The downloaded file is not uv %PINNED_UV%, because its SHA-256 is wrong. Minerr deleted it. Start this file again later.
pause
exit /b 1
