# Activa hooks y template en este repo. Idempotente.
git config --local core.hooksPath .githooks
git config --local commit.template .gitmessage.txt

if (-not (Test-Path "AGENTS.md"))     { Write-Error "Falta AGENTS.md en la raíz"; exit 1 }
if (-not (Test-Path "TECH_DEBT.md")) { Write-Error "Falta TECH_DEBT.md en la raíz"; exit 1 }

Write-Host "OK: hooks en .githooks, template en .gitmessage.txt"
Write-Host "Reglas: AGENTS.md · Deuda: TECH_DEBT.md"
Write-Host "Recuerda exportar AI_TOOL, AI_MODEL y AI_SESSION antes de commitear:"
Write-Host '  $env:AI_TOOL="OpenCode"; $env:AI_MODEL="claude-sonnet-4.5"; $env:AI_SESSION="2026-11-01T14:30:00-05:00"'

