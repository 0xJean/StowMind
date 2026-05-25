<div align="center">

<img src="public/icon.svg" alt="StowMind" width="96" height="96" />

# StowMind

**Smart cleanup and AI file organization · 智能清理与整理**

*A privacy-friendly desktop app for cleaning space, finding duplicates, running system maintenance tools, and organizing files with rules-first AI help.*

[![License: MIT](https://img.shields.io/badge/License-MIT-indigo.svg)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-1.5-24C8D8?logo=tauri&logoColor=white)](https://tauri.app/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)

[English](README.md) · [简体中文](README.zh-CN.md)

</div>

---

## Table of contents

- [Why StowMind](#why-stowmind)
- [Features](#features)
- [Roadmap](#roadmap)
- [Screenshots](#screenshots)
- [Download](#download)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Development](#development)
- [Build & release](#build--release)
- [Configuration](#configuration)
- [System Clean & Mole Console](#system-clean--mole-console)
- [Project structure](#project-structure)
- [Contributing](#contributing)
- [License](#license)

---

## Why StowMind

Storage pressure usually comes from several places at once: system caches, build artifacts, installer leftovers, duplicate files, and messy user folders. StowMind is being repositioned around **cleanup first**, while keeping AI file organization as a distinctive workflow for files that should be moved or archived rather than deleted.

The cleanup boundary is explicit: core cleanup features are backed by real Mole commands or Mole script functions. StowMind provides the native UI, preview parsing, confirmation, history, and statistics; it does not ship a separate self-written cleanup/delete engine. Duplicate detection is an auxiliary file inspection tool, not Mole cleanup.

The existing AI organizer remains intact: StowMind helps you **scan** a folder, **adjust** categories per file, optionally **preview** moves (dry-run), then **execute** — with **undo** from History and **cross-volume** safe moves when `rename` is not enough.

Successful moves are **kept** if some items fail (no all-or-nothing rollback). Classification is **rule-first** (extensions, filename keywords, parent-folder hints) so everyday files never hit an API. Turn on **AI only for hard cases** to save time and tokens while still handling ambiguous files.

---

## Features

| Area | What you get |
|------|----------------|
| **System clean** | Native StowMind view powered by real `mo clean --dry-run` output for system caches, logs, browser caches, and dev tool caches |
| **Disk analysis** | Native StowMind view powered by real `mo analyze -json <path>` output |
| **Build artifacts** | Mole purge preview and execution for a selected project directory |
| **Installer cleanup** | Mole installer scan and cleanup functions for `.dmg`, `.pkg`, `.iso`, `.xip`, and installer-like `.zip` files |
| **Mole Console** | Advanced terminal-based access to `mo`, `mo clean`, `mo uninstall`, `mo optimize`, `mo analyze`, `mo status`, `mo purge`, and `mo installer` remains available |
| **Duplicate file helper** | Size grouping + SHA-256 full-file matching to find identical copies; inspection only, not cleanup |
| **Classification** | Extension + keyword + directory-hint rules; optional Ollama / OpenAI / Claude |
| **Cost & speed** | “AI for hard cases only” (default): rules hit first, AI for edge cases |
| **Consistency** | Similar filenames grouped; majority vote can align categories |
| **Scan scope** | By default, only files in the selected folder (non-recursive); optional **recursive** scan; **exclude patterns** (e.g. `node_modules`, `.git`) in Settings |
| **Organize** | **Preview** (dry-run) lists source → destination without writing disk; **execute** applies moves; per-item **category** override; **Skip this run** checkbox per file/folder |
| **Safety** | Confirm before run; partial failures recorded, successes retained; **undo** last run from Organize banner or History |
| **UX** | Drag a folder onto Organize; light / dark / system theme; **English & 中文** UI |
| **Rules editor** | Collapsible categories, keywords, reorder, reset to defaults |
| **Insights** | History search & filters; statistics & 7-day trend |

---

## Roadmap

Planned and completed capabilities are tracked in [`docs/ROADMAP.md`](docs/ROADMAP.md) (trust/scope, control, reliability, UX polish, and advanced ideas).

---

## Screenshots

> Place app screenshots here (e.g. `docs/screenshots/organize.png`) and link them for a richer README.

```text
docs/screenshots/
├── home.png
├── organize.png
├── settings.png
└── history.png
```

---

## Download

Prebuilt binaries are produced by [GitHub Actions](.github/workflows/publish.yml) when you push a version tag:

```bash
git tag v1.0.0
git push origin v1.0.0
```

Releases are created as **drafts**; publish them from the GitHub Releases page after review.

**Platforms:** macOS (Apple Silicon & Intel), Windows, Linux (Ubuntu-friendly builds in CI).

---

## Requirements

| Tool | Version (recommended) |
|------|-------------------------|
| [Node.js](https://nodejs.org/) | 18+ |
| [pnpm](https://pnpm.io/) | latest |
| [Rust](https://rustup.rs/) | stable (1.70+) |
| OS deps | See [Tauri prerequisites](https://tauri.app/v1/guides/getting-started/prerequisites) |

**Optional — AI backends (pick one or none for rules-only mode):**

- [Ollama](https://ollama.com/) (local)
- OpenAI API key
- Anthropic (Claude) API key

---

## Quick start

```bash
git clone <repository-url>
cd <repository-directory>
pnpm install
pnpm tauri dev
```

The app opens in development mode with hot reload for the webview.

---

## Development

```bash
# Frontend only (Vite)
pnpm dev

# Full Tauri app
pnpm tauri:dev

# Typecheck
pnpm exec tsc --noEmit

# Rust tests
cd src-tauri && cargo test
```

### Icons

Icons under `src-tauri/icons/` are generated from `public/icon.svg`. If the Tauri CLI cannot read your SVG, you can use the Node toolchain (`sharp`, `png-to-ico`) or a small script to emit PNG / ICO / ICNS.

---

## Build & release

```bash
pnpm tauri build
```

Artifacts land under `src-tauri/target/release/bundle/`. For multi-platform CI builds, use the **publish** workflow (tags `v*`).

---

## Configuration

### AI

1. Open **Settings**.
2. Choose provider: **Ollama**, **OpenAI**, or **Claude**.
3. Set model name, host (Ollama), or API key (cloud).
4. Use **Test connection** to verify.
5. Toggle **AI for hard cases only** to minimize API usage (recommended).

### Mole system settings

**Settings → Mole system settings** collects Mole’s system-level entry points in one place: launch at login, full disk access, delete mode, license activation, and planet landing. Some items open the OS settings page directly; high-risk actions still fall back to Mole Console.

### Language (UI)

Settings → **Language**: **English** or **中文**. Preference is stored in the browser local storage key `stowmind-locale` (legacy `ai-file-organizer` is migrated automatically).

### Theme

**Light**, **Dark**, or **Follow system**. Sidebar shortcut toggles between light and dark directly.

### Category rules

Edit extensions and keywords per category, reorder categories, or **Reset defaults**. The reserved category **其他** (“Other”) cannot be removed.

### Scan exclusions

**Settings → Scan exclusions**: one pattern per line (substring match on the file path, case-insensitive). Paths containing any pattern are skipped during scan (e.g. `node_modules`, `.git`, `__pycache__`).

### Organize workflow

1. Pick a folder and **Scan** (toggle **recursive file scan** if you need subfolders).
2. Adjust **category** or check **Skip this run** for items you do not want to move.
3. **Preview** to see planned moves, then **Execute** (or execute directly after confirming the dialog).

---

### System Clean & Mole Console

StowMind integrates [Mole](https://github.com/tw93/Mole) — an open-source (MIT) macOS/Windows deep cleaning tool by [@tw93](https://github.com/tw93) — as a source of system-level cleanup and maintenance capabilities.

Navigate to **System Clean** in the sidebar to run a real `mo clean --dry-run` preview. StowMind renders Mole's grouped preview, potential space, item count, categories, and raw output as a native page. This page is currently preview-only; execution still goes through `mo clean` in Mole Console.

Navigate to **Build Artifacts** or **Installers** to reuse Mole `purge.sh` / `installer.sh` scanning and cleanup functions. Preview results come from Mole dry-run or scan functions; execution still calls Mole's own purge / installer cleanup logic. StowMind does not delete those files directly. Installer execution scans with Mole again and only cleans installer paths Mole still recognizes.

Navigate to **Mole Console** in the sidebar to access the existing Mole Console commands:

| Entry | Mole command | What it does |
|-----|-------------|--------------|
| Interactive menu | `mo` | Opens Mole's interactive command menu |
| System Clean | `mo clean` | Removes system caches, app logs, browser leftovers, dev tool caches |
| App Uninstaller | `mo uninstall` | Uninstalls apps and scans related leftovers |
| System Optimize | `mo optimize` | Runs maintenance tasks such as cache rebuilds and diagnostics cleanup |
| Disk Analysis | `mo analyze` | Visualizes directory space usage and locates large files |
| System Status | `mo status` | Shows CPU, memory, disk, network, and other status metrics |
| Build Artifacts | `mo purge` | Cleans `node_modules`, `target`, `.build`, and other project build artifacts |
| Installer Cleanup | `mo installer` | Finds installer files such as `.dmg` and `.pkg` |

The console integration remains available as an execution path, advanced entry, compatibility fallback, and troubleshooting surface. Every core cleanup path must map to real Mole capabilities. If Mole has no matching feature, such as duplicate deletion, StowMind keeps it as auxiliary inspection instead of presenting it as core cleanup.

**Requirements:**

- **macOS**: Install Mole via `brew install mole` or the [install script](https://github.com/tw93/Mole#quick-start)
- **Windows** (experimental): See the [windows branch](https://github.com/tw93/Mole/tree/windows) — requires Windows 10/11, PowerShell 5.1+, and Git

If Mole is not installed, StowMind shows an in-app installation guide with platform-specific instructions.

> Mole is an independent open-source project by [@tw93](https://github.com/tw93), licensed under [MIT](https://github.com/tw93/Mole/blob/main/LICENSE). StowMind calls it as an external CLI tool and does not bundle or modify its source code.

---

## Project structure

```text
stowmind/
├── docs/
│   └── ROADMAP.md          # Product roadmap & implementation checklist
├── public/                 # Static assets (e.g. icon.svg)
├── src/
│   ├── components/         # UI (e.g. Sidebar)
│   ├── hooks/              # Theme provider
│   ├── i18n/               # zh / en strings & I18nProvider
│   ├── pages/              # Home, Organize, History, Statistics, Settings, DeepClean
│   ├── stores/             # Zustand (settings, history, stats)
│   ├── App.tsx
│   └── main.tsx
├── src-tauri/
│   ├── src/
│   │   ├── main.rs         # Tauri commands, scan pipeline
│   │   ├── ai.rs           # LLM providers & streaming classify
│   │   ├── organizer.rs    # Scan, move, grouping, safe cross-volume move
│   │   └── deepclean.rs    # Mole CLI integration (deep clean)
│   ├── icons/
│   └── tauri.conf.json
├── .github/workflows/      # publish.yml (Tauri builds on tag)
├── package.json
└── README.md / README.zh-CN.md
```

---

## Contributing

Issues and pull requests are welcome. Please:

1. Keep changes focused and match existing code style.
2. Run `pnpm exec tsc --noEmit` and `cargo test` in `src-tauri` before submitting.
3. Update docs if you change user-visible behavior.

---

## License

[MIT](LICENSE)

---

<div align="center">

**StowMind** — *Stow your files, keep your mind clear.*

</div>
