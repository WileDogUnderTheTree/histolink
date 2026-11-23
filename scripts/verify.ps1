#Requires -Version 5.1
<#
  史脉 · 本地权威门禁（scripts/verify.ps1）
  ---------------------------------------------------------------------------
  串行执行 V1.0.1 的质量门禁，任一项失败即以非 0 退出码结束，供本地验收与 CI 共用。

  当前步骤（按任务卡 TC 顺序，随卡片落地逐步追加）：
    [1] tsc --noEmit                 （TC-01）
    [2] next build                   （TC-01）
    [3] validate-data                （TC-01）
    [4] build-persons --check        （TC-02）
    [5] extract-sources --check      （TC-03）
    [6] export_contracts --check     （TC-04）
    [7] gen-frontend-types --check   （TC-04）
    [8] export-snapshot --check      （TC-05）
    [9] pytest                       （TC-06）
    [10] vitest                      （TC-07）
    [11] run-evals --mode contract   （TC-09）
    [12] validate-contract           （TC-04 / TC-11 出口加固）

  用法：
    pwsh scripts/verify.ps1              # 全量
    pwsh scripts/verify.ps1 -SkipBuild   # 跳过较慢的 next build（本地快速回归）
    pwsh scripts/verify.ps1 -Only 1,3    # 只跑指定步骤

  说明：
    - Node / pnpm / Python 优先使用 PATH，找不到时自动回退到 DSH 内置运行时
      （与 scripts/launch.ps1 同一套解析策略）；
    - 每一步的耗时与退出码均会打印，最后汇总 PASS/FAIL；
    - 不修改任何数据文件，所有 --check 步骤必须只读。
#>
[CmdletBinding()]
param(
    [switch]$SkipBuild,
    [int[]]$Only
)

$ErrorActionPreference = 'Stop'

$script:Root = Split-Path -Parent $PSScriptRoot
$script:BackendDir = Join-Path $script:Root 'backend'
$script:FrontendDir = Join-Path $script:Root 'frontend'
$script:StartedAt = Get-Date
$script:Results = @()

# ---------------------------------------------------------------------------
# 控制台
# ---------------------------------------------------------------------------
try { & "$env:SystemRoot\System32\chcp.com" 65001 2>&1 | Out-Null } catch { }
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }

function Write-Step([string]$Text) { Write-Host ('  >  ' + $Text) -ForegroundColor Cyan }
function Write-Ok([string]$Text) { Write-Host ('  OK ' + $Text) -ForegroundColor Green }
function Write-Warn([string]$Text) { Write-Host ('  !  ' + $Text) -ForegroundColor Yellow }
function Write-Fail([string]$Text) { Write-Host ('  X  ' + $Text) -ForegroundColor Red }
function Write-Dim([string]$Text) { Write-Host ('     ' + $Text) -ForegroundColor DarkGray }

# ---------------------------------------------------------------------------
# 运行时解析（与 launch.ps1 保持一致，便于本机与 CI 共用）
# ---------------------------------------------------------------------------
function Get-DshHomes {
    $homes = @()
    if ($env:DSH_HOME) { $homes += $env:DSH_HOME }
    if ($env:USERPROFILE) { $homes += (Join-Path $env:USERPROFILE '.dsh') }
    return ($homes | Select-Object -Unique)
}

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

function Resolve-Pnpm([string]$NodeExe, [string]$NodeDir) {
    if ($NodeDir) {
        $deps = Split-Path (Split-Path $NodeDir -Parent) -Parent
        if ($deps) {
            $mjs = Join-Path $deps 'pnpm\bin\pnpm.mjs'
            if (Test-Path -LiteralPath $mjs) {
                return [pscustomobject]@{ Exe = $NodeExe; BaseArgs = @($mjs) }
            }
        }
    }
    $cmd = Get-Command pnpm.cmd -ErrorAction SilentlyContinue | Where-Object { $_.Source } | Select-Object -First 1
    if (-not $cmd) {
        $cmd = Get-Command pnpm -ErrorAction SilentlyContinue | Where-Object { $_.Source } | Select-Object -First 1
    }
    if ($cmd) {
        return [pscustomobject]@{ Exe = $cmd.Source; BaseArgs = @() }
    }
    return $null
}

function Resolve-BackendPython {
    $venv = Join-Path $script:BackendDir '.venv\Scripts\python.exe'
    if (Test-Path -LiteralPath $venv) { return $venv }
    $cmd = Get-Command python -ErrorAction SilentlyContinue | Where-Object { $_.Source } | Select-Object -First 1
    if ($cmd) { return $cmd.Source }
    return $null
}

# ---------------------------------------------------------------------------
# 运行一步检查
# ---------------------------------------------------------------------------
function Invoke-Check {
    param(
        [int]$Index,
        [string]$Name,
        [string]$Exe,
        [string[]]$Arguments,
        [string]$WorkingDirectory,
        [switch]$Skip
    )

    if ($script:Only -and ($script:Only -notcontains $Index)) {
        Write-Dim ('[跳过] ' + $Name + '（-Only 未包含）')
        return
    }
    if ($Skip) {
        Write-Dim ('[跳过] ' + $Name + '（-SkipBuild）')
        $script:Results += [pscustomobject]@{ Index = $Index; Name = $Name; Status = 'SKIP'; Seconds = 0 }
        return
    }
    if (-not $Exe -or -not (Test-Path -LiteralPath $Exe)) {
        throw ('[' + $Name + '] 找不到可执行文件：' + $Exe)
    }

    Write-Step ('[' + $Index + '] ' + $Name)
    $start = Get-Date
    $previous = $PWD.Path
    try {
        Set-Location -LiteralPath $WorkingDirectory
        & $Exe @Arguments
        $exitCode = $LASTEXITCODE
    }
    finally {
        Set-Location -LiteralPath $previous
    }
    $seconds = [math]::Round(((Get-Date) - $start).TotalSeconds, 1)

    if ($exitCode -ne 0) {
        $script:Results += [pscustomobject]@{ Index = $Index; Name = $Name; Status = 'FAIL'; Seconds = $seconds }
        throw ('[' + $Name + '] 失败（退出码 ' + $exitCode + '，耗时 ' + $seconds + ' 秒）')
    }
    $script:Results += [pscustomobject]@{ Index = $Index; Name = $Name; Status = 'PASS'; Seconds = $seconds }
    Write-Ok ('[' + $Name + '] PASS（' + $seconds + ' 秒）')
}

# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------
try {
    Write-Host ''
    Write-Host '  史脉 · 本地门禁 scripts/verify.ps1' -ForegroundColor White
    Write-Host '  ---------------------------------------------------' -ForegroundColor DarkGray

    if (-not (Test-Path -LiteralPath (Join-Path $script:FrontendDir 'node_modules'))) {
        throw '缺少 frontend\node_modules，请先在 frontend 目录执行 pnpm install。'
    }

    $node = Resolve-Node
    if (-not $node) {
        throw "未找到 Node.js。请安装 Node.js 20.9+，或确认 DSH 内置运行时存在：`n     %USERPROFILE%\.dsh\dsh-runtimes\*\dependencies\node\bin\node.exe"
    }
    if ($node.Dir) { $env:PATH = $node.Dir + ';' + $env:PATH }
    $env:NEXT_TELEMETRY_DISABLED = '1'
    $env:PYTHONUTF8 = '1'
    $env:PYTHONIOENCODING = 'utf-8'

    $pnpm = Resolve-Pnpm $node.Exe $node.Dir
    $python = Resolve-BackendPython
    Write-Dim ('Node：' + $node.Exe)
    if ($pnpm) { Write-Dim ('pnpm：' + $pnpm.Exe + ' ' + ($pnpm.BaseArgs -join ' ')) }
    Write-Dim ('Python：' + $(if ($python) { $python } else { '未找到' }))

    # [1] 前端类型检查
    Invoke-Check -Index 1 -Name 'tsc --noEmit' `
        -Exe $node.Exe `
        -Arguments @((Join-Path $script:FrontendDir 'node_modules\typescript\bin\tsc'), '--noEmit', '-p', (Join-Path $script:FrontendDir 'tsconfig.json')) `
        -WorkingDirectory $script:Root

    # [2] 前端生产构建
    Invoke-Check -Index 2 -Name 'next build' `
        -Exe $node.Exe `
        -Arguments @((Join-Path $script:FrontendDir 'node_modules\next\dist\bin\next'), 'build') `
        -WorkingDirectory $script:FrontendDir `
        -Skip:([bool]$SkipBuild)

    # [3] 全量数据校验
    Invoke-Check -Index 3 -Name 'validate-data' `
        -Exe $node.Exe `
        -Arguments @((Join-Path $script:Root 'scripts\validate-data.mjs')) `
        -WorkingDirectory $script:Root

    # [4] 人物主数据（TC-02 落地后启用）
    if (Test-Path -LiteralPath (Join-Path $script:Root 'scripts\build-persons.mjs')) {
        Invoke-Check -Index 4 -Name 'build-persons --check' `
            -Exe $node.Exe `
            -Arguments @((Join-Path $script:Root 'scripts\build-persons.mjs'), '--check') `
            -WorkingDirectory $script:Root
    }

    # [5] 引用结构化（TC-03 落地后启用）
    if (Test-Path -LiteralPath (Join-Path $script:Root 'scripts\extract-sources.mjs')) {
        Invoke-Check -Index 5 -Name 'extract-sources --check' `
            -Exe $node.Exe `
            -Arguments @((Join-Path $script:Root 'scripts\extract-sources.mjs'), '--check') `
            -WorkingDirectory $script:Root
    }

    # [6] 契约导出（TC-04 落地后启用）
    $exportContracts = Join-Path $script:BackendDir 'scripts\export_contracts.py'
    if ((Test-Path -LiteralPath $exportContracts) -and $python) {
        Invoke-Check -Index 6 -Name 'export_contracts --check' `
            -Exe $python `
            -Arguments @($exportContracts, '--check') `
            -WorkingDirectory $script:BackendDir
    }

    # [7] 前端类型生成校验（TC-04 落地后启用）
    $genTypes = Join-Path $script:Root 'scripts\gen-frontend-types.mjs'
    if (Test-Path -LiteralPath $genTypes) {
        Invoke-Check -Index 7 -Name 'gen-frontend-types --check' `
            -Exe $node.Exe `
            -Arguments @($genTypes, '--check') `
            -WorkingDirectory $script:Root
    }

    # [8] 数据快照（TC-05 落地后启用）
    if (Test-Path -LiteralPath (Join-Path $script:Root 'scripts\export-snapshot.mjs')) {
        Invoke-Check -Index 8 -Name 'export-snapshot --check' `
            -Exe $node.Exe `
            -Arguments @((Join-Path $script:Root 'scripts\export-snapshot.mjs'), '--check') `
            -WorkingDirectory $script:Root
    }

    # [9] 后端回归测试（TC-06 落地后启用）
    if ((Test-Path -LiteralPath (Join-Path $script:BackendDir 'tests')) -and $python) {
        Invoke-Check -Index 9 -Name 'pytest' `
            -Exe $python `
            -Arguments @('-m', 'pytest', '-q') `
            -WorkingDirectory $script:BackendDir
    }

    # [10] 前端单测（TC-07 落地后启用）
    if (Test-Path -LiteralPath (Join-Path $script:FrontendDir 'tests\action-policy.test.ts')) {
        if (-not $pnpm) { throw '需要 pnpm 才能运行前端单测，但未找到 pnpm。' }
        Invoke-Check -Index 10 -Name 'vitest' `
            -Exe $pnpm.Exe `
            -Arguments @($pnpm.BaseArgs + @('exec', 'vitest', 'run')) `
            -WorkingDirectory $script:FrontendDir
    }

    # [11] 评测契约模式（TC-09 落地后启用）
    if (Test-Path -LiteralPath (Join-Path $script:Root 'scripts\run-evals.mjs')) {
        Invoke-Check -Index 11 -Name 'run-evals --mode contract' `
            -Exe $node.Exe `
            -Arguments @((Join-Path $script:Root 'scripts\run-evals.mjs'), '--mode', 'contract') `
            -WorkingDirectory $script:Root
    }

    # [12] 契约测试（TC-04；V1.0.1 出口起纳入门禁）
    if (Test-Path -LiteralPath (Join-Path $script:Root 'scripts\validate-contract.mjs')) {
        Invoke-Check -Index 12 -Name 'validate-contract' `
            -Exe $node.Exe `
            -Arguments @((Join-Path $script:Root 'scripts\validate-contract.mjs')) `
            -WorkingDirectory $script:Root
    }

    $total = [math]::Round(((Get-Date) - $script:StartedAt).TotalSeconds, 1)
    Write-Host ''
    Write-Host '  ---------------------------------------------------' -ForegroundColor DarkGray
    foreach ($row in $script:Results) {
        $line = ('  {0,-4} {1,-28} {2,6}s' -f ('[' + $row.Index + ']'), $row.Name, $row.Seconds)
        switch ($row.Status) {
            'PASS' { Write-Host $line -ForegroundColor Green }
            'SKIP' { Write-Host $line -ForegroundColor DarkGray }
            default { Write-Host $line -ForegroundColor Red }
        }
    }
    $failed = @($script:Results | Where-Object { $_.Status -eq 'FAIL' })
    if ($failed.Count -gt 0) {
        Write-Fail ('门禁失败：' + $failed.Count + ' 项未通过（总耗时 ' + $total + ' 秒）')
        exit 1
    }
    Write-Ok ('ALL CHECKS PASSED（总耗时 ' + $total + ' 秒）')
    exit 0
}
catch {
    Write-Host ''
    Write-Fail $_.Exception.Message
    Write-Fail '门禁未通过。'
    exit 1
}
