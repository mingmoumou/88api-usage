@echo off
chcp 65001 >nul
title 88API 用量挂件
rem 直接在本窗口运行，出错时能看到报错；关闭窗口即退出挂件
cd /d "%~dp0"
"C:\Users\23572\.dsh\electron\electron.exe" "%~dp0widget"
echo.
echo --- 挂件已退出，退出码 %errorlevel% ---
if exist "%~dp0widget\debug.log" (
  echo --- 最近日志 ---
  powershell -NoProfile -Command "Get-Content '%~dp0widget\debug.log' -Tail 20"
)
pause
