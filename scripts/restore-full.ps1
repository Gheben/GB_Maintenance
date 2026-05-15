param(
  [Parameter(Mandatory = $true)]
  [string]$BackupPath,
  [string]$ContainerName = "gbmaintenance-postgres-dev",
  [string]$DbName = "gbmaintenance",
  [string]$DbUser = "gbmaint"
)

$ErrorActionPreference = "Stop"

function Resolve-RepoRoot {
  if ($PSScriptRoot) {
    return (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
  }
  return (Get-Location).Path
}

$repoRoot = Resolve-RepoRoot
Set-Location $repoRoot

$backupDir = (Resolve-Path $BackupPath).Path
if (-not (Test-Path $backupDir)) {
  throw "Backup path not found: $BackupPath"
}

$dbDumpPath = Join-Path $backupDir "db.sql"
if (-not (Test-Path $dbDumpPath)) {
  throw "Missing dump file: $dbDumpPath"
}

Write-Host "[restore] Repository root: $repoRoot"
Write-Host "[restore] Backup folder:   $backupDir"

$containerRunning = docker ps --format "{{.Names}}" | Where-Object { $_ -eq $ContainerName }
if (-not $containerRunning) {
  throw "Container '$ContainerName' is not running. Start DB first (example: docker compose -f docker-compose.dev.yml up -d)."
}

Write-Host "[restore] Resetting DB schema..."
$resetSql = "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"
$resetSql | docker exec -i $ContainerName psql -U $DbUser -d $DbName
if ($LASTEXITCODE -ne 0) {
  throw "Failed to reset DB schema."
}

Write-Host "[restore] Importing DB dump..."
Get-Content -Path $dbDumpPath -Raw | docker exec -i $ContainerName psql -U $DbUser -d $DbName
if ($LASTEXITCODE -ne 0) {
  throw "Failed to import DB dump."
}

function Expand-IfExists {
  param(
    [string]$ZipFile,
    [string]$DestinationRelative
  )

  $zipPath = Join-Path $backupDir $ZipFile
  if (-not (Test-Path $zipPath)) {
    Write-Host "[restore] Skipping missing archive: $ZipFile"
    return
  }

  $dest = Join-Path $repoRoot $DestinationRelative
  if (Test-Path $dest) {
    Remove-Item $dest -Recurse -Force
  }
  New-Item -ItemType Directory -Path $dest -Force | Out-Null

  Write-Host "[restore] Restoring $ZipFile -> $DestinationRelative"
  Expand-Archive -Path $zipPath -DestinationPath $dest -Force

  # Compress-Archive stores parent folder names. Flatten if needed.
  $children = Get-ChildItem -Path $dest
  if ($children.Count -eq 1 -and $children[0].PSIsContainer) {
    $inner = $children[0].FullName
    Get-ChildItem -Path $inner -Force | Move-Item -Destination $dest -Force
    Remove-Item $inner -Recurse -Force
  }
}

Expand-IfExists -ZipFile "uploads.zip" -DestinationRelative "uploads"
Expand-IfExists -ZipFile "backend-uploads.zip" -DestinationRelative "backend/uploads"
Expand-IfExists -ZipFile "logs.zip" -DestinationRelative "logs"

Write-Host "[restore] Completed successfully."
Write-Host "[restore] Restart backend/frontend dev after restore."
