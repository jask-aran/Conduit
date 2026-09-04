[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Command = "restart",

  [Parameter(Position = 1, ValueFromRemainingArguments = $true)]
  [string[]]$CommandArguments = @()
)

$ErrorActionPreference = "Stop"

$launcherDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$root = Split-Path -Parent $launcherDir
$webDir = Join-Path $root "conduit-web"
$workingFilesDir = Join-Path $root "working-files"
$uvVersion = "0.11.29"
$userProfile = [Environment]::GetFolderPath("UserProfile")
$stateDir = if ([string]::IsNullOrWhiteSpace($env:CONDUIT_STATE_DIR)) {
  Join-Path $userProfile ".conduit"
} else {
  $env:CONDUIT_STATE_DIR
}

$pidFile = Join-Path $stateDir "conduit.pid"
$logFile = Join-Path $stateDir "conduit.log"
$errorLogFile = Join-Path $stateDir "conduit-error.log"
$vitePidFile = Join-Path $stateDir "conduit-vite.pid"
$viteLogFile = Join-Path $stateDir "conduit-vite.log"
$viteErrorLogFile = Join-Path $stateDir "conduit-vite-error.log"
$solidComponentsStateFile = Join-Path $stateDir "solid-components-workbench.json"
$dataRoot = if ([string]::IsNullOrWhiteSpace($env:CONDUIT_DATA_ROOT)) {
  Join-Path $root "data"
} else {
  $env:CONDUIT_DATA_ROOT
}
$toolchainRoot = Join-Path $dataRoot "toolchains"
$uvInstallDir = Join-Path $toolchainRoot "uv\$uvVersion"
$uvCommand = Join-Path $uvInstallDir "uv.exe"
$uvCacheDir = Join-Path $toolchainRoot "uv-cache"
$uvPythonInstallDir = Join-Path $toolchainRoot "python"

function Show-ExecutionPolicyGuidance {
  $currentUserPolicy = Get-ExecutionPolicy -Scope CurrentUser
  if ($currentUserPolicy -in @("RemoteSigned", "Unrestricted", "Bypass")) { return }

  Write-Warning "PowerShell CurrentUser execution policy is '$currentUserPolicy'."
  Write-Output "To allow direct execution of local PowerShell scripts for your user, run:"
  Write-Output "  Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned"
  Write-Output "If you do not want to change the policy permanently, run this launcher with:"
  Write-Output "  powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.devcontainer\win-start-conduit.ps1 <command>"
}

Show-ExecutionPolicyGuidance

function Resolve-Executable {
  param(
    [Parameter(Mandatory = $true)] [string]$Name,
    [Parameter(Mandatory = $true)] [string]$Fallback
  )

  $command = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($command) { return $command.Source }
  if (Test-Path -LiteralPath $Fallback) { return $Fallback }
  throw "Conduit requires $Name. Install Node.js 22+ and ensure it is on PATH."
}

$nodeCommand = Resolve-Executable "node.exe" (Join-Path ${env:ProgramFiles} "nodejs\node.exe")
$npmCommand = Resolve-Executable "npm.cmd" (Join-Path ${env:ProgramFiles} "nodejs\npm.cmd")
$nodeDirectory = Split-Path -Parent $nodeCommand
if (-not (($env:Path -split [IO.Path]::PathSeparator) -contains $nodeDirectory)) {
  $env:Path = "$nodeDirectory$([IO.Path]::PathSeparator)$env:Path"
}

function Set-DefaultEnvironment {
  param(
    [Parameter(Mandatory = $true)] [string]$Name,
    [Parameter(Mandatory = $true)] [string]$Value
  )

  $current = (Get-Item -Path "Env:$Name" -ErrorAction SilentlyContinue).Value
  if ([string]::IsNullOrWhiteSpace($current)) {
    Set-Item -Path "Env:$Name" -Value $Value
  }
}

Set-DefaultEnvironment "CONDUIT_HOST" "0.0.0.0"
Set-DefaultEnvironment "CONDUIT_PORT" "4310"
Set-DefaultEnvironment "CONDUIT_VITE_PORT" "5173"
Set-DefaultEnvironment "CONDUIT_VITE_HOST" "0.0.0.0"
Set-DefaultEnvironment "CONDUIT_FILES_ROOT" (Join-Path $root "data\chat\files")
Set-DefaultEnvironment "CONDUIT_CATALOG_FILE" (Join-Path $root "data\conduit.json")
Set-DefaultEnvironment "CONDUIT_SESSION_REGISTRY_FILE" (Join-Path $root "data\sessions.json")
Set-DefaultEnvironment "CONDUIT_PI_AGENT_DIR" (Join-Path $root "data\pi")
Set-DefaultEnvironment "CONDUIT_PI_TEMPLATE" (Join-Path $root "templates\chat\template.json")
$healthUrl = "http://127.0.0.1:$($env:CONDUIT_PORT)/healthz"

function Prepare-Directories {
  try {
    foreach ($directory in @($stateDir, $env:CONDUIT_FILES_ROOT, $env:CONDUIT_PI_AGENT_DIR)) {
      New-Item -ItemType Directory -Force -Path $directory | Out-Null
    }
  } catch {
    throw "Conduit cannot create its state directories. Set CONDUIT_STATE_DIR to a writable directory. $($_.Exception.Message)"
  }
}

function Guard-ComponentMode {
  if ((Test-Path -LiteralPath $solidComponentsStateFile) -and $env:CONDUIT_SOLID_COMPONENTS_MANAGED -ne "1") {
    throw "A local solid-components mode is active. Use .devcontainer\solid-components.sh status, or set CONDUIT_SOLID_COMPONENTS_MANAGED=1 for a managed component run."
  }
}

function Invoke-Npm {
  param([Parameter(Mandatory = $true)] [string[]]$Arguments)

  Push-Location $webDir
  try {
    & $npmCommand @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "npm $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
    }
  } finally {
    Pop-Location
  }
}

function Require-Dependencies {
  if (-not (Test-Path -LiteralPath (Join-Path $webDir "node_modules\.bin\vite.cmd"))) {
    throw "Conduit dependencies are not installed. Run: .\.devcontainer\win-start-conduit.ps1 setup"
  }
  if (-not (Test-Path -LiteralPath (Join-Path $workingFilesDir ".venv\Scripts\python.exe"))) {
    throw "Conduit's managed Python environment is not installed. Run: .\.devcontainer\win-start-conduit.ps1 setup"
  }
}

function Test-Healthy {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 2
    return [int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 300
  } catch {
    return $false
  }
}

function Get-ProcessRecord {
  param(
    [Parameter(Mandatory = $true)] [string]$File,
    [Parameter(Mandatory = $true)] [ValidateSet("server", "vite")] [string]$Kind
  )

  if (-not (Test-Path -LiteralPath $File)) { return $null }
  $rawPid = (Get-Content -LiteralPath $File -Raw).Trim()
  $processId = 0
  if (-not [int]::TryParse($rawPid, [ref]$processId) -or $processId -le 0) {
    Remove-Item -LiteralPath $File -Force -ErrorAction SilentlyContinue
    return $null
  }

  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
  if (-not $process) {
    Remove-Item -LiteralPath $File -Force -ErrorAction SilentlyContinue
    return $null
  }

  $commandLine = [string]$process.CommandLine
  $matchesKind = if ($Kind -eq "server") {
    $commandLine -match "src[\\/]server\.js"
  } else {
    $commandLine -match "vite[\\/]bin[\\/]vite\.js"
  }
  if (-not $matchesKind) {
    Remove-Item -LiteralPath $File -Force -ErrorAction SilentlyContinue
    return $null
  }
  return $process
}

function Stop-ManagedProcess {
  param(
    [Parameter(Mandatory = $true)] [string]$Label,
    [Parameter(Mandatory = $true)] [int]$ProcessId,
    [Parameter(Mandatory = $true)] [string]$File
  )

  Write-Output "Stopping $Label (PID $ProcessId)."
  Stop-Process -Id $ProcessId -ErrorAction SilentlyContinue
  $deadline = (Get-Date).AddSeconds(10)
  while ((Get-Date) -lt $deadline) {
    if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) {
      Remove-Item -LiteralPath $File -Force -ErrorAction SilentlyContinue
      return
    }
    Start-Sleep -Milliseconds 500
  }

  Write-Warning "$Label did not stop gracefully; terminating its process tree."
  & taskkill.exe /PID $ProcessId /T /F | Out-Null
  Remove-Item -LiteralPath $File -Force -ErrorAction SilentlyContinue
}

function Start-NodeProcess {
  param(
    [Parameter(Mandatory = $true)] [string[]]$Arguments,
    [Parameter(Mandatory = $true)] [string]$OutputLog,
    [Parameter(Mandatory = $true)] [string]$ErrorLog
  )

  New-Item -ItemType File -Force -Path $OutputLog | Out-Null
  New-Item -ItemType File -Force -Path $ErrorLog | Out-Null
  return Start-Process -FilePath $nodeCommand -ArgumentList $Arguments -WorkingDirectory $webDir -RedirectStandardOutput $OutputLog -RedirectStandardError $ErrorLog -WindowStyle Hidden -PassThru
}

function Show-StartupLogs {
  foreach ($file in @($logFile, $errorLogFile, $viteLogFile, $viteErrorLogFile)) {
    if (Test-Path -LiteralPath $file) {
      Write-Output "--- $file ---"
      Get-Content -LiteralPath $file -Tail 100
    }
  }
}

function Start-Server {
  param([switch]$Watch)

  Prepare-Directories
  Require-Dependencies
  if (-not $Watch -and -not (Test-Path -LiteralPath (Join-Path $webDir "dist\index.html"))) {
    throw "No production build found. Run: .\.devcontainer\win-start-conduit.ps1 build"
  }

  $existing = Get-ProcessRecord $pidFile "server"
  if ($existing) {
    Write-Output "Conduit is already managed as PID $($existing.ProcessId) on port $($env:CONDUIT_PORT)."
    return
  }

  $arguments = if ($Watch) { @("--watch", "src/server.js") } else { @("src/server.js") }
  $process = Start-NodeProcess $arguments $logFile $errorLogFile
  Set-Content -LiteralPath $pidFile -Value $process.Id -NoNewline

  for ($attempt = 1; $attempt -le 60; $attempt += 1) {
    if (Test-Healthy) {
      Write-Output "Conduit is ready on port $($env:CONDUIT_PORT) (PID $($process.Id))."
      Write-Output "Logs: $logFile"
      return
    }
    if (-not (Get-Process -Id $process.Id -ErrorAction SilentlyContinue)) {
      Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
      Show-StartupLogs
      throw "Conduit failed to start."
    }
    Start-Sleep -Seconds 1
  }

  Show-StartupLogs
  throw "Conduit did not become healthy within 60 seconds."
}

function Start-Vite {
  Require-Dependencies
  $existing = Get-ProcessRecord $vitePidFile "vite"
  if ($existing) {
    Write-Output "Vite is already managed as PID $($existing.ProcessId) on port $($env:CONDUIT_VITE_PORT)."
    return
  }

  $viteEntry = Join-Path $webDir "node_modules\vite\bin\vite.js"
  if (-not (Test-Path -LiteralPath $viteEntry)) { throw "Vite entry point is missing: $viteEntry" }
  $arguments = @($viteEntry, "--host", $env:CONDUIT_VITE_HOST, "--port", $env:CONDUIT_VITE_PORT)
  $process = Start-NodeProcess $arguments $viteLogFile $viteErrorLogFile
  Set-Content -LiteralPath $vitePidFile -Value $process.Id -NoNewline

  $viteUrl = "http://127.0.0.1:$($env:CONDUIT_VITE_PORT)/"
  for ($attempt = 1; $attempt -le 30; $attempt += 1) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $viteUrl -TimeoutSec 2
      if ([int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 500) {
        Write-Output "Vite hot reload is ready on port $($env:CONDUIT_VITE_PORT) (PID $($process.Id))."
        Write-Output "Logs: $viteLogFile"
        return
      }
    } catch { }
    if (-not (Get-Process -Id $process.Id -ErrorAction SilentlyContinue)) {
      Remove-Item -LiteralPath $vitePidFile -Force -ErrorAction SilentlyContinue
      Show-StartupLogs
      throw "Vite failed to start."
    }
    Start-Sleep -Seconds 1
  }

  Show-StartupLogs
  throw "Vite did not become ready within 30 seconds."
}

function Stop-All {
  Prepare-Directories
  $vite = Get-ProcessRecord $vitePidFile "vite"
  if ($vite) { Stop-ManagedProcess "Vite" $vite.ProcessId $vitePidFile }
  $server = Get-ProcessRecord $pidFile "server"
  if ($server) {
    Stop-ManagedProcess "Conduit" $server.ProcessId $pidFile
  } elseif (Test-Healthy) {
    throw "A healthy Conduit server is running on port $($env:CONDUIT_PORT), but this launcher does not manage it. Stop that server before using this launcher."
  } else {
    Write-Output "Conduit is not running."
  }
  & $nodeCommand (Join-Path $root "scripts\terminal-lifecycle.mjs")
  if ($LASTEXITCODE -ne 0) {
    throw "Terminal session cleanup failed with exit code $LASTEXITCODE."
  }
}

function Build {
  Require-Dependencies
  Write-Output "Building the production Conduit client."
  Invoke-Npm @("run", "build")
}

function Build-IfNeeded {
  Require-Dependencies
  $distIndex = Join-Path $webDir "dist\index.html"
  if (-not (Test-Path -LiteralPath $distIndex)) {
    Build
    return
  }

  $distTime = (Get-Item -LiteralPath $distIndex).LastWriteTimeUtc
  $inputs = @(
    (Join-Path $webDir "index.html"),
    (Join-Path $webDir "vite.config.js"),
    (Join-Path $webDir "package.json"),
    (Join-Path $webDir "package-lock.json")
  )
  $srcDir = Join-Path $webDir "src"
  if (Test-Path -LiteralPath $srcDir) {
    $inputs += Get-ChildItem -LiteralPath $srcDir -File -Recurse
  }
  $changed = $inputs | Where-Object {
    $item = if ($_ -is [string]) { Get-Item -LiteralPath $_ -ErrorAction SilentlyContinue } else { $_ }
    $item -and $item.LastWriteTimeUtc -gt $distTime
  } | Select-Object -First 1
  if ($changed) { Build }
}

function Setup {
  Prepare-Directories
  if (-not (Test-Path -LiteralPath $uvCommand)) {
    Write-Output "Installing Conduit's pinned uv $uvVersion runtime."
    New-Item -ItemType Directory -Force -Path $uvInstallDir | Out-Null
    $previousInstallDir = [Environment]::GetEnvironmentVariable("UV_UNMANAGED_INSTALL", "Process")
    try {
      [Environment]::SetEnvironmentVariable("UV_UNMANAGED_INSTALL", $uvInstallDir, "Process")
      $installer = Invoke-RestMethod -Uri "https://astral.sh/uv/$uvVersion/install.ps1"
      $null = Invoke-Expression $installer
    } finally {
      [Environment]::SetEnvironmentVariable("UV_UNMANAGED_INSTALL", $previousInstallDir, "Process")
    }
  }
  if (-not (Test-Path -LiteralPath $uvCommand)) {
    throw "Conduit's managed uv installation is missing: $uvCommand"
  }
  Write-Output "Installing Conduit's web, bundled Isolated Pi, and managed Python dependencies."
  $previousCacheDir = [Environment]::GetEnvironmentVariable("UV_CACHE_DIR", "Process")
  $previousPythonInstallDir = [Environment]::GetEnvironmentVariable("UV_PYTHON_INSTALL_DIR", "Process")
  try {
    [Environment]::SetEnvironmentVariable("UV_CACHE_DIR", $uvCacheDir, "Process")
    [Environment]::SetEnvironmentVariable("UV_PYTHON_INSTALL_DIR", $uvPythonInstallDir, "Process")
    & $uvCommand sync --project $workingFilesDir --locked --no-dev --no-install-project --python 3.13 --managed-python
    if ($LASTEXITCODE -ne 0) {
      throw "uv sync failed with exit code $LASTEXITCODE."
    }
  } finally {
    [Environment]::SetEnvironmentVariable("UV_CACHE_DIR", $previousCacheDir, "Process")
    [Environment]::SetEnvironmentVariable("UV_PYTHON_INSTALL_DIR", $previousPythonInstallDir, "Process")
  }
  $previousPath = $env:Path
  try {
    $env:Path = "$(Join-Path $workingFilesDir '.venv\Scripts')$([IO.Path]::PathSeparator)$previousPath"
    Invoke-Npm @("ci")
  } finally {
    $env:Path = $previousPath
  }
}

function Show-Status {
  Prepare-Directories
  $server = Get-ProcessRecord $pidFile "server"
  if (-not $server) {
    Write-Output "Conduit is stopped."
    exit 3
  }
  if (Test-Healthy) {
    Write-Output "Conduit is healthy on port $($env:CONDUIT_PORT) (PID $($server.ProcessId))."
    $vite = Get-ProcessRecord $vitePidFile "vite"
    if ($vite) { Write-Output "Vite hot reload is running on port $($env:CONDUIT_VITE_PORT) (PID $($vite.ProcessId))." }
    return
  }
  Write-Error "Conduit is running as PID $($server.ProcessId) but health checks are failing. Logs: $logFile"
  exit 1
}

function Show-Logs {
  $which = if ($CommandArguments.Count -gt 0) { $CommandArguments[0] } else { "server" }
  $follow = $CommandArguments -contains "-f"
  $file = switch ($which) {
    "server" { $logFile }
    "vite" { $viteLogFile }
    default { throw "Unknown log target: $which. Use server or vite." }
  }
  if (-not (Test-Path -LiteralPath $file)) { New-Item -ItemType File -Force -Path $file | Out-Null }
  if ($follow) {
    Get-Content -LiteralPath $file -Tail 100 -Wait
  } else {
    Get-Content -LiteralPath $file -Tail 100
    $errorFile = if ($which -eq "server") { $errorLogFile } else { $viteErrorLogFile }
    if (Test-Path -LiteralPath $errorFile) {
      Write-Output "--- $errorFile ---"
      Get-Content -LiteralPath $errorFile -Tail 100
    }
  }
}

function Show-Usage {
  @"
Usage: .\.devcontainer\win-start-conduit.ps1 <command>

Commands:
  setup                 Install web and bundled Isolated Pi dependencies.
  build                 Compile the production client bundle.
  start                 Start an existing production build.
  dev                   Start the server watcher and Vite hot reload.
  stop                  Stop Vite, Conduit, resident Pi, and terminal processes.
  restart               Rebuild if sources changed, then restart (default).
  status                Report the managed process and health endpoint.
  logs [server|vite] [-f]
                        Show a managed log (follow with -f).
  deploy                Run setup, build, and restart.

restart is the production-like path. dev manages the server on $($env:CONDUIT_PORT)
and Vite on $($env:CONDUIT_VITE_PORT); it is never used for deployment.
"@
}

try {
  switch ($Command.ToLowerInvariant()) {
    "setup" {
      Guard-ComponentMode
      Setup
    }
    "build" {
      Guard-ComponentMode
      Build
    }
    "start" {
      Guard-ComponentMode
      Start-Server
    }
    "dev" {
      Guard-ComponentMode
      Stop-All
      Start-Server -Watch
      try {
        Start-Vite
      } catch {
        Stop-All
        throw
      }
    }
    "stop" { Stop-All }
    "restart" {
      Guard-ComponentMode
      Stop-All
      Build-IfNeeded
      Start-Server
    }
    "status" { Show-Status }
    "logs" { Show-Logs }
    "deploy" {
      Guard-ComponentMode
      Setup
      Build
      Stop-All
      Start-Server
    }
    "help" { Show-Usage }
    "-h" { Show-Usage }
    "--help" { Show-Usage }
    default {
      Show-Usage
      exit 2
    }
  }
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
