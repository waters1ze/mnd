# Runs before MND starts. It compares the installed commit with GitHub main and
# invokes the verified installer only when a newer commit is published.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$InstallRoot,
    [string]$Repository = "waters1ze/mnd",
    [string]$Branch = "main"
)

$ErrorActionPreference = "Stop"

if ($env:MND_SKIP_UPDATE -eq "1") { return }
if ($Repository -notmatch "^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$" -or $Branch -notmatch "^[A-Za-z0-9._/-]+$") { return }

try {
    $markerPath = Join-Path $InstallRoot "app\.mnd-update.json"
    $installed = if (Test-Path -LiteralPath $markerPath) {
        (Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json).commit
    } else { "" }

    $headers = @{ "User-Agent" = "MND-Updater"; "Accept" = "application/vnd.github+json" }
    $remote = Invoke-RestMethod -Headers $headers -Uri "https://api.github.com/repos/$Repository/commits/$Branch"
    $commit = [string]$remote.sha
    if ($commit -notmatch "^[a-f0-9]{40}$" -or $commit -eq $installed) { return }

    Write-Host "MND update found. Downloading and building the new version..." -ForegroundColor Cyan
    $env:MND_SKIP_UPDATE = "1"
    $installer = Join-Path $InstallRoot "app\install.ps1"
    if (-not (Test-Path -LiteralPath $installer)) { throw "The installed update script is missing." }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer -InstallRoot $InstallRoot -Repository $Repository -Branch $Branch -ExpectedCommit $commit
    if ($LASTEXITCODE -ne 0) { throw "Update installer failed with exit code $LASTEXITCODE." }
    Write-Host "MND update is ready." -ForegroundColor Green
} catch {
    # A network or update failure must never prevent the current MND build from starting.
    Write-Host "MND update check skipped: $($_.Exception.Message)" -ForegroundColor DarkGray
}
