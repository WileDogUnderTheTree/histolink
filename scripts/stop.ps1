#Requires -Version 5.1
<#
  史脉 · 停止脚本
  ---------------------------------------------------------------------------
  结束本项目的 FastAPI(8000) 与 Next.js(3000) 服务。
  只会结束“看起来属于史脉”的进程（可执行文件位于项目内、命令行包含项目路径、
  uvicorn main:app 或 next dev -p 3000），避免误杀其他程序。

  同时会写入 .run\stopping.flag 通知仍开着的启动器窗口：这是用户主动停止，
  启动器会安静退出，而不是报错并等待回车。

  参数：
    -Force   不校验进程归属，直接结束占用 3000 / 8000 端口的进程
#>
[CmdletBinding()]
param(
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

$Root         = Split-Path -Parent $PSScriptRoot
$RunDir       = Join-Path $Root '.run'
$StoppingFlag = Join-Path $RunDir 'stopping.flag'
$BackendPort  = 8000
$FrontendPort = 3000

try { & "$env:SystemRoot\System32\chcp.com" 65001 2>&1 | Out-Null } catch { }
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }
try { $Host.UI.RawUI.WindowTitle = '史脉 · 停止' } catch { }

function Write-Step([string]$Text) { Write-Host ('  >  ' + $Text) -ForegroundColor Cyan }
function Write-Ok([string]$Text)   { Write-Host ('  OK ' + $Text) -ForegroundColor Green }
function Write-Warn([string]$Text) { Write-Host ('  !  ' + $Text) -ForegroundColor Yellow }
function Write-Dim([string]$Text)  { Write-Host ('     ' + $Text) -ForegroundColor DarkGray }

function Get-PortOwnerPid([int]$Port) {
    try {
        $conn = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop |
            Select-Object -First 1
        if ($conn) { return [int]$conn.OwningProcess }
    }
    catch { }
    try {
        $lines = & netstat.exe -ano -p tcp 2>$null
        foreach ($line in $lines) {
            if ($line -match ('^\s*TCP\s+\S+:' + $Port + '\s+\S+\s+LISTENING\s+(\d+)\s*$')) {
                return [int]$Matches[1]
            }
        }
    }
    catch { }
    return 0
}

function Get-ProcessInfoSafe([int]$OwnerPid) {
    $info = [pscustomobject]@{
        Exists         = $false
        Name           = '未知进程'
        ExecutablePath = ''
        CommandLine    = ''
    }
    $process = Get-Process -Id $OwnerPid -ErrorAction SilentlyContinue
    if (-not $process) { return $info }
    $info.Exists = $true
    $info.Name = $process.ProcessName
    try { $info.ExecutablePath = [string]$process.Path } catch { }
    try {
        $cim = Get-CimInstance Win32_Process -Filter ("ProcessId = " + $OwnerPid) -ErrorAction Stop
        if ($cim) {
            $info.CommandLine = [string]$cim.CommandLine
            if (-not $info.ExecutablePath) { $info.ExecutablePath = [string]$cim.ExecutablePath }
        }
    }
    catch { }
    return $info
}

function Test-IsShiMai($Info, [int]$Port) {
    if ($Info.ExecutablePath -and $Info.ExecutablePath.IndexOf($Root, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true }
    $commandLine = [string]$Info.CommandLine
    if ([string]::IsNullOrWhiteSpace($commandLine)) { return $false }
    if ($commandLine.IndexOf($Root, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true }
    if ($commandLine -match 'uvicorn\s+main:app') { return $true }
    if (($commandLine -match '\bnext(\.js)?\b') -and ($commandLine -match ('(-p|--port)\s*' + $Port))) { return $true }
    return $false
}

function Stop-ProcessTree([int]$OwnerPid) {
    try { & taskkill.exe /PID $OwnerPid /T /F 2>&1 | Out-Null } catch { }
}

function Wait-PortFree([int]$Port, [int]$TimeoutSeconds) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if ((Get-PortOwnerPid $Port) -eq 0) { return $true }
        Start-Sleep -Milliseconds 200
    }
    return ((Get-PortOwnerPid $Port) -eq 0)
}

Write-Host ''
Write-Host '  史脉 · 停止服务' -ForegroundColor White
Write-Host '  ---------------------------------------------------' -ForegroundColor DarkGray

# 通知可能仍开着的启动器窗口：这是用户主动停止
try {
    if (-not (Test-Path -LiteralPath $RunDir)) {
        New-Item -ItemType Directory -Path $RunDir -Force | Out-Null
    }
    Set-Content -LiteralPath $StoppingFlag -Value ('stop ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')) -Encoding ASCII
}
catch { }

$stopped = 0
try {
    # 第一遍：先把两个端口的占用信息读全（杀掉其中一个后，另一个可能马上被
    # 启动器回收，届时再读命令行就会失败）。
    $plans = @()
    $ports = @(
        [pscustomobject]@{ Name = '前端'; Port = $FrontendPort },
        [pscustomobject]@{ Name = '后端'; Port = $BackendPort }
    )
    foreach ($entry in $ports) {
        $ownerPid = Get-PortOwnerPid $entry.Port
        $info = $null
        if ($ownerPid -gt 0) { $info = Get-ProcessInfoSafe $ownerPid }
        $plans += [pscustomobject]@{
            Name     = $entry.Name
            Port     = $entry.Port
            OwnerPid = $ownerPid
            Info     = $info
        }
    }

    # 第二遍：执行停止
    foreach ($plan in $plans) {
        $name = [string]$plan.Name
        $port = [int]$plan.Port
        $ownerPid = [int]$plan.OwnerPid

        if ($ownerPid -le 0) {
            Write-Dim ($name + '：端口 ' + $port + ' 未在监听（未运行）')
            continue
        }

        if (-not $plan.Info -or -not $plan.Info.Exists) {
            if (Wait-PortFree $port 3) {
                Write-Ok ($name + '已停止（端口 ' + $port + ' 已释放）')
                $stopped++
            }
            else {
                Write-Warn ($name + '：端口 ' + $port + ' 仍被 PID ' + $ownerPid + ' 占用，请手动处理')
            }
            continue
        }

        $isShiMai = $Force -or (Test-IsShiMai $plan.Info $port)
        if (-not $isShiMai) {
            Write-Warn ($name + '：端口 ' + $port + ' 被其他程序占用（' + $plan.Info.Name + '，PID ' + $ownerPid + '），已跳过')
            continue
        }

        Write-Step ('正在停止' + $name + '（' + $plan.Info.Name + '，PID ' + $ownerPid + '）…')
        Stop-ProcessTree $ownerPid
        if (Wait-PortFree $port 5) {
            Write-Ok ($name + '已停止（端口 ' + $port + ' 已释放）')
            $stopped++
        }
        else {
            Write-Warn ($name + '：端口 ' + $port + ' 仍被占用，请手动结束进程 PID ' + $ownerPid)
        }
    }
}
finally {
    Remove-Item -LiteralPath $StoppingFlag -Force -ErrorAction SilentlyContinue
}

Write-Host ''
if ($stopped -gt 0) {
    Write-Ok ('已停止 ' + $stopped + ' 个服务。')
}
else {
    Write-Dim '没有需要停止的史脉服务。'
}
exit 0
