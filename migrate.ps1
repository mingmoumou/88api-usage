# 把工程复制到一个新位置，并在新位置重建桌面图标与开机自启
# 用法：  powershell -File migrate.ps1 -Dest "D:\projects\88api-usage"
#         加 -NoShortcuts 只复制、不动快捷方式（自测用）
param(
    [Parameter(Mandatory = $true)][string]$Dest,
    [switch]$NoShortcuts
)

$ErrorActionPreference = 'Stop'

$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$Dest = [System.IO.Path]::GetFullPath($Dest)

if ($Dest.TrimEnd('\') -ieq $src.TrimEnd('\')) { throw '目标就是当前目录，换个位置' }
if (Test-Path $Dest) {
    if (-not (Test-Path (Join-Path $Dest 'sync.mjs'))) {
        throw "目标目录已存在且不是本工程：$Dest"
    }
    Write-Output "目标已存在，将覆盖同名文件：$Dest"
} else {
    New-Item -ItemType Directory -Force -Path $Dest | Out-Null
}

# 复制整棵树（纯 PowerShell，不依赖 robocopy）
Copy-Item -Path (Join-Path $src '*') -Destination $Dest -Recurse -Force
Write-Output "已复制到: $Dest"

if ($NoShortcuts) { Write-Output '（-NoShortcuts：跳过快捷方式）'; return }

Write-Output '重建桌面图标…'
& (Join-Path $Dest 'create-shortcut.ps1')
Write-Output '重建开机自启…'
& (Join-Path $Dest 'install-autostart.ps1')

Write-Output ''
Write-Output '完成。接下来：'
Write-Output '  1) 旧位置的挂件右键「退出」，别让两份同时跑（会写不同的 data/logs.jsonl）'
Write-Output ('  2) 双击 ' + (Join-Path $Dest '打开挂件.bat') + ' 启动新位置')
Write-Output '  3) 旧目录确认没用后再删'
