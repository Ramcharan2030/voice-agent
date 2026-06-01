#!/usr/bin/env pwsh
# One-command Docker launcher for this checkout.

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$BaseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $BaseDir

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker is required. Install Docker Desktop or Docker Engine with Compose v2."
}

docker compose version *> $null
if ($LASTEXITCODE -ne 0) {
    throw "Docker Compose v2 is required. Verify that 'docker compose version' works."
}

if (Test-Path '.git') {
    git submodule update --init --recursive
}

if ((-not (Test-Path '.env')) -and (Test-Path '.env.example')) {
    Copy-Item '.env.example' '.env'
    Write-Host 'Created .env from .env.example'
}

& .\scripts\docker_dev.ps1 up
