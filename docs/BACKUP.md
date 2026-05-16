# Backup and Restore (Full)

This project includes both Windows PowerShell and Docker/Linux shell scripts to export and reimport a full backup for local/dev usage:

- database dump (PostgreSQL)
- uploaded files
- backend uploads
- logs
- key config snapshots (.env, docker-compose files)

## Prerequisites

1. PostgreSQL container is running (default: `gbmaintenance-postgres-dev`)
2. Windows: PowerShell 5.1+
3. Docker/Linux: bash + tar
3. Docker CLI available in PATH

## Create backup (Windows / PowerShell)

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

## Restore backup (Windows / PowerShell)

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

## Create backup (Docker/Linux / bash)

```bash
bash ./scripts/backup-full.sh
```

Optional parameters:

```bash
bash ./scripts/backup-full.sh \
  --output-root ./backups \
  --container gbmaintenance-postgres-dev \
  --db-name gbmaintenance \
  --db-user gbmaint
```

Output example:

- `backups/gbmaintenance-backup-YYYYMMDD-HHMMSS/db.sql`
- `uploads.tgz`
- `backend-uploads.tgz`
- `logs.tgz`
- `config/*`
- `manifest.json`

## Restore backup (Docker/Linux / bash)

```bash
bash ./scripts/restore-full.sh ./backups/gbmaintenance-backup-YYYYMMDD-HHMMSS
```

Optional parameters:

```bash
bash ./scripts/restore-full.sh ./backups/gbmaintenance-backup-YYYYMMDD-HHMMSS \
  --container gbmaintenance-postgres-dev \
  --db-name gbmaintenance \
  --db-user gbmaint
```

After restore, restart backend and frontend.

## Dev login note

If you recreated the dev database from scratch, default credentials come from `.env`:

- username: `sysadmin`
- password: value of `SUPERADMIN_PASSWORD` (example: `sysadminpassword!`)

If frontend is reachable at `http://localhost:5173` but login fails, verify backend is running on `http://localhost:4680/health`.

## Recommended strategy

1. Run daily automated backups (Task Scheduler).
2. Keep at least 7 daily + 4 weekly + 6 monthly copies.
3. Copy backup folders to offsite storage (NAS/cloud).
4. Test restore regularly (at least monthly).
5. Before major release, create a manual backup snapshot.
