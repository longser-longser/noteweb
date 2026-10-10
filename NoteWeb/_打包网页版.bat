@echo off
chcp 936 >nul
cd /d "%~dp0"
title 打包网页版（自动判断带不带音乐）
set "NODE=%~dp0..\..\运行环境\nodejs\node.exe"
set "NPM=%~dp0..\..\运行环境\nodejs\node_modules\npm\bin\npm-cli.js"
if not exist "%NODE%" set "NODE=node"

echo ============================================================
echo   打包"网页版"
echo   有 music-web 文件夹（14 首 MP3，约 52 MB）就一起装上，
echo   没有就打成不含音频的纯笔记版（约 2 MB）。
echo   本地听无损用「_打包网站.bat」（带 468 MB 的 FLAC）。
echo ============================================================
echo.

set NW_DIST=dist-网页版
if exist "music-web" (
  set NW_MUSIC_DIR=music-web
  echo   本次：带音乐（MP3）版
) else (
  set NW_NO_MUSIC=1
  echo   本次：纯笔记版（没找到 music-web 文件夹）
)

echo.
echo [1/2] 打包...
"%NODE%" "%NPM%" run build
if errorlevel 1 goto :fail

echo.
echo [2/2] 打成 zip...
powershell -NoProfile -Command "Compress-Archive -Path 'dist-网页版\*' -DestinationPath '_发布包_网页版.zip' -Force"
if errorlevel 1 goto :fail

echo.
echo ============================================================
echo   完成。要上传的东西（二选一）：
echo     dist-网页版\          整个文件夹
echo     _发布包_网页版.zip    同一个东西，压成了一个文件
echo.
echo   上传方法 A（最简单）：打开 https://app.netlify.com/drop
echo                        把上面任意一个拖进页面，等十几秒就出网址
echo   上传方法 B（自动更新）：双击 _更新到GitHub.bat，GitHub 会自己发布
echo ============================================================
if not "%NOTES_NO_BROWSER%"=="1" start "" explorer "%~dp0"
if not "%NOTES_NO_PAUSE%"=="1" pause
exit /b 0

:fail
echo.
echo 打包失败，把上面的红字发给我看看。
if not "%NOTES_NO_PAUSE%"=="1" pause
exit /b 1