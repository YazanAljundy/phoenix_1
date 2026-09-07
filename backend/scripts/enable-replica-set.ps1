# Converts the installed MongoDB Windows service to a single-node replica set,
# which is what Money-Flow V2's transactions require.
#
#   Run in an ELEVATED (Administrator) PowerShell, from the repo root:
#     .\backend\scripts\enable-replica-set.ps1
#
# Idempotent: re-running it when the set is already configured does nothing.
# See backend/docs/LOCAL_SETUP.md.

$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error 'This script must be run from an elevated (Administrator) PowerShell.'
    exit 1
}

# Find the installed server rather than hard-coding 7.0.
$serverRoot = 'C:\Program Files\MongoDB\Server'
if (-not (Test-Path $serverRoot)) {
    Write-Error "MongoDB not found at $serverRoot. Edit `$serverRoot in this script, or follow the manual steps in backend/docs/LOCAL_SETUP.md."
    exit 1
}
$version = Get-ChildItem $serverRoot -Directory | Sort-Object Name -Descending | Select-Object -First 1
$cfgPath = Join-Path $version.FullName 'bin\mongod.cfg'
if (-not (Test-Path $cfgPath)) {
    Write-Error "mongod.cfg not found at $cfgPath"
    exit 1
}
Write-Host "config: $cfgPath"

$content = Get-Content $cfgPath -Raw
if ($content -match '(?m)^\s*replSetName\s*:') {
    Write-Host 'replication.replSetName is already configured - leaving mongod.cfg alone.'
} else {
    $backup = "$cfgPath.bak"
    Copy-Item $cfgPath $backup -Force
    Write-Host "backed up to $backup"

    # `replication:` must sit at column 0; replSetName is indented under it.
    $block = "`nreplication:`n  replSetName: rs0`n"
    Add-Content -Path $cfgPath -Value $block -Encoding UTF8
    Write-Host 'appended replication.replSetName: rs0'
}

$service = Get-Service -Name 'MongoDB' -ErrorAction SilentlyContinue
if (-not $service) {
    Write-Warning 'No Windows service named "MongoDB". Restart your mongod manually, then run: node backend/scripts/check-replica-set.js --initiate'
    exit 0
}

Write-Host 'restarting the MongoDB service...'
Restart-Service -Name 'MongoDB' -Force
Start-Sleep -Seconds 3
Write-Host ('service status: ' + (Get-Service -Name 'MongoDB').Status)

Write-Host ''
Write-Host 'Now initiate the set (once):'
Write-Host '  node backend/scripts/check-replica-set.js --initiate'
