# Backup and Restore (Full)

This project now includes PowerShell scripts to export and reimport a full backup for local/dev usage:

- database dump (PostgreSQL)
- uploaded files
- backend uploads
- logs
- key config snapshots (.env, docker-compose files)

## Prerequisites

1. PostgreSQL container is running (default: `gbmaintenance-postgres-dev`)
2. PowerShell 5.1+ on Windows
3. Docker CLI available in PATH

## Create backup

From repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\backup-full.ps1
```

Optional parameters:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\backup-full.ps1 \
  -OutputRoot .\backups \
  -ContainerName gbmaintenance-postgres-dev \
  -DbName gbmaintenance \
  -DbUser gbmaint
```

Output example:

- `backups/gbmaintenance-backup-YYYYMMDD-HHMMSS/db.sql`
- `uploads.zip`
- `backend-uploads.zip`
- `logs.zip`
- `config/*`
- `manifest.json`

## Restore backup

Warning: restore overwrites current DB schema and files.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\restore-full.ps1 \
  -BackupPath .\backups\gbmaintenance-backup-YYYYMMDD-HHMMSS
```

Optional parameters:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\restore-full.ps1 \
  -BackupPath .\backups\gbmaintenance-backup-YYYYMMDD-HHMMSS \
  -ContainerName gbmaintenance-postgres-dev \
  -DbName gbmaintenance \
  -DbUser gbmaint
```

After restore, restart backend and frontend dev.

## Recommended strategy

1. Run daily automated backups (Task Scheduler).
2. Keep at least 7 daily + 4 weekly + 6 monthly copies.
3. Copy backup folders to offsite storage (NAS/cloud).
4. Test restore regularly (at least monthly).
5. Before major release, create a manual backup snapshot.
