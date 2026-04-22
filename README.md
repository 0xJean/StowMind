<div align="center">

<img src="public/icon.svg" alt="StowMind" width="96" height="96" />

# StowMind

**AI file organizer · 智能文件整理**

*A fast, privacy-friendly desktop app that classifies and moves files into tidy folders — rules first, AI when it matters.*

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
- [Deep Clean (powered by Mole)](#deep-clean-powered-by-mole)
- [Project structure](#project-structure)
- [Contributing](#contributing)
- [License](#license)

---

## Why StowMind

Messy download folders and project dumps are universal. StowMind helps you **scan** a folder, **adjust** categories per file, optionally **preview** moves (dry-run), then **execute** — with **undo** from History and **cross-volume** safe moves when `rename` is not enough.

Successful moves are **kept** if some items fail (no all-or-nothing rollback). Classification is **rule-first** (extensions, filename keywords, parent-folder hints) so everyday files never hit an API. Turn on **AI only for hard cases** to save time and tokens while still handling ambiguous files.

---

## Features

| Area | What you get |
|------|----------------|
| **Classification** | Extension + keyword + directory-hint rules; optional Ollama / OpenAI / Claude |
| **Cost & speed** | “AI for hard cases only” (default): rules hit first, AI for edge cases |
| **Consistency** | Similar filenames grouped; majority vote can align categories |
| **Scan scope** | By default, only files in the selected folder (non-recursive); optional **recursive** scan; **exclude patterns** (e.g. `node_modules`, `.git`) in Settings |
| **Organize** | **Preview** (dry-run) lists source → destination without writing disk; **execute** applies moves; per-item **category** override; **Skip this run** checkbox per file/folder |
| **Safety** | Confirm before run; partial failures recorded, successes retained; **undo** last run from Organize banner or History |
| **UX** | Drag a folder onto Organize; light / dark / system theme; **English & 中文** UI |
| **Rules editor** | Collapsible categories, keywords, reorder, reset to defaults |
| **Insights** | History search & filters; statistics & 7-day trend |
| **Deep Clean** | Integrated [Mole](https://github.com/tw93/Mole) for system cache cleanup, build artifact purging, and disk space analysis (macOS & [Windows](https://github.com/tw93/Mole/tree/windows)) |

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

### Deep Clean (powered by Mole)

StowMind integrates [Mole](https://github.com/tw93/Mole) — an open-source (MIT) macOS/Windows deep cleaning tool by [@tw93](https://github.com/tw93) — to provide system-level cleanup without reinventing the wheel.

Navigate to **Deep Clean** in the sidebar to access three capabilities:

| Tab | Mole command | What it does |
|-----|-------------|--------------|
| System Clean | `mo clean` | Removes system caches, app logs, browser leftovers, dev tool caches |
| Build Artifacts | `mo purge` | Cleans `node_modules`, `target`, `.build`, and other project build artifacts |
| Disk Analysis | `mo analyze` | Visualizes directory space usage and locates large files |

All operations use **dry-run preview first** — nothing is deleted until you explicitly confirm.

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
