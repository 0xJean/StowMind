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
- [Screenshots](#screenshots)
- [Download](#download)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Development](#development)
- [Build & release](#build--release)
- [Configuration](#configuration)
- [Project structure](#project-structure)
- [Contributing](#contributing)
- [License](#license)

---

## Why StowMind

Messy download folders and project dumps are universal. StowMind helps you **preview** where each file will go, then **execute** moves safely — with **undo**, **automatic rollback** if something fails mid-run, and **cross-volume** support when `rename` is not enough.

Classification is **rule-first** (extensions, filename keywords, parent-folder hints) so everyday files never hit an API. Turn on **AI only for hard cases** to save time and tokens while still handling ambiguous files.

---

## Features

| Area | What you get |
|------|----------------|
| **Classification** | Extension + keyword + directory-hint rules; optional Ollama / OpenAI / Claude |
| **Cost & speed** | “AI for hard cases only” (default): rules hit first, AI for edge cases |
| **Consistency** | Similar filenames grouped; majority vote can align categories |
| **Safety** | Confirm before run; partial failure rolls back completed moves; **undo** from History |
| **UX** | Drag a folder onto Organize; light / dark / system theme; **English & 中文** UI |
| **Rules editor** | Collapsible categories, keywords, reorder, reset to defaults |
| **Insights** | History search & filters; statistics & 7-day trend |

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

---

## Project structure

```text
stowmind/
├── public/                 # Static assets (e.g. icon.svg)
├── src/
│   ├── components/         # UI (e.g. Sidebar)
│   ├── hooks/              # Theme provider
│   ├── i18n/               # zh / en strings & I18nProvider
│   ├── pages/              # Home, Organize, History, Statistics, Settings
│   ├── stores/             # Zustand (settings, history, stats)
│   ├── App.tsx
│   └── main.tsx
├── src-tauri/
│   ├── src/
│   │   ├── main.rs         # Tauri commands, scan pipeline
│   │   ├── ai.rs           # LLM providers & streaming classify
│   │   └── organizer.rs    # Scan, move, grouping, safe cross-volume move
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
