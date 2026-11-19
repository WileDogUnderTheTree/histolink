#Requires -Version 5.1
<#
  史脉 · 一键启动器
  ---------------------------------------------------------------------------
  双击 启动史脉.cmd 即可：自动检查环境 → 启动 FastAPI(8000) + Next.js(3000)
  → 等服务就绪 → 打开浏览器 → 在当前窗口实时显示前后端日志。

  参数：
    -NoBrowser   不自动打开浏览器
    -Restart     端口被占用时直接结束占用进程（不询问）
    -NoPause     出错时不等待回车（供脚本/自动化调用）

  说明：
    - Node / pnpm 优先使用 PATH，找不到时自动回退到 DSH 内置运行时；
    - 前后端日志同时写入 .run\*.log；
    - 按 Ctrl+C 或直接关闭本窗口即可停止本次启动的前端与后端。
#>
[CmdletBinding()]
param(
    [switch]$NoBrowser,
    [switch]$NoPause,
    [switch]$Restart
)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# 基础配置
# ---------------------------------------------------------------------------
$script:Root          = Split-Path -Parent $PSScriptRoot
$script:BackendDir    = Join-Path $script:Root 'backend'
$script:FrontendDir   = Join-Path $script:Root 'frontend'
$script:RunDir        = Join-Path $script:Root '.run'
$script:BackendPort   = 8000
$script:FrontendPort  = 3000
$script:HealthUrl     = 'http://127.0.0.1:8000/api/health'
$script:FrontendUrl   = 'http://localhost:3000'
$script:FrontendProbe = 'http://127.0.0.1:3000/'
$script:PageMarker    = '中国历史探索'
$script:StoppingFlag  = Join-Path (Join-Path $script:Root '.run') 'stopping.flag'

$script:NoBrowserFlag = [bool]$NoBrowser
$script:RestartFlag   = [bool]$Restart
$script:PauseOnError  = (-not $NoPause) -and (-not [Console]::IsInputRedirected)

$script:Children = @()
$script:Tailers  = @()
$script:ExitCode = 0

# ---------------------------------------------------------------------------
# 控制台输出
# ---------------------------------------------------------------------------
function Initialize-Console {
    # 让中文在控制台中正常显示（本机默认代码页为 936）
    try { & "$env:SystemRoot\System32\chcp.com" 65001 2>&1 | Out-Null } catch { }
    try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }
    try { $Host.UI.RawUI.WindowTitle = '史脉 · 启动器' } catch { }
}

function Write-Header {
    Write-Host ''
    Write-Host '  史脉 · 启动器' -ForegroundColor White
    Write-Host '  ---------------------------------------------------' -ForegroundColor DarkGray
}

function Write-Step([string]$Text) { Write-Host ('  >  ' + $Text) -ForegroundColor Cyan }
function Write-Ok([string]$Text)   { Write-Host ('  OK ' + $Text) -ForegroundColor Green }
function Write-Warn([string]$Text) { Write-Host ('  !  ' + $Text) -ForegroundColor Yellow }
function Write-Fail([string]$Text) { Write-Host ('  X  ' + $Text) -ForegroundColor Red }
function Write-Dim([string]$Text)  { Write-Host ('     ' + $Text) -ForegroundColor DarkGray }
function Write-Info([string]$Text) { Write-Host ('     ' + $Text) }

# ---------------------------------------------------------------------------
# 通用小工具
# ---------------------------------------------------------------------------
function Confirm-Yes([string]$Question) {
    if ([Console]::IsInputRedirected) { return $false }
    $answer = Read-Host ('     ' + $Question + ' [y/N]')
    return ($answer -match '^([yY]|yes|YES|是|好)$')
}

function Quote-Args([string[]]$ArgumentList) {
    $result = @()
    foreach ($arg in $ArgumentList) {
        if ($null -eq $arg) { continue }
        if ($arg -match '\s' -and -not $arg.StartsWith('"')) {
            $result += ('"' + $arg + '"')
        }
        else {
            $result += $arg
        }
    }
    return $result
}

function Get-DshHomes {
    $homes = @()
    if ($env:DSH_HOME) { $homes += $env:DSH_HOME }
    if ($env:USERPROFILE) { $homes += (Join-Path $env:USERPROFILE '.dsh') }
    return ($homes | Select-Object -Unique)
}

# ---------------------------------------------------------------------------
# 查找运行时
# ---------------------------------------------------------------------------
function Resolve-Node {
    $cmd = Get-Command node -ErrorAction SilentlyContinue |
        Where-Object { $_.Source -and $_.Source -like '*.exe' } |
        Select-Object -First 1
    if ($cmd) {
        return [pscustomobject]@{ Exe = $cmd.Source; Dir = (Split-Path $cmd.Source -Parent) }
    }

    foreach ($dshHome in (Get-DshHomes)) {
        if (-not $dshHome) { continue }
        $runtimes = Join-Path $dshHome 'dsh-runtimes'
        if (-not (Test-Path -LiteralPath $runtimes)) { continue }
        $dirs = Get-ChildItem -LiteralPath $runtimes -Directory -ErrorAction SilentlyContinue |
            Sort-Object Name
        foreach ($dir in $dirs) {
            $exe = Join-Path $dir.FullName 'dependencies\node\bin\node.exe'
            if (Test-Path -LiteralPath $exe) {
                return [pscustomobject]@{ Exe = $exe; Dir = (Split-Path $exe -Parent) }
            }
        }
    }

    $common = @(
        'C:\Program Files\nodejs\node.exe',
        (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe'),
        'C:\Program Files (x86)\nodejs\node.exe'
    )
    foreach ($exe in $common) {
        if ($exe -and (Test-Path -LiteralPath $exe)) {
            return [pscustomobject]@{ Exe = $exe; Dir = (Split-Path $exe -Parent) }
        }
    }
    return $null
}

function Resolve-SystemPython {
    $cmd = Get-Command python -ErrorAction SilentlyContinue | Where-Object { $_.Source } | Select-Object -First 1
    if ($cmd) { return $cmd.Source }
    $common = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python311\python.exe'),
        'C:\Python312\python.exe',
        'C:\Python311\python.exe'
    )
    foreach ($exe in $common) {
        if ($exe -and (Test-Path -LiteralPath $exe)) { return $exe }
    }
    return $null
}

function Resolve-Pnpm([string]$NodeExe, [string]$NodeDir) {
    # 1) DSH 内置运行时：<dsh>\dsh-runtimes\<runtime>\dependencies\pnpm\bin\pnpm.mjs
    if ($NodeDir) {
        $deps = Split-Path (Split-Path $NodeDir -Parent) -Parent
        if ($deps) {
            $mjs = Join-Path $deps 'pnpm\bin\pnpm.mjs'
            if (Test-Path -LiteralPath $mjs) {
                return [pscustomobject]@{ Exe = $NodeExe; BaseArgs = @($mjs); Kind = 'mjs' }
            }
        }
    }
    # 2) PATH 上的 pnpm（优先 .cmd / .exe，避免拿到 .ps1 时无法被 cmd 执行）
    $cmd = Get-Command pnpm.cmd -ErrorAction SilentlyContinue | Where-Object { $_.Source } | Select-Object -First 1
    if (-not $cmd) {
        $cmd = Get-Command pnpm -ErrorAction SilentlyContinue | Where-Object { $_.Source } | Select-Object -First 1
    }
    if ($cmd) {
        if ($cmd.Source -like '*.exe') {
            return [pscustomobject]@{ Exe = $cmd.Source; BaseArgs = @(); Kind = 'exe' }
        }
        if ($cmd.Source -like '*.ps1') {
            return [pscustomobject]@{ Exe = $env:SystemRoot + '\System32\WindowsPowerShell\v1.0\powershell.exe'; BaseArgs = @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $cmd.Source); Kind = 'ps1' }
        }
        return [pscustomobject]@{ Exe = $env:ComSpec; BaseArgs = @('/d', '/c', ('"' + $cmd.Source + '"')); Kind = 'cmd' }
    }
    # 3) corepack
    $corepack = Get-Command corepack -ErrorAction SilentlyContinue | Where-Object { $_.Source } | Select-Object -First 1
    if ($corepack) {
        $cmdExe = $corepack.Source
        if ($cmdExe -like '*.cmd') {
            return [pscustomobject]@{ Exe = $env:ComSpec; BaseArgs = @('/d', '/c', ('"' + $cmdExe + '"')); Kind = 'cmd' }
        }
        return [pscustomobject]@{ Exe = $cmdExe; BaseArgs = @('pnpm'); Kind = 'corepack' }
    }
    return $null
}

function Resolve-FrontendCommand([string]$NodeExe, $Pnpm) {
    if ($Pnpm) {
        return [pscustomobject]@{ Exe = $Pnpm.Exe; Args = @($Pnpm.BaseArgs + @('dev')) }
    }
    $nextBin = Join-Path $script:FrontendDir 'node_modules\next\dist\bin\next'
    if (Test-Path -LiteralPath $nextBin) {
        return [pscustomobject]@{ Exe = $NodeExe; Args = @($nextBin, 'dev', '-p', "$($script:FrontendPort)") }
    }
    return $null
}

# ---------------------------------------------------------------------------
# HTTP 探测
# 注意：Windows PowerShell 5.1 默认没有加载 System.Net.Http，用 WebClient
# （System.dll 自带）可以避免探测静默失败。
# ---------------------------------------------------------------------------
function New-WebClient {
    $client = New-Object System.Net.WebClient
    $client.Proxy = $null
    $client.Encoding = [System.Text.Encoding]::UTF8
    return $client
}

function Test-UrlContains([string]$Url, [string]$Pattern, [int]$TimeoutMs) {
    if (-not $TimeoutMs) { $TimeoutMs = 4000 }
    $client = New-WebClient
    try {
        $task = $client.DownloadStringTaskAsync($Url)
        if (-not $task.Wait($TimeoutMs)) { return $false }
        return (([string]$task.Result) -match $Pattern)
    }
    catch { return $false }
    finally { try { $client.Dispose() } catch { } }
}

function New-Probe([string]$Url, [string]$Pattern) {
    return [pscustomobject]@{
        Url     = $Url
        Pattern = $Pattern
        Task    = $null
        Client  = $null
        Ready   = $false
        NextTry = (Get-Date)
        Error   = ''
    }
}

function Reset-ProbeClient($Probe) {
    if ($Probe.Client) { try { $Probe.Client.Dispose() } catch { } }
    $Probe.Client = $null
    $Probe.Task = $null
}

function Update-Probe($Probe) {
    if (-not $Probe) { return }
    if ($Probe.Ready) { return }
    if ($Probe.Task) {
        if (-not $Probe.Task.IsCompleted) { return }
        try {
            $body = [string]$Probe.Task.Result
            if ($body -match $Probe.Pattern) {
                $Probe.Ready = $true
            }
            else {
                $Probe.Error = '返回内容中没有预期标记'
                $Probe.NextTry = (Get-Date).AddSeconds(1)
            }
        }
        catch {
            $inner = $_.Exception
            while ($inner.InnerException) { $inner = $inner.InnerException }
            $Probe.Error = $inner.Message
            $Probe.NextTry = (Get-Date).AddSeconds(1)
        }
        Reset-ProbeClient $Probe
        return
    }
    if ((Get-Date) -lt $Probe.NextTry) { return }
    try {
        $Probe.Client = New-WebClient
        $Probe.Task = $Probe.Client.DownloadStringTaskAsync($Probe.Url)
    }
    catch {
        $Probe.Error = $_.Exception.Message
        $Probe.NextTry = (Get-Date).AddSeconds(1)
        Reset-ProbeClient $Probe
    }
}

# ---------------------------------------------------------------------------
# 日志跟随
# ---------------------------------------------------------------------------
function New-Tailer([string]$Path, [string]$Label, [ConsoleColor]$Color, [string]$FailPattern) {
    return [pscustomobject]@{
        Path        = $Path
        Label       = $Label
        Color       = $Color
        Stream      = $null
        Position    = [long]0
        Buffer      = ''
        FailPattern = $FailPattern
        FailSeen    = $false
    }
}

function Show-LogLine($Tailer, [string]$Line) {
    $esc = [string][char]27
    $Line = $Line -replace ($esc + '\[[0-9;?]*[ -/]*[@-~]'), ''
    $Line = $Line.TrimEnd()
    if ([string]::IsNullOrWhiteSpace($Line)) { return }
    if ($Tailer.FailPattern -and ($Line -match $Tailer.FailPattern)) { $Tailer.FailSeen = $true }
    Write-Host ('  [' + $Tailer.Label + '] ') -ForegroundColor $Tailer.Color -NoNewline
    Write-Host $Line
}

function Read-Tailer($Tailer) {
    if (-not $Tailer.Stream) {
        if (-not (Test-Path -LiteralPath $Tailer.Path)) { return }
        try {
            $Tailer.Stream = [System.IO.File]::Open(
                $Tailer.Path,
                [System.IO.FileMode]::Open,
                [System.IO.FileAccess]::Read,
                [System.IO.FileShare]::ReadWrite)
        }
        catch { return }
        $Tailer.Position = 0
    }

    $stream = $Tailer.Stream
    $length = $stream.Length
    while ($Tailer.Position -lt $length) {
        $stream.Position = $Tailer.Position
        $want = [int][Math]::Min(65536, ($length - $Tailer.Position))
        $bytes = New-Object byte[] $want
        $read = $stream.Read($bytes, 0, $want)
        if ($read -le 0) { break }
        $Tailer.Position += $read
        $Tailer.Buffer += [System.Text.Encoding]::UTF8.GetString($bytes, 0, $read)
        while ($Tailer.Buffer.IndexOf("`n") -ge 0) {
            $idx = $Tailer.Buffer.IndexOf("`n")
            $line = $Tailer.Buffer.Substring(0, $idx)
            $Tailer.Buffer = $Tailer.Buffer.Substring($idx + 1)
            Show-LogLine $Tailer $line
        }
        $length = $stream.Length
    }
}

function Complete-Tailer($Tailer) {
    try { Read-Tailer $Tailer } catch { }
    if ($Tailer.Buffer -and $Tailer.Buffer.Trim().Length -gt 0) {
        Show-LogLine $Tailer $Tailer.Buffer
    }
    $Tailer.Buffer = ''
}

# ---------------------------------------------------------------------------
# 端口与进程
# ---------------------------------------------------------------------------
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

function Get-ProcessNameSafe([int]$OwnerPid) {
    try { return (Get-Process -Id $OwnerPid -ErrorAction Stop).ProcessName }
    catch { return '未知进程' }
}

function Get-ProcessCommandLine([int]$OwnerPid) {
    try {
        $info = Get-CimInstance Win32_Process -Filter ("ProcessId = " + $OwnerPid) -ErrorAction Stop
        if ($info) { return [string]$info.CommandLine }
    }
    catch { }
    return ''
}

function Stop-ProcessTree([int]$OwnerPid) {
    if ($OwnerPid -le 0) { return }
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

function Stop-PortOwner([int]$OwnerPid, [int]$Port) {
    $name = Get-ProcessNameSafe $OwnerPid
    if (-not $script:RestartFlag) {
        if ([Console]::IsInputRedirected) {
            throw ("端口 " + $Port + " 被「" + $name + "」(PID " + $OwnerPid + ") 占用。请先关闭该程序，或使用 -Restart 参数强制重启。")
        }
        if (-not (Confirm-Yes ('是否结束「' + $name + '」(PID ' + $OwnerPid + ') 以释放端口 ' + $Port + '？'))) {
            throw ('已取消：端口 ' + $Port + ' 被占用。')
        }
    }
    Write-Step ('正在结束进程 ' + $name + ' (PID ' + $OwnerPid + ')…')
    Stop-ProcessTree $OwnerPid
    if (-not (Wait-PortFree $Port 5)) {
        throw ('端口 ' + $Port + ' 仍被占用，无法启动。')
    }
    Write-Ok ('端口 ' + $Port + ' 已释放')
}

# ---------------------------------------------------------------------------
# 启动子进程
# ---------------------------------------------------------------------------
function Start-Child([string]$Label, [string]$Exe, [string[]]$Arguments, [string]$WorkingDirectory, [string]$OutLog, [string]$ErrLog) {
    if (-not (Test-Path -LiteralPath $WorkingDirectory)) {
        throw ('目录不存在：' + $WorkingDirectory)
    }
    $quoted = Quote-Args $Arguments
    $process = Start-Process -FilePath $Exe -ArgumentList $quoted -WorkingDirectory $WorkingDirectory `
        -RedirectStandardOutput $OutLog -RedirectStandardError $ErrLog -NoNewWindow -PassThru -ErrorAction Stop
    $entry = [pscustomobject]@{ Name = $Label; Process = $process; Notified = $false }
    $script:Children += $entry
    return $entry
}

function Stop-Children {
    $stopped = $false
    foreach ($child in $script:Children) {
        if ($child.Process -and -not $child.Process.HasExited) {
            Stop-ProcessTree $child.Process.Id
            $stopped = $true
        }
    }
    if ($stopped) {
        Write-Host ''
        Write-Dim '已停止本次启动的前端与后端进程。'
    }
    foreach ($tailer in $script:Tailers) { Complete-Tailer $tailer }
}

# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------
function Invoke-Main {
    Initialize-Console
    Write-Header
    $startTime = Get-Date

    # 清理上次停止脚本可能残留的标记
    Remove-Item -LiteralPath $script:StoppingFlag -Force -ErrorAction SilentlyContinue

    # ---- [1/4] Python 与后端依赖 ------------------------------------------
    Write-Step '[1/4] 检查 Python 与后端依赖'
    $backendEntry = Join-Path $script:BackendDir 'main.py'
    if (-not (Test-Path -LiteralPath $backendEntry)) {
        throw ('未找到后端项目：' + $backendEntry)
    }

    $venvPython = Join-Path $script:BackendDir '.venv\Scripts\python.exe'
    $requirements = Join-Path $script:BackendDir 'requirements.txt'

    if (-not (Test-Path -LiteralPath $venvPython)) {
        Write-Warn '未找到 backend\.venv（Python 虚拟环境）'
        $systemPython = Resolve-SystemPython
        if (-not $systemPython) {
            throw '未找到 Python。请安装 Python 3.11+ 并将其加入 PATH 后重试。'
        }
        if (-not (Confirm-Yes '是否现在创建虚拟环境并安装后端依赖？（首次约需 1–2 分钟）')) {
            throw '已取消：缺少 Python 虚拟环境。'
        }
        Write-Step '正在创建虚拟环境…'
        & $systemPython -m venv (Join-Path $script:BackendDir '.venv')
        if ($LASTEXITCODE -ne 0) { throw '创建虚拟环境失败。' }
        Write-Step '正在安装后端依赖…'
        & $venvPython -m pip install --disable-pip-version-check -q -r $requirements
        if ($LASTEXITCODE -ne 0) { throw '安装后端依赖失败。' }
    }

    $pyInfo = & $venvPython -c "import sys, fastapi, uvicorn; print('Python %d.%d  FastAPI %s  Uvicorn %s' % (sys.version_info[0], sys.version_info[1], fastapi.__version__, uvicorn.__version__))" 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Warn '后端依赖缺失或不完整（fastapi / uvicorn）'
        if (-not (Confirm-Yes '是否现在安装 backend\requirements.txt？')) {
            throw '已取消：后端依赖未安装。'
        }
        Write-Step '正在安装后端依赖…'
        & $venvPython -m pip install --disable-pip-version-check -r $requirements
        if ($LASTEXITCODE -ne 0) { throw '安装后端依赖失败。' }
        $pyInfo = & $venvPython -c "import sys, fastapi, uvicorn; print('Python %d.%d  FastAPI %s  Uvicorn %s' % (sys.version_info[0], sys.version_info[1], fastapi.__version__, uvicorn.__version__))" 2>&1
        if ($LASTEXITCODE -ne 0) { throw '后端依赖安装后仍无法导入。' }
    }
    Write-Ok ('后端环境：' + (($pyInfo | Out-String).Trim()))

    # ---- [2/4] Node 与前端依赖 --------------------------------------------
    Write-Step '[2/4] 检查 Node.js 与前端依赖'
    if (-not (Test-Path -LiteralPath (Join-Path $script:FrontendDir 'package.json'))) {
        throw ('未找到前端项目：' + (Join-Path $script:FrontendDir 'package.json'))
    }

    $nodeInfo = Resolve-Node
    if (-not $nodeInfo) {
        throw "未找到 Node.js。`n     可安装 Node.js 20.9+（https://nodejs.org），或确认 DSH 内置运行时存在：`n     %USERPROFILE%\.dsh\dsh-runtimes\*\dependencies\node\bin\node.exe"
    }

    $nodeVersion = ''
    try { $nodeVersion = [string](& $nodeInfo.Exe -v 2>$null | Select-Object -First 1) } catch { }
    $nodeMajor = 0
    if ($nodeVersion -match 'v(\d+)') { $nodeMajor = [int]$Matches[1] }
    if ($nodeMajor -gt 0 -and $nodeMajor -lt 18) {
        Write-Warn ('Node.js 版本偏低（' + $nodeVersion + '），Next.js 16 建议 20.9+。')
    }
    Write-Ok ('Node.js ' + $nodeVersion + '（' + $nodeInfo.Exe + '）')

    $pnpm = Resolve-Pnpm $nodeInfo.Exe $nodeInfo.Dir
    if ($pnpm) {
        $pnpmVersion = ''
        try { $pnpmVersion = [string](& $pnpm.Exe @($pnpm.BaseArgs + @('-v')) 2>$null | Select-Object -First 1) } catch { }
        Write-Ok ('pnpm ' + $pnpmVersion.Trim())
    }
    else {
        Write-Warn '未找到 pnpm，将尝试直接调用本地 Next.js'
    }

    $nodeModules = Join-Path $script:FrontendDir 'node_modules'
    $nextPackage = Join-Path $nodeModules 'next'
    if (-not (Test-Path -LiteralPath $nextPackage)) {
        Write-Warn '未找到 frontend\node_modules（前端依赖未安装）'
        if (-not $pnpm) {
            throw '前端依赖未安装，且未找到 pnpm。请先安装 pnpm，再在 frontend 目录执行 pnpm install。'
        }
        if (-not (Confirm-Yes '是否现在安装前端依赖？（pnpm install，可能需要几分钟）')) {
            throw '已取消：前端依赖未安装。'
        }
        Write-Step '正在安装前端依赖…'
        $installArgs = Quote-Args @($pnpm.BaseArgs + @('install'))
        $install = Start-Process -FilePath $pnpm.Exe -ArgumentList $installArgs -WorkingDirectory $script:FrontendDir -NoNewWindow -PassThru -Wait
        if ($install.ExitCode -ne 0) { throw ('前端依赖安装失败（退出码 ' + $install.ExitCode + '）。') }
        Write-Ok '前端依赖安装完成'
    }
    else {
        Write-Ok '前端依赖已就绪（node_modules）'
    }

    # ---- [3/4] 端口检查 ---------------------------------------------------
    Write-Step '[3/4] 检查端口占用'
    $backendReuse = $false
    $frontendReuse = $false

    $backendOwner = Get-PortOwnerPid $script:BackendPort
    if ($backendOwner -gt 0) {
        $backendOurs = Test-UrlContains $script:HealthUrl '"ok"\s*:\s*true' 3000
        if ($backendOurs -and -not $script:RestartFlag) {
            Write-Ok ('后端已在运行（端口 ' + $script:BackendPort + '），复用现有服务')
            $backendReuse = $true
        }
        else {
            Write-Warn ('端口 ' + $script:BackendPort + ' 被占用：' + (Get-ProcessNameSafe $backendOwner) + '（PID ' + $backendOwner + '）')
            Stop-PortOwner $backendOwner $script:BackendPort
        }
    }
    else {
        Write-Ok ('端口 ' + $script:BackendPort + ' 可用')
    }

    $frontendOwner = Get-PortOwnerPid $script:FrontendPort
    if ($frontendOwner -gt 0) {
        $frontendOurs = Test-UrlContains $script:FrontendProbe $script:PageMarker 5000
        if ($frontendOurs -and -not $script:RestartFlag) {
            Write-Ok ('前端已在运行（端口 ' + $script:FrontendPort + '），复用现有服务')
            $frontendReuse = $true
        }
        else {
            Write-Warn ('端口 ' + $script:FrontendPort + ' 被占用：' + (Get-ProcessNameSafe $frontendOwner) + '（PID ' + $frontendOwner + '）')
            Stop-PortOwner $frontendOwner $script:FrontendPort
        }
    }
    else {
        Write-Ok ('端口 ' + $script:FrontendPort + ' 可用')
    }

    # ---- [4/4] 启动服务 ---------------------------------------------------
    Write-Step '[4/4] 启动服务'
    if ($backendReuse -and $frontendReuse) {
        Write-Dim '前后端均已在运行，无需重复启动。'
    }
    if (-not (Test-Path -LiteralPath $script:RunDir)) {
        New-Item -ItemType Directory -Path $script:RunDir -Force | Out-Null
    }
    $backendOut = Join-Path $script:RunDir 'backend.out.log'
    $backendErr = Join-Path $script:RunDir 'backend.err.log'
    $frontendOut = Join-Path $script:RunDir 'frontend.out.log'
    $frontendErr = Join-Path $script:RunDir 'frontend.err.log'

    if (-not $backendReuse) {
        foreach ($path in @($backendOut, $backendErr)) {
            Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
        }
        $env:PYTHONUTF8 = '1'
        $env:PYTHONIOENCODING = 'utf-8'
        $env:PYTHONUNBUFFERED = '1'
        $backendArgs = @('-m', 'uvicorn', 'main:app', '--reload', '--host', '127.0.0.1', '--port', "$($script:BackendPort)")
        $backendChild = Start-Child '后端' $venvPython $backendArgs $script:BackendDir $backendOut $backendErr
        Write-Ok ('后端进程已启动（PID ' + $backendChild.Process.Id + '）')
        $failPattern = 'Error loading ASGI app|Traceback \(most recent call last\)'
        $script:Tailers += New-Tailer $backendOut '后端' ([ConsoleColor]::Cyan) $failPattern
        $script:Tailers += New-Tailer $backendErr '后端' ([ConsoleColor]::Cyan) $failPattern
    }

    if (-not $frontendReuse) {
        foreach ($path in @($frontendOut, $frontendErr)) {
            Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
        }
        if ($nodeInfo.Dir) { $env:PATH = $nodeInfo.Dir + ';' + $env:PATH }
        $env:NEXT_TELEMETRY_DISABLED = '1'

        $frontendCommand = Resolve-FrontendCommand $nodeInfo.Exe $pnpm
        if (-not $frontendCommand) {
            throw '找不到可用的前端启动方式（pnpm 与本地 Next.js 均不可用）。'
        }
        $frontendChild = Start-Child '前端' $frontendCommand.Exe $frontendCommand.Args $script:FrontendDir $frontendOut $frontendErr
        Write-Ok ('前端进程已启动（PID ' + $frontendChild.Process.Id + '）')
        $frontendFail = 'Failed to compile'
        $script:Tailers += New-Tailer $frontendOut '前端' ([ConsoleColor]::Green) $frontendFail
        $script:Tailers += New-Tailer $frontendErr '前端' ([ConsoleColor]::Green) $frontendFail
    }

    Write-Dim ('日志目录：' + $script:RunDir)

    # ---- 等待就绪 + 实时日志 ----------------------------------------------
    $backendProbe = $null
    $frontendProbe = $null
    if (-not $backendReuse) {
        $backendProbe = New-Probe $script:HealthUrl '"ok"\s*:\s*true'
        Write-Dim '等待后端就绪…'
    }
    if (-not $frontendReuse) {
        $frontendProbe = New-Probe $script:FrontendProbe $script:PageMarker
        Write-Dim '等待前端编译…'
    }

    $backendReady = [bool]$backendReuse
    $frontendReady = [bool]$frontendReuse
    $waitStart = Get-Date
    $backendDeadline = $waitStart.AddSeconds(120)
    $frontendDeadline = $waitStart.AddSeconds(240)
    $lastNudge = $waitStart
    $bannerShown = $false
    $backendFailAt = $null
    $frontendFailAt = $null

    while ($true) {
        foreach ($tailer in $script:Tailers) { Read-Tailer $tailer }

        if ($backendProbe) { Update-Probe $backendProbe }
        if ($frontendProbe) { Update-Probe $frontendProbe }

        if ($backendProbe -and $backendProbe.Ready -and -not $backendReady) {
            $backendReady = $true
            Write-Ok ('后端已就绪（' + $script:HealthUrl + '）')
        }
        if ($frontendProbe -and $frontendProbe.Ready -and -not $frontendReady) {
            $frontendReady = $true
            Write-Ok ('前端已就绪（' + $script:FrontendUrl + '）')
        }

        foreach ($child in $script:Children) {
            if (-not $child.Notified -and $child.Process.HasExited) {
                $child.Notified = $true
                if (Test-Path -LiteralPath $script:StoppingFlag) {
                    # 用户通过 停止史脉.cmd 主动停止：安静退出
                    Write-Host ''
                    Write-Dim '检测到停止请求，正在退出启动器…'
                    return
                }
                $exitCodeText = '未知'
                try {
                    $exitCodeValue = $child.Process.ExitCode
                    if ($null -ne $exitCodeValue -and "$exitCodeValue" -ne '') { $exitCodeText = [string]$exitCodeValue }
                }
                catch { }
                throw ($child.Name + '进程已退出（退出码 ' + $exitCodeText + '）。请查看日志：' + $script:RunDir)
            }
        }

        $now = Get-Date
        foreach ($tailer in $script:Tailers) {
            if ($tailer.FailSeen) {
                if ($tailer.Label -eq '后端' -and -not $backendReady -and -not $backendFailAt) { $backendFailAt = $now }
                if ($tailer.Label -eq '前端' -and -not $frontendReady -and -not $frontendFailAt) { $frontendFailAt = $now }
            }
        }
        if ($backendFailAt -and ((($now - $backendFailAt).TotalSeconds -ge 5))) {
            throw ('后端启动失败，请查看日志：' + $backendErr)
        }
        if ($frontendFailAt -and ((($now - $frontendFailAt).TotalSeconds -ge 15))) {
            throw ('前端编译失败，请查看日志：' + $frontendErr)
        }

        if (-not $backendReady -and $now -gt $backendDeadline) {
            $detail = ''
            if ($backendProbe -and $backendProbe.Error) { $detail = '（探测错误：' + $backendProbe.Error + '）' }
            throw ('后端在 120 秒内未就绪' + $detail + '。请查看日志：' + $backendErr)
        }
        if (-not $frontendReady -and $now -gt $frontendDeadline) {
            $detail = ''
            if ($frontendProbe -and $frontendProbe.Error) { $detail = '（探测错误：' + $frontendProbe.Error + '）' }
            throw ('前端在 240 秒内未就绪' + $detail + '。请查看日志：' + $frontendErr)
        }

        if (-not $bannerShown -and ((($now - $lastNudge).TotalSeconds -ge 10))) {
            $missing = @()
            if (-not $backendReady) { $missing += '后端' }
            if (-not $frontendReady) { $missing += '前端' }
            if ($missing.Count -gt 0) {
                Write-Dim ('仍在等待' + ($missing -join '与') + '就绪…已用 ' + [int]((($now - $waitStart)).TotalSeconds) + ' 秒')
            }
            $lastNudge = $now
        }

        if (-not $bannerShown -and $backendReady -and $frontendReady) {
            $bannerShown = $true
            $elapsed = [math]::Round(((Get-Date) - $startTime).TotalSeconds, 1)
            Write-Host ''
            Write-Host '  ---------------------------------------------------' -ForegroundColor DarkGray
            Write-Ok ('史脉已启动（用时 ' + $elapsed + ' 秒）')
            Write-Info ('前端：' + $script:FrontendUrl)
            Write-Info ('后端：' + $script:HealthUrl)
            if ($backendReuse -and $frontendReuse) {
                Write-Dim '服务由其他窗口管理，本窗口稍后自动关闭'
            }
            elseif ($backendReuse -or $frontendReuse) {
                Write-Dim '按 Ctrl+C 或关闭本窗口即可停止本次启动的服务'
            }
            else {
                Write-Dim '按 Ctrl+C 或关闭本窗口即可停止全部服务'
            }
            Write-Host '  ---------------------------------------------------' -ForegroundColor DarkGray
            Write-Host ''
            try { $Host.UI.RawUI.WindowTitle = '史脉 · 运行中 · ' + $script:FrontendUrl } catch { }

            if (-not $script:NoBrowserFlag) {
                try { Start-Process $script:FrontendUrl | Out-Null }
                catch { Write-Warn ('自动打开浏览器失败，请手动访问 ' + $script:FrontendUrl) }
            }
        }

        if ($bannerShown) {
            $managed = @($script:Children | Where-Object { -not $_.Process.HasExited })
            if ($managed.Count -eq 0 -and $script:Tailers.Count -eq 0) {
                Write-Dim '所有服务均已由其他窗口启动，本窗口将在 5 秒后自动关闭。'
                Start-Sleep -Seconds 5
                return
            }
        }

        Start-Sleep -Milliseconds 250
    }
}

# ---------------------------------------------------------------------------
# 入口
# ---------------------------------------------------------------------------
try {
    Invoke-Main
}
catch [System.Management.Automation.PipelineStoppedException] {
    # 用户按下 Ctrl+C：正常停止
}
catch {
    $script:ExitCode = 1
    Write-Host ''
    Write-Fail $_.Exception.Message
    foreach ($child in $script:Children) {
        if (-not $child.Process.HasExited) {
            Write-Dim ($child.Name + '进程 PID ' + $child.Process.Id + ' 仍在运行，将被结束')
        }
    }
    if ($script:PauseOnError) {
        try { Read-Host '按回车键关闭窗口' | Out-Null } catch { }
    }
}
finally {
    Stop-Children
}
exit $script:ExitCode
