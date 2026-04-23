# Job Tracker Startup Script
$ErrorActionPreference = "SilentlyContinue"

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
