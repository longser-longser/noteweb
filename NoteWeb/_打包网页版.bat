@echo off
chcp 936 >nul
cd /d "%~dp0"
title 打包"轻量版"网页（不含音频，专门用来传 Netlify）
set "NODE=%~dp0..\..\运行环境\nodejs\node.exe"
set "NPM=%~dp0..\..\运行环境\nodejs\node_modules\npm\bin\npm-cli.js"
if not exist "%NODE%" set "NODE=node"

echo ============================================================
echo   打包"轻量版"网页
echo   只装网页本身（约 2 MB），不装 468 MB 的音乐，所以能传上 Netlify
echo   本地带音乐的完整版，请用「_打包网站.bat」
echo ============================================================
echo.

set NW_NO_MUSIC=1
set NW_DIST=dist-网页版

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
echo   上传方法：打开 https://app.netlify.com/drop
echo             把上面任意一个拖进页面，等十几秒就出网址
echo ============================================================
start "" explorer "%~dp0"
pause
exit /b 0

:fail
echo.
echo 打包失败，把上面的红字发给我看看。
pause
exit /b 1