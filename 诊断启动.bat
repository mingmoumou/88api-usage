@echo off
chcp 65001 >nul
title 88API 用量挂件
rem 直接在本窗口运行，出错时能看到报错；关闭窗口即退出挂件
cd /d "%~dp0"
set "ELECTRON=%API88_ELECTRON%"
if not defined ELECTRON if exist "%~dp0widget\node_modules\electron\dist\electron.exe" set "ELECTRON=%~dp0widget\node_modules\electron\dist\electron.exe"
if not defined ELECTRON if exist "C:\Users\23572\.dsh\electron\electron.exe" set "ELECTRON=C:\Users\23572\.dsh\electron\electron.exe"
if not defined ELECTRON (
  echo [错误] 找不到 Electron。请在 widget 目录执行 npm install，或设置 API88_ELECTRON。
  pause
  exit /b 1
)
"%ELECTRON%" "%~dp0widget"
echo.
echo --- 挂件已退出，退出码 %errorlevel% ---
if exist "%~dp0widget\debug.log" (
  echo --- 最近日志 ---
  powershell -NoProfile -Command "Get-Content '%~dp0widget\debug.log' -Tail 20"
)
pause
