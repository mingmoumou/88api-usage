@echo off
chcp 65001 >nul
rem 取消开机自启
set "LNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\API-usage-widget.lnk"
set "OLD=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\88API-usage-widget.lnk"
if exist "%OLD%" (del "%OLD%" && echo 已清理旧版自启项)
if exist "%LNK%" (del "%LNK%" && echo 已取消开机自启) else (echo 当前没有开机自启项)
pause
