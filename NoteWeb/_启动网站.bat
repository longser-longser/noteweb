@echo off
chcp 936 >nul
cd /d "%~dp0"
title 课堂笔记网站 - 本地预览（关掉本窗口即停止）
set "NODE=%~dp0..\..\运行环境\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"
echo ============================================================
echo   课堂笔记网站 · 本地预览
echo   浏览器打开: http://localhost:5173
echo   关掉本窗口即可停止服务（不影响已发布的网站）
echo ============================================================
echo.
"%NODE%" scripts\serve.mjs
echo.
echo 服务已退出。
pause