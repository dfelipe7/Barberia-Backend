#!/usr/bin/env bash
set -e
git config --local core.hooksPath .githooks
git config --local commit.template .gitmessage.txt
chmod +x .githooks/* 2>/dev/null || true

[ -f AGENTS.md ]     || { echo "Falta AGENTS.md en la raíz" >&2; exit 1; }
[ -f TECH_DEBT.md ]  || { echo "Falta TECH_DEBT.md en la raíz" >&2; exit 1; }

echo "OK: hooks en .githooks, template en .gitmessage.txt"
echo "Reglas: AGENTS.md · Deuda: TECH_DEBT.md"
echo "Exporta antes de commitear: export AI_TOOL=OpenCode AI_MODEL=claude-sonnet-4.5 AI_SESSION=..."

