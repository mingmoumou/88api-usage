@echo off
chcp 65001 >nul
rem 打开 API 用量灵动岛（无控制台窗口）
rem 依次查找 Electron：环境变量 API88_ELECTRON → 项目内 npm 安装 → 本机默认路径
set "ELECTRON=%API88_ELECTRON%"
if not defined ELECTRON if exist "%~dp0widget\node_modules\electron\dist\electron.exe" set "ELECTRON=%~dp0widget\node_modules\electron\dist\electron.exe"
if not defined ELECTRON if exist "C:\Users\23572\.dsh\electron\electron.exe" set "ELECTRON=C:\Users\23572\.dsh\electron\electron.exe"
if not defined ELECTRON (
  echo [错误] 找不到 Electron。
  echo   方法1：在 widget 目录执行 npm install 安装 Electron；
  echo   方法2：设置环境变量 API88_ELECTRON 指向 electron.exe 的完整路径。
  pause
  exit /b 1
)
start "" "%ELECTRON%" "%~dp0widget"
