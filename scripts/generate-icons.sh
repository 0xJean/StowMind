#!/bin/bash

# Generate StowMind app icons from public/icon.svg

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"
node scripts/generate-icons.js
