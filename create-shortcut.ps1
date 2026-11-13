# 在桌面创建「API 用量灵动岛」快捷方式（可重复运行，会覆盖旧的）
$ErrorActionPreference = 'Stop'

$root   = Split-Path -Parent $MyInvocation.MyCommand.Path
$localElectron = Join-Path $root 'widget\node_modules\electron\dist\electron.exe'
if ($env:API88_ELECTRON -and (Test-Path $env:API88_ELECTRON)) {
    $exe = $env:API88_ELECTRON
} elseif (Test-Path $localElectron) {
    $exe = $localElectron
} elseif (Test-Path 'C:\Users\23572\.dsh\electron\electron.exe') {
    $exe = 'C:\Users\23572\.dsh\electron\electron.exe'
} else {
    throw '找不到 electron.exe：请在 widget 目录执行 npm install，或设置环境变量 API88_ELECTRON 指向它'
}
$widget = Join-Path $root 'widget'
$srcIcon = Join-Path $root 'widget\88api.ico'
$desktop = [Environment]::GetFolderPath('Desktop')
$lnk    = Join-Path $desktop 'API 用量灵动岛.lnk'

if (-not (Test-Path $exe))     { throw "找不到 Electron: $exe" }
if (-not (Test-Path $widget))  { throw "找不到挂件目录: $widget" }
if (-not (Test-Path $srcIcon)) { throw "找不到图标: $srcIcon" }

# 图标要放在工作区之外：桌面/资源管理器读不到工作区路径下的 .ico（沙箱 ACL），
# 直接引用会显示成空白文件图标。复制到 LocalAppData 再由快捷方式指向它。
$iconDir = Join-Path $env:LOCALAPPDATA '88api-widget'
New-Item -ItemType Directory -Force -Path $iconDir | Out-Null
$icon = Join-Path $iconDir 'icon.ico'
Copy-Item -LiteralPath $srcIcon -Destination $icon -Force

$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($lnk)
$sc.TargetPath       = $exe
$sc.Arguments        = '"' + $widget + '"'
$sc.WorkingDirectory = $root
$sc.IconLocation     = $icon + ',0'
$sc.Description      = 'API 用量灵动岛：余额、今日消费、模型排行'
$sc.WindowStyle      = 1
$sc.Save()

Write-Output "已创建: $lnk"
