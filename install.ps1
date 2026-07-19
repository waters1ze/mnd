# MND installer for Windows PowerShell 5.1+.
# Public usage:
#   irm https://raw.githubusercontent.com/waters1ze/mnd/main/install.ps1 | iex

[CmdletBinding()]
param(
    [string]$InstallRoot = $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA "Programs\MND" } else { "" }),
    [string]$Repository = "waters1ze/mnd",
    [string]$Branch = "main",
    [string]$SourceArchive = "",
    [switch]$SkipPython,
    [switch]$SkipPath
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

function Write-Step([string]$Message) {
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Assert-LastExitCode([string]$Action) {
    if ($LASTEXITCODE -ne 0) {
        throw "$Action failed with exit code $LASTEXITCODE."
    }
}

function Get-RequiredCommand([string[]]$Names, [string]$InstallHint) {
    foreach ($name in $Names) {
        $command = Get-Command $name -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($command) { return $command.Source }
    }
    throw "$($Names[0]) was not found. $InstallHint"
}

function Get-PythonCommand {
    $py = Get-Command "py.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($py) {
        return @{ File = $py.Source; Prefix = @("-3") }
    }

    foreach ($name in @("python.exe", "python")) {
        $python = Get-Command $name -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($python) {
            return @{ File = $python.Source; Prefix = @() }
        }
    }

    return $null
}

function Add-UserPath([string]$Directory) {
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($null -eq $userPath) { $userPath = "" }

    $normalizedDirectory = $Directory.TrimEnd("\")
    $alreadyPresent = @($userPath -split ";") | Where-Object {
        $_ -and $_.Trim().TrimEnd("\").Equals($normalizedDirectory, [StringComparison]::OrdinalIgnoreCase)
    }

    if (-not $alreadyPresent) {
        $newPath = if ([string]::IsNullOrWhiteSpace($userPath)) {
            $Directory
        } else {
            "$($userPath.TrimEnd(';'));$Directory"
        }
        [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
        Write-Host "Added to user PATH: $Directory" -ForegroundColor Green
    } else {
        Write-Host "User PATH already contains: $Directory" -ForegroundColor DarkGray
    }

    $currentEntries = @($env:Path -split ";")
    $availableNow = $currentEntries | Where-Object {
        $_ -and $_.Trim().TrimEnd("\").Equals($normalizedDirectory, [StringComparison]::OrdinalIgnoreCase)
    }
    if (-not $availableNow) {
        $env:Path = "$Directory;$env:Path"
    }
}

if (-not $InstallRoot) {
    throw "LOCALAPPDATA is unavailable. Run install.ps1 with an explicit -InstallRoot."
}
if ($Repository -notmatch "^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$") {
    throw "Invalid GitHub repository name: $Repository"
}
if ($Branch -notmatch "^[A-Za-z0-9._/-]+$") {
    throw "Invalid Git branch name: $Branch"
}

$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$installDriveRoot = [IO.Path]::GetPathRoot($InstallRoot)
if ($InstallRoot.TrimEnd("\") -eq $installDriveRoot.TrimEnd("\")) {
    throw "InstallRoot cannot be a drive root."
}

$appDirectory = Join-Path $InstallRoot "app"
$binDirectory = Join-Path $InstallRoot "bin"
$pythonDirectory = Join-Path $InstallRoot "python"
$launcherPath = Join-Path $binDirectory "mnd.cmd"
$workDirectory = Join-Path ([IO.Path]::GetTempPath()) ("mnd-install-" + [Guid]::NewGuid().ToString("N"))
$archivePath = Join-Path $workDirectory "mnd.zip"
$extractDirectory = Join-Path $workDirectory "source"

Write-Host ""
Write-Host "  MND installer" -ForegroundColor Magenta
Write-Host "  AI-assisted video editing for DaVinci Resolve" -ForegroundColor DarkGray
Write-Host "  Install directory: $InstallRoot" -ForegroundColor DarkGray

$nodeCommand = Get-RequiredCommand @("node.exe", "node") "Install Node.js 20+ from https://nodejs.org/ and run this command again."
$nodeVersionText = (& $nodeCommand --version).Trim().TrimStart("v")
try { $nodeVersion = [Version]$nodeVersionText } catch { throw "Cannot parse Node.js version: $nodeVersionText" }
if ($nodeVersion.Major -lt 20) {
    throw "MND requires Node.js 20 or newer; found $nodeVersionText."
}
$npmCommand = Get-RequiredCommand @("npm.cmd", "npm") "Install npm with Node.js and run this command again."

New-Item -ItemType Directory -Path $workDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $extractDirectory -Force | Out-Null

try {
    Write-Step "Downloading MND"
    if ($SourceArchive) {
        $resolvedArchive = (Resolve-Path -LiteralPath $SourceArchive).Path
        Copy-Item -LiteralPath $resolvedArchive -Destination $archivePath
        Write-Host "Using local archive: $resolvedArchive" -ForegroundColor DarkGray
    } else {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $downloadUrl = "https://github.com/$Repository/archive/refs/heads/$Branch.zip"
        Invoke-WebRequest -UseBasicParsing -Uri $downloadUrl -OutFile $archivePath
        Write-Host "Downloaded: $downloadUrl" -ForegroundColor DarkGray
    }

    Write-Step "Checking and extracting the archive"
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $extractRoot = [IO.Path]::GetFullPath($extractDirectory).TrimEnd("\") + "\"
    $zip = [IO.Compression.ZipFile]::OpenRead($archivePath)
    try {
        foreach ($entry in $zip.Entries) {
            $target = [IO.Path]::GetFullPath((Join-Path $extractDirectory $entry.FullName))
            if (-not $target.StartsWith($extractRoot, [StringComparison]::OrdinalIgnoreCase)) {
                throw "Unsafe archive entry rejected: $($entry.FullName)"
            }
        }
    } finally {
        $zip.Dispose()
    }
    [IO.Compression.ZipFile]::ExtractToDirectory($archivePath, $extractDirectory)

    $package = Get-ChildItem -LiteralPath $extractDirectory -Filter "package.json" -File -Recurse |
        Where-Object {
            Test-Path -LiteralPath (Join-Path $_.Directory.FullName "src\index.ts")
        } |
        Sort-Object { $_.FullName.Length } |
        Select-Object -First 1
    if (-not $package) {
        throw "The archive does not contain a valid MND source tree."
    }
    $sourceDirectory = $package.Directory.FullName

    Write-Step "Installing Node.js dependencies"
    Push-Location $sourceDirectory
    try {
        # MND's installer needs development dependencies to compile TypeScript.
        # Keep npm's transitive deprecation notices out of the normal installer
        # output; installation failures still use npm's error-level output and
        # stop the installer through Assert-LastExitCode below.
        & $npmCommand install --workspaces=false --include=dev --no-audit --no-fund --loglevel=error
        Assert-LastExitCode "npm install"

        Write-Step "Building MND"
        & $npmCommand run build
        Assert-LastExitCode "npm run build"
    } finally {
        Pop-Location
    }
    if (-not (Test-Path -LiteralPath (Join-Path $sourceDirectory "dist\index.js"))) {
        throw "Build completed without dist\index.js. Installation stopped."
    }

    Write-Step "Activating the new build"
    New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
    $backupDirectory = Join-Path $InstallRoot "app.previous"
    if (Test-Path -LiteralPath $backupDirectory) {
        Remove-Item -LiteralPath $backupDirectory -Recurse -Force
    }
    if (Test-Path -LiteralPath $appDirectory) {
        Move-Item -LiteralPath $appDirectory -Destination $backupDirectory
    }

    try {
        Move-Item -LiteralPath $sourceDirectory -Destination $appDirectory
    } catch {
        if ((-not (Test-Path -LiteralPath $appDirectory)) -and (Test-Path -LiteralPath $backupDirectory)) {
            Move-Item -LiteralPath $backupDirectory -Destination $appDirectory
        }
        throw
    }
    if (Test-Path -LiteralPath $backupDirectory) {
        Remove-Item -LiteralPath $backupDirectory -Recurse -Force
    }

    if (-not $SkipPython) {
        Write-Step "Preparing the private Python environment"
        $privatePython = Join-Path $pythonDirectory "Scripts\python.exe"
        $createdPrivatePython = $false
        try {
            if (Test-Path -LiteralPath $privatePython) {
                Write-Host "Reusing the existing private Python environment." -ForegroundColor DarkGray
            } else {
                $python = Get-PythonCommand
                if (-not $python) {
                    Write-Warning "Python 3.10+ was not found. MND is installed, but local transcription needs Python."
                } else {
                    $pythonFile = [string]$python.File
                    $pythonPrefix = [string[]]$python.Prefix
                    $versionCode = "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
                    $pythonVersionText = (& $pythonFile @pythonPrefix -c $versionCode).Trim()
                    try { $pythonVersion = [Version]$pythonVersionText } catch { $pythonVersion = [Version]"0.0" }
                    if ($pythonVersion -lt [Version]"3.10") {
                        Write-Warning "Python $pythonVersionText is too old. Local transcription needs Python 3.10+."
                    } else {
                        if (Test-Path -LiteralPath $pythonDirectory) {
                            Remove-Item -LiteralPath $pythonDirectory -Recurse -Force
                        }
                        & $pythonFile @pythonPrefix -m venv $pythonDirectory
                        Assert-LastExitCode "python -m venv"
                        $createdPrivatePython = $true
                    }
                }
            }

            if (Test-Path -LiteralPath $privatePython) {
                & $privatePython -m pip install --disable-pip-version-check -r (Join-Path $appDirectory "sidecar\requirements.txt")
                Assert-LastExitCode "Python dependency installation"
                Write-Host "Private Python environment is ready." -ForegroundColor Green
            }
        } catch {
            if ($createdPrivatePython -and (Test-Path -LiteralPath $pythonDirectory)) {
                Remove-Item -LiteralPath $pythonDirectory -Recurse -Force
            }
            Write-Warning "Local transcription dependencies could not be installed: $($_.Exception.Message)"
        }
    }

    Write-Step "Creating the global mnd command"
    New-Item -ItemType Directory -Path $binDirectory -Force | Out-Null
    $launcher = @'
@echo off
set "MND_INSTALL_ROOT=%~dp0.."
if exist "%~dp0..\python\Scripts\python.exe" set "MND_PYTHON_PATH=%~dp0..\python\Scripts\python.exe"
node "%~dp0..\app\dist\index.js" %*
'@
    [IO.File]::WriteAllText($launcherPath, $launcher, [Text.Encoding]::ASCII)

    if (-not $SkipPath) {
        Add-UserPath $binDirectory
    }

    Write-Step "Verifying the launcher"
    & $launcherPath --help
    Assert-LastExitCode "mnd --help"

    Write-Host "`nMND was installed successfully." -ForegroundColor Green
    Write-Host "Run from any directory:" -ForegroundColor White
    Write-Host "  mnd" -ForegroundColor Magenta
    Write-Host "  mnd doctor --full" -ForegroundColor Magenta
    $agyDefaultPath = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA "agy\bin\agy.exe" } else { "" }
    $agyInstalled = (Get-Command "agy" -ErrorAction SilentlyContinue) -or ($agyDefaultPath -and (Test-Path -LiteralPath $agyDefaultPath))
    if (-not $agyInstalled) {
        Write-Host "`nAntigravity CLI was not found. Install it separately when needed:" -ForegroundColor Yellow
        Write-Host "  irm https://antigravity.google/cli/install.ps1 | iex" -ForegroundColor Yellow
    } elseif (-not (Get-Command "agy" -ErrorAction SilentlyContinue)) {
        Write-Host "`nAntigravity CLI found at: $agyDefaultPath" -ForegroundColor Green
        Write-Host "MND will discover it automatically even if agy is not in PATH." -ForegroundColor DarkGray
    }
} finally {
    if (Test-Path -LiteralPath $workDirectory) {
        Remove-Item -LiteralPath $workDirectory -Recurse -Force
    }
}
