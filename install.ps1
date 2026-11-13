#requires -Version 5.1
<#
.SYNOPSIS
Installs Freezetime (CS2 demo analyzer) and everything it needs: Git, Python, Node.js, the Python
environment, the built web app, awpy radar images and a desktop shortcut.

.DESCRIPTION
Run it from a checkout of the repository, or download just this file and run it anywhere: it clones
the project into -InstallDir first. Missing tools (Git, Python 3.13, Node.js LTS) are installed with
winget. Re-running the script updates an existing installation (git pull, dependencies, rebuild).

.EXAMPLE
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1

.EXAMPLE
irm https://raw.githubusercontent.com/nfilatoff/freezetime/main/install.ps1 -OutFile install.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -InstallDir 'D:\freezetime'

.EXAMPLE
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -CheckOnly

.NOTES
ASCII source is intentional for Windows PowerShell 5.1.
#>
[CmdletBinding()]
param(
    # Where to clone the project. Ignored when the script is run from inside a checkout.
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'freezetime'),
    [string]$RepositoryUrl = 'https://github.com/nfilatoff/freezetime.git',
    [string]$Branch = 'main',
    # Skip downloading awpy radar images and map data (~30 MB) into ~/.awpy.
    [switch]$SkipRadars,
    # Do not create the desktop shortcut.
    [switch]$NoShortcut,
    # Also install pytest into the environment.
    [switch]$Dev,
    # Start the app when the installation finishes.
    [switch]$Launch,
    # Only report what is installed and what is missing; change nothing.
    [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$ProgressPreference = 'SilentlyContinue'

# The project used to be called cs2lens: keep updating an old default install in place.
$legacyDir = Join-Path $env:LOCALAPPDATA 'cs2lens'
if (-not $PSBoundParameters.ContainsKey('InstallDir') -and -not (Test-Path $InstallDir) -and (Test-Path (Join-Path $legacyDir '.git'))) {
    $InstallDir = $legacyDir
}

function Write-Step([string]$Text) { Write-Host "==> $Text" -ForegroundColor Cyan }
function Write-Ok([string]$Text) { Write-Host "    $Text" -ForegroundColor Green }
function Write-Note([string]$Text) { Write-Host "    $Text" -ForegroundColor Yellow }

function Update-SessionPath {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = (@($machine, $user) | Where-Object { $_ }) -join ';'
}

function Invoke-Native([string]$Exe, [string[]]$Arguments) {
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) { throw "'$Exe $($Arguments -join ' ')' failed with exit code $LASTEXITCODE" }
}

# Returns the path of a Python >= 3.11 interpreter, or $null.
function Find-Python {
    # Probes write to stderr on failure; in PowerShell 5.1 that is a terminating error under 'Stop'.
    $ErrorActionPreference = 'Continue'
    $candidates = @()
    if (Get-Command py -ErrorAction SilentlyContinue) {
        foreach ($v in '3.13', '3.12', '3.11') {
            $exe = & py "-$v" -c 'import sys; print(sys.executable)' 2>$null
            if ($LASTEXITCODE -eq 0 -and $exe) { $candidates += $exe.Trim() }
        }
    }
    foreach ($name in 'python', 'python3') {
        $cmd = Get-Command $name -ErrorAction SilentlyContinue
        # Skip the Microsoft Store alias, which opens the Store instead of running Python.
        if ($cmd -and $cmd.Source -notmatch 'WindowsApps') { $candidates += $cmd.Source }
    }
    foreach ($exe in $candidates) {
        $ok = & $exe -c 'import sys; print(int(sys.version_info >= (3, 11)))' 2>$null
        if ($LASTEXITCODE -eq 0 -and "$ok".Trim() -eq '1') { return $exe }
    }
    return $null
}

function Get-NodeMajor {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return 0 }
    $v = (& node -v) -replace '^v', ''
    return [int]($v.Split('.')[0])
}

function Install-WithWinget([string]$Id, [string]$Name) {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw "$Name is missing and winget is not available. Install $Name manually and run the script again."
    }
    Write-Note "installing $Name with winget ($Id)..."
    Invoke-Native winget @('install', '--id', $Id, '--exact', '--silent', '--accept-package-agreements', '--accept-source-agreements')
    Update-SessionPath
}

# ---------- 1. Tools ----------
Write-Step 'Checking tools'
$hasGit = [bool](Get-Command git -ErrorAction SilentlyContinue)
$python = Find-Python
$nodeMajor = Get-NodeMajor

if ($CheckOnly) {
    Write-Host ("    Git:     " + $(if ($hasGit) { 'ok' } else { 'missing' }))
    Write-Host ("    Python:  " + $(if ($python) { $python } else { 'missing (need >= 3.11)' }))
    Write-Host ("    Node.js: " + $(if ($nodeMajor -ge 20) { "v$nodeMajor" } else { 'missing (need >= 20)' }))
}
else {
    if (-not $hasGit) { Install-WithWinget 'Git.Git' 'Git' }
    if (-not $python) {
        Install-WithWinget 'Python.Python.3.13' 'Python 3.13'
        $python = Find-Python
        if (-not $python) { throw 'Python was installed but is not found yet. Open a new terminal and run the script again.' }
    }
    if ($nodeMajor -lt 20) {
        Install-WithWinget 'OpenJS.NodeJS.LTS' 'Node.js LTS'
        if ((Get-NodeMajor) -lt 20) { throw 'Node.js was installed but is not found yet. Open a new terminal and run the script again.' }
    }
    Write-Ok "Git, Python ($python), Node.js $(& node -v)"
}

# ---------- 2. Source ----------
Write-Step 'Getting the source'
$here = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
if (Test-Path (Join-Path $here 'pyproject.toml')) {
    $root = $here
    Write-Ok "using the checkout at $root"
}
elseif (Test-Path (Join-Path $InstallDir '.git')) {
    $root = $InstallDir
    if (-not $CheckOnly) { Invoke-Native git @('-C', $root, 'pull', '--ff-only') }
    Write-Ok "updated $root"
}
else {
    $root = $InstallDir
    if (-not $CheckOnly) {
        Invoke-Native git @('clone', '--branch', $Branch, $RepositoryUrl, $root)
    }
    Write-Ok "cloned $RepositoryUrl into $root"
}

if ($CheckOnly) {
    $venvOk = Test-Path (Join-Path $root '.venv\Scripts\freezetime.exe')
    $staticOk = Test-Path (Join-Path $root 'freezetime\app\static\index.html')
    $radarsOk = Test-Path (Join-Path $env:USERPROFILE '.awpy')
    Write-Host ("    Python environment: " + $(if ($venvOk) { 'ok' } else { 'not installed' }))
    Write-Host ("    Web app build:      " + $(if ($staticOk) { 'ok' } else { 'not built' }))
    Write-Host ("    awpy radars:        " + $(if ($radarsOk) { 'ok' } else { 'not downloaded' }))
    return
}

# ---------- 3. Python environment ----------
Write-Step 'Python environment (.venv)'
$venvPython = Join-Path $root '.venv\Scripts\python.exe'
if (-not (Test-Path $venvPython)) { Invoke-Native $python @('-m', 'venv', (Join-Path $root '.venv')) }
Invoke-Native $venvPython @('-m', 'pip', 'install', '--quiet', '--upgrade', 'pip')
if (Test-Path (Join-Path $root '.venv\Scripts\cs2lens.exe')) {
    # the package before the rename; its command would point at a folder that no longer exists
    Invoke-Native $venvPython @('-m', 'pip', 'uninstall', '--quiet', '--yes', 'cs2lens')
}
$target = if ($Dev) { "$root[dev]" } else { $root }
Invoke-Native $venvPython @('-m', 'pip', 'install', '--quiet', '-e', $target)
Write-Ok 'Freezetime and dependencies installed'

# ---------- 4. Web app ----------
Write-Step 'Building the web app'
Push-Location (Join-Path $root 'frontend')
try {
    Invoke-Native npm.cmd @('ci', '--no-audit', '--no-fund', '--loglevel=error')
    Invoke-Native npm.cmd @('run', 'build')
}
finally { Pop-Location }
Write-Ok 'built into freezetime\app\static'

# ---------- 5. Radars ----------
if (-not $SkipRadars) {
    Write-Step 'Downloading awpy radars and map data'
    Invoke-Native (Join-Path $root '.venv\Scripts\awpy.exe') @('get')
    Write-Ok 'cached in ~/.awpy'
}

# ---------- 6. Launcher and shortcut ----------
Write-Step 'Launcher'
$launcher = Join-Path $root 'start-freezetime.cmd'
# The launcher rebuilds the web app first when its sources changed (after a git pull or merge).
@"
@echo off
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\ensure-frontend.ps1"
".venv\Scripts\freezetime.exe" app %*
"@ | Set-Content -Path $launcher -Encoding ASCII
Write-Ok $launcher
Remove-Item -LiteralPath (Join-Path $root 'start-cs2lens.cmd') -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('Desktop')) 'cs2lens.lnk') -ErrorAction SilentlyContinue

if (-not $NoShortcut) {
    $desktop = [Environment]::GetFolderPath('Desktop')
    $shell = New-Object -ComObject WScript.Shell
    $lnk = $shell.CreateShortcut((Join-Path $desktop 'Freezetime.lnk'))
    $lnk.TargetPath = $launcher
    $lnk.WorkingDirectory = $root
    $lnk.Description = 'CS2 demo analyzer'
    $lnk.Save()
    Write-Ok 'desktop shortcut Freezetime.lnk'
}

Write-Host ''
Write-Host 'Freezetime is installed.' -ForegroundColor Green
Write-Host "Start it with the desktop shortcut or: $launcher"
Write-Host 'The app opens at http://127.0.0.1:8000'

if ($Launch) { & $launcher }
