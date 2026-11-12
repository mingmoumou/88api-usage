# 把挂件加入当前用户的「启动」文件夹：登录 Windows 后自动出现
# 可重复运行；图标会先复制到 LocalAppData（工作区里的 .ico 资源管理器读不到）
$ErrorActionPreference = 'Stop'

$root   = Split-Path -Parent $MyInvocation.MyCommand.Path
$widget = Join-Path $root 'widget'
$srcIcon = Join-Path $root 'widget\88api.ico'

if ($env:API88_ELECTRON -and (Test-Path $env:API88_ELECTRON)) {
    $exe = $env:API88_ELECTRON
} elseif (Test-Path 'C:\Users\23572\.dsh\electron\electron.exe') {
    $exe = 'C:\Users\23572\.dsh\electron\electron.exe'
} else {
    throw '找不到 electron.exe，请设置环境变量 API88_ELECTRON 指向它'
}

if (-not (Test-Path $widget))   { throw "找不到挂件目录: $widget" }
if (-not (Test-Path $srcIcon))  { throw "找不到图标: $srcIcon" }

$iconDir = Join-Path $env:LOCALAPPDATA '88api-widget'
New-Item -ItemType Directory -Force -Path $iconDir | Out-Null
$icon = Join-Path $iconDir 'icon.ico'
Copy-Item -LiteralPath $srcIcon -Destination $icon -Force

$lnk = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\88API-usage-widget.lnk'
$sc = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$sc.TargetPath       = $exe
$sc.Arguments        = '"' + $widget + '"'
$sc.WorkingDirectory = $root
$sc.IconLocation     = $icon + ',0'
$sc.Description      = '88API 用量桌面挂件'
$sc.Save()

Write-Output "已设置开机自启: $lnk"
