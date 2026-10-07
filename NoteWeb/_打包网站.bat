@echo off
chcp 936 >nul
cd /d "%~dp0"
title 打包笔记网站（生成可上传的 dist 静态包）
set "NODE=%~dp0..\..\运行环境\nodejs\node.exe"
set "NPM=%~dp0..\..\运行环境\nodejs\node_modules\npm\bin\npm-cli.js"
if not exist "%NODE%" set "NODE=node"

echo ============================================================
echo   打包笔记网站
echo   步骤: 同步最新笔记 -> 预渲染成静态网页 -> 自检
echo ============================================================
echo.
echo [1/3] 同步笔记（从 ..\已总结稿.md 读入）...
"%NODE%" "%NPM%" run sync
echo.
echo [2/3] 打包成静态网站...
"%NODE%" "%NPM%" run build
echo.
echo [3/3] 自检...
"%NODE%" "%NPM%" run check
echo.
echo 打包完成。dist 文件夹就是可以上传的静态网站（见「部署到网上.md」）。
start "" explorer "%~dp0dist"
pause