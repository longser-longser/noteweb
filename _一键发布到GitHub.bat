@echo off
chcp 936 >nul
cd /d "%~dp0"
title 把笔记发布到 GitHub Pages
set "GIT=D:\Git\cmd\git.exe"
if not exist "%GIT%" set "GIT=git"

echo ============================================================
echo   把课堂笔记发布到 GitHub Pages
echo ============================================================
echo.
echo 发布前请先确认：你已经在 GitHub 上建好了一个空仓库
echo   打开 https://github.com/new
echo   名字填 my-notes，选 Public，不要勾 Add a README file，点 Create repository
echo.
echo 下面会问你三个问题，按提示输入就行。
echo.
pause

echo.
echo --- 当前有哪些改动 ---
"%GIT%" status --short
echo.

set "UN=%NOTES_USER%"
if "%UN%"=="" set /p "UN=1) 你的 GitHub 用户名（英文）: "
if "%UN%"=="" goto :no_user

set "REPO=%NOTES_REPO%"
if "%REPO%"=="" set /p "REPO=2) 仓库名（直接回车就是 my-notes）: "
if "%REPO%"=="" set "REPO=my-notes"

set "MSG=%NOTES_MSG%"
if "%MSG%"=="" set /p "MSG=3) 这次改了什么（直接回车就是：更新笔记）: "
if "%MSG%"=="" set "MSG=更新笔记"

set "URL=https://github.com/%UN%/%REPO%.git"
set "WEB=https://github.com/%UN%/%REPO%"
if not "%NOTES_REMOTE%"=="" set "URL=%NOTES_REMOTE%"

echo.
echo 准备发布到: %URL%
echo.

"%GIT%" remote remove origin 1>nul 2>nul
"%GIT%" remote add origin "%URL%"
"%GIT%" add -A
"%GIT%" commit -m "%MSG%"
if errorlevel 1 echo （这次没有新改动，直接推送已有内容）
echo.
echo 正在推送，第一次会弹出浏览器让你登录 GitHub...
"%GIT%" push -u origin main
if errorlevel 1 goto :push_fail

echo.
echo ============================================================
echo   推送成功！
echo ============================================================
echo.
echo 还差最后一步，只做一次：
echo   打开 %WEB%/settings/pages
echo   把 Build and deployment 下面的 Source 改成 GitHub Actions
echo   等 1 到 2 分钟，你的网址就是：
echo   https://%UN%.github.io/%REPO%/
echo.
if not "%NOTES_NO_BROWSER%"=="1" start "" "%WEB%/settings/pages"
pause
exit /b 0

:push_fail
echo.
echo ============================================================
echo   推送失败
echo ============================================================
echo   常见原因：
echo     1. 仓库还没建：先打开 https://github.com/new 建一个空的
echo     2. 用户名或仓库名拼错了
echo     3. 浏览器登录窗口被关掉了，重新双击本文件再来一次
echo.
if not "%NOTES_NO_BROWSER%"=="1" start "" "https://github.com/new"
pause
exit /b 1

:no_user
echo.
echo 没输入用户名，已取消。
pause
exit /b 1