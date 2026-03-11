#!/usr/bin/env bash
set -euo pipefail

# aidog installer
# Usage: curl -fsSL https://raw.githubusercontent.com/AIAIDO/aidog/main/install.sh | bash

BOLD='\033[1m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
RESET='\033[0m'

info()  { echo -e "${BOLD}$1${RESET}"; }
ok()    { echo -e "${GREEN}✓ $1${RESET}"; }
warn()  { echo -e "${YELLOW}⚠ $1${RESET}"; }
fail()  { echo -e "${RED}✗ $1${RESET}"; exit 1; }

echo ""
info "🐕 aidog installer"
info "   Unified dashboard for all coding agents"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
  fail "Node.js is not installed. Please install Node.js >= 18 first: https://nodejs.org"
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  fail "Node.js >= 18 required (found v$(node -v | sed 's/v//')). Please upgrade: https://nodejs.org"
fi
ok "Node.js $(node -v) detected"

# Detect package manager
if command -v npm &> /dev/null; then
  PM="npm"
elif command -v pnpm &> /dev/null; then
  PM="pnpm"
elif command -v yarn &> /dev/null; then
  PM="yarn"
else
  fail "No package manager found. Please install npm, pnpm, or yarn."
fi
ok "Using $PM"

# Install aidog globally
info "Installing aidog..."
$PM install -g aidog

if ! command -v aidog &> /dev/null; then
  fail "Installation failed. Try running: $PM install -g aidog"
fi
ok "aidog installed successfully"

# Run setup
echo ""
info "Running initial setup..."
aidog setup

echo ""
ok "All done! Run 'aidog serve' to launch the dashboard."
echo ""
