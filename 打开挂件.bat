@echo off
chcp 65001 >nul
rem 打开 88API 用量桌面挂件（无控制台窗口）
set ELECTRON=C:\Users\23572\.dsh\electron\electron.exe
start "" "%ELECTRON%" "%~dp0widget"
