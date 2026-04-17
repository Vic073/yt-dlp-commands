@echo off
title Mbembembe Downloader
color 0A

:: ====== USER INPUT ======
set /p url="Paste Video or Playlist URL: "

echo.
echo Select Quality:
echo 1. 360p (Ultra Save Data)
echo 2. 480p (Recommended)
echo 3. 720p (Higher Quality)
set /p choice="Enter choice (1-3): "

if "%choice%"=="1" set quality=360
if "%choice%"=="2" set quality=480
if "%choice%"=="3" set quality=720

if not defined quality (
    echo Invalid choice. Defaulting to 480p.
    set quality=480
)

echo.
set /p shutdownChoice="Shutdown after download? (y/n): "

:: ===== WAIT FOR MBEMBEMBE HOURS =====
echo Waiting for Mbembembe hours (23:00 - 05:00)...

:loop
for /f "tokens=1 delims=:" %%A in ("%time%") do set hour=%%A
set hour=%hour: =%

if %hour% GEQ 23 goto start
if %hour% LEQ 5 goto start

timeout /t 60 >nul
goto loop

:start
echo.
echo 🚀 Mbembembe time! Starting download...
echo Logging to download_log.txt

:: ===== DOWNLOAD =====
yt-dlp ^
-f "bestvideo[height<=%quality%]+bestaudio/best[height<=%quality%]" ^
--yes-playlist ^
--continue ^
--no-part ^
--retries 99 ^
--fragment-retries 99 ^
--write-subs ^
--write-auto-subs ^
--sub-langs "en.*" ^
--embed-subs ^
--merge-output-format mkv ^
--no-mtime ^
-o "%%(playlist_title,Unknown)s/%%(playlist_index,1)s - %%(title)s.%%(ext)s" ^
%url% >> download_log.txt 2>&1

echo.
echo ✅ Download finished!

:: ===== OPTIONAL SHUTDOWN =====
if /i "%shutdownChoice%"=="y" (
    echo Shutting down in 60 seconds...
    shutdown /s /t 60
)

pause