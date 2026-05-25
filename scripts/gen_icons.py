#!/usr/bin/env python3
"""Compatibility wrapper for icon generation."""
import subprocess
import sys

sys.exit(subprocess.call(["node", "scripts/generate-icons.js"]))
