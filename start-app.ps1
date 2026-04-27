# Job Tracker Startup Script
$ErrorActionPreference = "SilentlyContinue"

# ── Set to $true if you want to share via Cloudflare tunnel ──
$SHARE_WITH_CLOUDFLARE = $false

# Add Docker to PATH
$env:Path += ";C:\Program Files\Docker\Docker\resources\bin"

# Check if Docker Desktop is running
Write-Host ""
Write-Host "Checking Docker Desktop..." -ForegroundColor Cyan
$docker = Get-Process "Docker Desktop" -ErrorAction SilentlyContinue
if (-not $docker) {
    Write-Host "Starting Docker Desktop..." -ForegroundColor Yellow
    Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    Write-Host "Waiting for Docker to start (30 seconds)..." -ForegroundColor Yellow
    Start-Sleep -Seconds 30
}

# Start containers
Write-Host "Starting Job Tracker services..." -ForegroundColor Cyan
Set-Location "C:\Users\mahat\job-tracker"
docker compose up -d

# Auto-backup database
Write-Host "Backing up database..." -ForegroundColor Cyan
$backupDir = "C:\Users\mahat\job-tracker\backups"
if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory -Path $backupDir | Out-Null }
$backupFile = "$backupDir\backup-$(Get-Date -Format 'yyyy-MM-dd').sql"
Start-Sleep -Seconds 5  # Wait for postgres to be ready
docker compose exec -T postgres pg_dump -U admin jobtracker | Out-File -FilePath $backupFile -Encoding utf8
if (Test-Path $backupFile) {
    Write-Host "  ✓ Database backed up to backups\backup-$(Get-Date -Format 'yyyy-MM-dd').sql" -ForegroundColor Green
} else {
    Write-Host "  ! Backup skipped (postgres not ready yet)" -ForegroundColor Yellow
}

# Keep only last 7 backups
Get-ChildItem "$backupDir\backup-*.sql" | Sort-Object Name -Descending | Select-Object -Skip 7 | Remove-Item -Force

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  App is running at http://localhost:3000" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green

if (-not $SHARE_WITH_CLOUDFLARE) {
    Write-Host "Press any key to close this window." -ForegroundColor Cyan
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    exit
}

Write-Host ""
Write-Host "Starting Cloudflare tunnel..." -ForegroundColor Cyan
Write-Host "Your shareable link will appear below in a few seconds..." -ForegroundColor Yellow
Write-Host ""

# Run cloudflared and highlight the URL when it appears
$cloudflaredPath = "C:\Users\mahat\Downloads\cloudflared-windows-amd64.exe"
$process = Start-Process -FilePath $cloudflaredPath -ArgumentList "tunnel --url http://localhost:3000" -RedirectStandardError "cf-output.txt" -NoNewWindow -PassThru

Write-Host "Waiting for tunnel URL..." -ForegroundColor Yellow

$url = ""
$timeout = 60
$elapsed = 0
while ($url -eq "" -and $elapsed -lt $timeout) {
    Start-Sleep -Seconds 2
    $elapsed += 2
    if (Test-Path "cf-output.txt") {
        $content = Get-Content "cf-output.txt" -Raw -ErrorAction SilentlyContinue
        if ($content -match "https://[a-z0-9\-]+\.trycloudflare\.com") {
            $url = $Matches[0]
        }
    }
}

if ($url -ne "") {
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Green
    Write-Host "  SHARE THIS LINK WITH YOUR FRIENDS:" -ForegroundColor Green
    Write-Host ""
    Write-Host "  $url" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Keep this window open while sharing the app." -ForegroundColor Cyan
    Write-Host "Press Ctrl+C to stop the tunnel." -ForegroundColor Cyan
} else {
    Write-Host "Could not get URL. Check cf-output.txt for details." -ForegroundColor Red
}

# Keep running until user presses Ctrl+C
try { $process.WaitForExit() } catch { }
