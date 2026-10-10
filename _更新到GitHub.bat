@echo off
chcp 936 >nul
cd /d "%~dp0"
title 更新网站到 GitHub（改完之后双击这个）
set "GIT=D:\Git\cmd\git.exe"
if not exist "%GIT%" set "GIT=git"
set "GITC=%GIT% -c core.quotepath=false"

echo ============================================================
echo   把改动更新到 GitHub
echo   双击一下就行：它会自己提交、推送，GitHub 收到后 1~2 分钟自动重新发布
echo ============================================================
echo.

%GITC% remote get-url origin > "%TEMP%\nw_origin.txt" 2>nul
set "URL="
set /p URL=<"%TEMP%\nw_origin.txt"
del "%TEMP%\nw_origin.txt" 2>nul

if "%URL%"=="" (
  echo [提示] 这个仓库还没连到 GitHub。
  echo        第一次发布请双击「_一键发布到GitHub.bat」，之后再回来用本文件。
  echo.
  if not "%NOTES_NO_PAUSE%"=="1" pause
  exit /b 1
)
echo 远端仓库：%URL%
echo.

echo --- 这次有哪些改动 ---
%GITC% status --short
echo.

%GITC% add -A
%GITC% diff --cached --quiet
if not errorlevel 1 (
  echo [结果] 没有任何改动，不需要更新。网站保持原样。
  echo.
  if not "%NOTES_NO_PAUSE%"=="1" pause
  exit /b 0
)

echo 说明：音乐里的无损原件（NoteWeb\music\）不会上传，只在本地听；
echo       想让线上也有新歌，把 MP3 放进 NoteWeb\music-web\ 再双击本文件。
echo.

set "MSG=%NOTES_MSG%"
if "%MSG%"=="" set /p "MSG=这次改了什么（直接回车＝更新笔记）: "
if "%MSG%"=="" set "MSG=更新笔记"

%GITC% commit -m "%MSG%"
if errorlevel 1 goto :fail

echo.
echo 正在推送到 GitHub...
%GITC% push origin main
if errorlevel 1 goto :push_fail

echo.
echo ============================================================
echo   推送成功！
echo   接下来 GitHub 会自己打包发布（约 1~2 分钟），然后刷新网址即可：
echo.
powershell -NoProfile -Command "$u='%URL%' -replace '\.git$',''; $p=$u -split '/'; Write-Host ('     网址      https://{0}.github.io/{1}/' -f $p[-2],$p[-1]); Write-Host ('     看进度    {0}/actions' -f $u)"
echo.
echo   打开上面的「看进度」，等最新那条变成绿色对勾就成了。
echo ============================================================
if not "%NOTES_NO_BROWSER%"=="1" start "" "%URL%/actions"
if not "%NOTES_NO_PAUSE%"=="1" pause
exit /b 0

:push_fail
echo.
echo ============================================================
echo   推送失败
echo ============================================================
echo   常见原因：
echo     1. 网络不通 / 需要登录：重新双击一次，按提示在浏览器里登录 GitHub
echo     2. 仓库被改过名或被删了：确认地址 %URL% 还能打开
echo ============================================================
if not "%NOTES_NO_PAUSE%"=="1" pause
exit /b 1

:fail
echo.
echo 提交失败，把上面的红字发给我看看。
if not "%NOTES_NO_PAUSE%"=="1" pause
exit /b 1