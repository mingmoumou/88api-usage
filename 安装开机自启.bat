@echo off
chcp 65001 >nul
rem 把挂件加入当前用户的「启动」文件夹：登录 Windows 后自动出现
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-autostart.ps1"
echo.
if errorlevel 1 (echo 安装失败，看上面的报错) else (echo 下次登录会自动出现挂件)
pause
