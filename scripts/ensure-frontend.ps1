#requires -Version 5.1
<#
.SYNOPSIS
Rebuilds the web app (frontend/ -> freezetime/app/static) when its sources are newer than the build.

.DESCRIPTION
Called by start-freezetime.cmd before the app starts, so a git pull or merge that changes the
frontend never leaves the app serving a stale build. Runs `npm ci` when frontend/node_modules is
missing or older than package.json / package-lock.json, and `npm run build` when the build is
missing or any frontend source is newer than freezetime/app/static/index.html.

The script never stops the app from starting: it always exits with code 0. When a build fails, the
previous build is restored and a warning is printed. Without a frontend/ folder (not a source
checkout) it does nothing.

.EXAMPLE
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\ensure-frontend.ps1

.EXAMPLE
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\ensure-frontend.ps1 -Force -Verbose

.NOTES
ASCII source is intentional for Windows PowerShell 5.1.
#>
[CmdletBinding()]
param(
    # Rebuild even when the build looks up to date.
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Write-Status([string]$Text) { Write-Host "[web app] $Text" -ForegroundColor Cyan }
function Write-Warn([string]$Text) { Write-Host "[web app] $Text" -ForegroundColor Yellow }

# Newest LastWriteTimeUtc (in ticks) of the given files; 0 when there are none.
function Get-NewestTicks($Files) {
    $max = [long]0
    foreach ($f in $Files) {
        if ($f.LastWriteTimeUtc.Ticks -gt $max) { $max = $f.LastWriteTimeUtc.Ticks }
    }
    return $max
}

# Runs npm.cmd with its output shown; returns $true on exit code 0.
function Invoke-Npm([string[]]$Arguments) {
    $ErrorActionPreference = 'Continue'
    # npm and vite write UTF-8; PowerShell 5.1 would decode their piped output with the OEM code page.
    # Without a console handle these calls throw; the build then runs without the encoding change.
    $previousEncoding = $null
    try {
        $previousEncoding = [Console]::OutputEncoding
        [Console]::OutputEncoding = [Text.Encoding]::UTF8
    }
    catch { Write-Verbose "could not switch the console to UTF-8: $($_.Exception.Message)" }
    try {
        # Out-Host: show npm's output instead of returning it from the function.
        & npm.cmd @Arguments | Out-Host
        $code = $LASTEXITCODE
    }
    finally {
        if ($null -ne $previousEncoding) {
            try { [Console]::OutputEncoding = $previousEncoding }
            catch { Write-Verbose "could not restore the console encoding: $($_.Exception.Message)" }
        }
    }
    return ($code -eq 0)
}

try {
    $root = [IO.Path]::GetDirectoryName($PSScriptRoot)
    $frontend = Join-Path $root 'frontend'
    $static = Join-Path $root 'freezetime\app\static'
    $backup = Join-Path $root 'freezetime\app\static.prev'
    $builtIndex = Join-Path $static 'index.html'

    if (-not (Test-Path -LiteralPath (Join-Path $frontend 'package.json'))) {
        Write-Verbose 'no frontend sources here; nothing to build'
        exit 0
    }

    # A leftover backup means the last build did not finish, so `static` may be partial (vite may
    # have stopped while writing). Bring a valid backup back and rebuild; drop an invalid one.
    $forceBuild = [bool]$Force
    if (Test-Path -LiteralPath $backup) {
        if (Test-Path -LiteralPath (Join-Path $backup 'index.html')) {
            if (Test-Path -LiteralPath $static) { Remove-Item -LiteralPath $static -Recurse -Force }
            Rename-Item -LiteralPath $backup -NewName 'static'
            $forceBuild = $true
        }
        else { Remove-Item -LiteralPath $backup -Recurse -Force }
    }
    $hasBuild = Test-Path -LiteralPath $builtIndex

    if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
        if ($hasBuild) {
            Write-Warn 'Node.js (npm) is not on PATH: the web app build cannot be refreshed, using the existing one.'
        }
        else {
            Write-Warn 'The web app is not built and Node.js (npm) is not on PATH.'
            Write-Warn 'Install Node.js LTS (winget install OpenJS.NodeJS.LTS), open a new terminal and start again,'
            Write-Warn 'or run install.ps1, or build by hand: cd frontend; npm ci; npm run build'
        }
        exit 0
    }

    # ---------- Dependencies ----------
    $lockFiles = @(Get-ChildItem -LiteralPath $frontend -File | Where-Object { $_.Name -eq 'package.json' -or $_.Name -eq 'package-lock.json' })
    $installed = Join-Path $frontend 'node_modules\.package-lock.json'
    $needInstall = -not (Test-Path -LiteralPath $installed)
    if (-not $needInstall) {
        $needInstall = (Get-NewestTicks $lockFiles) -gt (Get-Item -LiteralPath $installed).LastWriteTimeUtc.Ticks
    }

    $installedNow = $false
    if ($needInstall) {
        Write-Status 'Installing web app dependencies (npm ci)...'
        Push-Location -LiteralPath $frontend
        try { $ok = Invoke-Npm @('ci', '--no-audit', '--no-fund', '--loglevel=error') }
        finally { Pop-Location }
        if (-not $ok) {
            if ($hasBuild) { Write-Warn 'npm ci failed: keeping the previous web app build.' }
            else { Write-Warn 'npm ci failed: the web app is not built.' }
            exit 0
        }
        $installedNow = $true
    }

    # ---------- Build ----------
    $needBuild = $forceBuild -or $installedNow -or (-not $hasBuild)
    if (-not $needBuild) {
        $inputs = @()
        $inputs += Get-ChildItem -LiteralPath (Join-Path $frontend 'src') -Recurse -File
        $inputs += Get-ChildItem -LiteralPath $frontend -File | Where-Object {
            $_.Name -eq 'index.html' -or $_.Name -eq 'package.json' -or $_.Name -eq 'package-lock.json' -or
            $_.Name -like 'vite.config.*' -or $_.Name -like 'tsconfig*.json'
        }
        $public = Join-Path $frontend 'public'
        if (Test-Path -LiteralPath $public) { $inputs += Get-ChildItem -LiteralPath $public -Recurse -File }
        $needBuild = (Get-NewestTicks $inputs) -gt (Get-Item -LiteralPath $builtIndex).LastWriteTimeUtc.Ticks
    }
    if (-not $needBuild) {
        Write-Verbose 'web app build is up to date'
        exit 0
    }

    # vite empties freezetime/app/static before writing (emptyOutDir). tsc runs first and stops
    # type errors before that, but a failing vite step would leave the folder empty, so the
    # previous build is moved aside and restored if the build fails.
    $movedAside = $false
    if ($hasBuild) {
        try {
            Rename-Item -LiteralPath $static -NewName 'static.prev'
            $movedAside = $true
        }
        catch { Write-Verbose "could not move the previous build aside: $($_.Exception.Message)" }
    }

    # Whatever happens from here on (a failed build or an exception), the finally block puts the
    # previous build back unless the new one is complete.
    $built = $false
    try {
        Write-Status 'Building the web app...'
        Push-Location -LiteralPath $frontend
        try { $ok = Invoke-Npm @('run', 'build') }
        finally { Pop-Location }
        $built = $ok -and (Test-Path -LiteralPath $builtIndex)
    }
    finally {
        if ($built) {
            if ($movedAside) { Remove-Item -LiteralPath $backup -Recurse -Force -ErrorAction SilentlyContinue }
            Write-Status 'Web app built.'
        }
        elseif ($movedAside) {
            try {
                if (Test-Path -LiteralPath $static) { Remove-Item -LiteralPath $static -Recurse -Force }
                Rename-Item -LiteralPath $backup -NewName 'static'
                Write-Warn 'Web app build failed: keeping the previous build. Fix the errors above and start again.'
            }
            catch {
                # The next start restores it (a leftover static.prev with index.html wins).
                Write-Warn "Web app build failed and the previous build could not be put back from static.prev: $($_.Exception.Message)"
            }
        }
        elseif ($hasBuild) {
            Write-Warn 'Web app build failed (see the errors above).'
        }
        else {
            Write-Warn 'Web app build failed: the web app is not built. Fix the errors above and start again.'
        }
    }
    exit 0
}
catch {
    Write-Warn "Could not check the web app build: $($_.Exception.Message)"
    exit 0
}
