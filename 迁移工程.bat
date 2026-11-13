@echo off
chcp 65001 >nul
setlocal
set "SRC=%~dp0"
if "%~1"=="" (
  echo 把 API 用量灵动岛工程复制到新位置，并在新位置重建桌面图标和开机自启。
  echo 直接回车 = 使用 D:\projects\88api-usage
  set /p "DEST=新位置: "
) else (
  set "DEST=%~1"
)
if "%DEST%"=="" set "DEST=D:\projects\88api-usage"
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%SRC%migrate.ps1" -Dest "%DEST%"
echo.
pause
