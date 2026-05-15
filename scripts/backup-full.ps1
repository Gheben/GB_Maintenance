param(
  [string]$OutputRoot = "./backups",
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

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = Join-Path $OutputRoot ("gbmaintenance-backup-" + $timestamp)
$backupDir = (Resolve-Path (New-Item -ItemType Directory -Path $backupDir -Force)).Path

Write-Host "[backup] Repository root: $repoRoot"
Write-Host "[backup] Target folder:   $backupDir"

# Validate DB container
$containerRunning = docker ps --format "{{.Names}}" | Where-Object { $_ -eq $ContainerName }
if (-not $containerRunning) {
  throw "Container '$ContainerName' is not running. Start DB first (example: docker compose -f docker-compose.dev.yml up -d)."
}

# DB dump
$dbDumpPath = Join-Path $backupDir "db.sql"
Write-Host "[backup] Dumping database '$DbName' from container '$ContainerName'..."
docker exec $ContainerName pg_dump -U $DbUser -d $DbName --no-owner --no-privileges > $dbDumpPath
if ($LASTEXITCODE -ne 0) {
  throw "pg_dump failed."
}

# Files archive helper
function Compress-IfExists {
  param(
    [string]$Path,
    [string]$ZipName
  )

  $abs = Join-Path $repoRoot $Path
  if (Test-Path $abs) {
    $zipPath = Join-Path $backupDir $ZipName
    Write-Host "[backup] Archiving $Path -> $ZipName"
    if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
    Compress-Archive -Path $abs -DestinationPath $zipPath -CompressionLevel Optimal
  } else {
    Write-Host "[backup] Skipping missing path: $Path"
  }
}

Compress-IfExists -Path "uploads" -ZipName "uploads.zip"
Compress-IfExists -Path "backend/uploads" -ZipName "backend-uploads.zip"
Compress-IfExists -Path "logs" -ZipName "logs.zip"

# Config snapshots
$configDir = Join-Path $backupDir "config"
New-Item -ItemType Directory -Path $configDir -Force | Out-Null

foreach ($file in @(".env", "docker-compose.yml", "docker-compose.dev.yml", ".env.example")) {
  $src = Join-Path $repoRoot $file
  if (Test-Path $src) {
    Copy-Item $src -Destination (Join-Path $configDir ([IO.Path]::GetFileName($file))) -Force
  }
}

$gitCommit = ""
try {
  $gitCommit = (git rev-parse --short HEAD 2>$null).Trim()
} catch {
  $gitCommit = ""
}

$manifest = [ordered]@{
  app = "GB_Maintenance"
  backup_created_at_utc = (Get-Date).ToUniversalTime().ToString("o")
  backup_created_at_local = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
  repo_root = $repoRoot
  db = [ordered]@{
    container = $ContainerName
    db_name = $DbName
    db_user = $DbUser
    dump_file = "db.sql"
  }
  artifacts = @(
    "db.sql",
    "uploads.zip",
    "backend-uploads.zip",
    "logs.zip",
    "config/"
  )
  git_commit = $gitCommit
}

$manifestPath = Join-Path $backupDir "manifest.json"
$manifest | ConvertTo-Json -Depth 6 | Set-Content -Path $manifestPath -Encoding UTF8

Write-Host "[backup] Completed successfully."
Write-Host "[backup] Folder: $backupDir"
