# The Windows half of scripts/build-desktop-windows.sh.
#
# It exists so the bash side does not have to spell a whole PowerShell program
# inside a double-quoted -Command string: every quote there needs escaping for
# bash, then for PowerShell, then for the CLI it hands the value to, and the
# signing key is one of the values that has to survive all three. A file is read
# by PowerShell directly, so the quoting is only PowerShell's.
param(
  [Parameter(Mandatory = $true)][string] $Project,
  [Parameter(Mandatory = $true)][string] $CargoTauri,
  [Parameter(Mandatory = $true)][string] $TargetDir,
  [Parameter(Mandatory = $true)][string] $SigningKey,
  [string] $ConfigFile = 'tauri.prebuilt.conf.json',
  [string] $SigningKeyPassword = '',
  [Parameter(ValueFromRemainingArguments = $true)][string[]] $BuildArgs = @()
)

$ErrorActionPreference = 'Stop'

$env:CARGO_TARGET_DIR = $TargetDir
# Passed through for a Windows build that signs for itself; the WSL path turns
# updater artifacts off in tauri.prebuilt.conf.json and signs on the bash side,
# because a key with an empty password cannot be expressed in the Windows
# environment -- assigning '' deletes the variable -- and the CLI then stops to
# prompt on a console nothing is reading.
$env:TAURI_SIGNING_PRIVATE_KEY = $SigningKey
if ($SigningKeyPassword -ne '') { $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $SigningKeyPassword }

Set-Location $Project
& $CargoTauri --version
& $CargoTauri build --config $ConfigFile @BuildArgs
exit $LASTEXITCODE
