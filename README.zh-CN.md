<div align="center">

<img src="public/icon.svg" alt="StowMind" width="96" height="96" />

# StowMind

**Smart cleanup and AI file organization · 智能清理与整理**

*一款注重隐私的桌面应用：以清理空间和系统维护为主线，同时保留规则优先、AI 辅助的文件整理能力。*

[![License: MIT](https://img.shields.io/badge/License-MIT-indigo.svg)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-1.5-24C8D8?logo=tauri&logoColor=white)](https://tauri.app/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)

[English](README.md) · [简体中文](README.zh-CN.md)

</div>

---

## 目录

- [为什么选择 StowMind](#为什么选择-stowmind)
- [功能特性](#功能特性)
- [Agent 清理](#agent-清理)
- [路线图](#路线图)
- [界面截图](#界面截图)
- [下载安装](#下载安装)
- [环境要求](#环境要求)
- [快速开始](#快速开始)
- [开发说明](#开发说明)
- [构建与发布](#构建与发布)
- [配置说明](#配置说明)
- [项目结构](#项目结构)
- [参与贡献](#参与贡献)
- [开源协议](#开源协议)

---

## 为什么选择 StowMind

磁盘空间通常被多个来源一起占用：系统缓存、构建产物、安装包残留、重复文件，以及越来越乱的下载目录和项目目录。StowMind 正在升级为以**清理**为核心的桌面工具，同时把 AI 文件整理保留为特色能力：该由 Mole 清理的交给 Mole，不该删除的用户文件帮助归档和移动。

清理能力的边界很明确：StowMind 的核心清理功能基于 Mole 的真实命令或脚本函数实现；StowMind 负责原生 UI、预览解析、确认、历史和统计，不自研一套清理/删除器。重复文件是辅助检查工具，用于找出相同内容副本，不属于 Mole 清理，也不计入核心清理能力。

现有 AI 整理流程继续保留：StowMind 先**扫描**目录，支持逐条**调整分类**，可选**预览移动**（不落盘），再**执行整理**；整理后可在历史或整理页**一键撤销**，跨卷时在无法 `rename` 时用**复制+删除**安全完成移动。

**部分成功不回滚**：有失败项时，已成功移动的文件会保留，失败原因会记录，而不是整批撤销。分类以**规则优先**（扩展名、文件名关键词、父目录名提示）为主，日常文件不必调用大模型。开启 **「AI 仅用于疑难文件」**（默认开启）可在保证效果的同时显著节省时间与 API 成本。

---

## 功能特性

| 模块 | 说明 |
|------|------|
| **系统清理** | StowMind 原生页面，真实调用 `mo clean --dry-run` 预览，并通过 Mole 执行确认后的系统缓存、日志、浏览器缓存和开发工具缓存清理 |
| **系统缓存异常检测** | 系统诊断页优先检测 iconservices 缓存，区分未知大小与权限不足；管理员复核后确认由 Mole 清理，复查前后占用并记录历史（详见 [系统缓存诊断](docs/SYSTEM_CACHE_DIAGNOSTICS.md)） |
| **Agent 清理** | 按固定白名单和保留规则预览 Codex、OpenCode、Claude Code、Kiro、Devin、Cursor、Windsurf、Gemini CLI、Antigravity、Continue、Copilot CLI、Amazon Q、Cline、Goose 的过期缓存、日志、临时文件、孤立 worktree，以及当前仓库的 Codex 内部 refs 和不可达 Git 对象（详见 [`docs/AGENT_CLEANUP.md`](docs/AGENT_CLEANUP.md)） |
| **磁盘分析** | StowMind 原生页面，真实调用 `mo analyze -json <path>` 输出 |
| **构建产物** | 复用 Mole purge 逻辑，对用户选择的项目目录做 dry-run 预览，并通过 Mole purge 执行清理 |
| **安装包清理** | 复用 Mole installer 的真实扫描与清理函数，处理 `.dmg`、`.pkg`、`.iso`、`.xip` 和安装型 `.zip` |
| **Mole Console** | 高级入口继续保留，支持运行 `mo`、`mo clean`、`mo uninstall`、`mo optimize`、`mo analyze`、`mo status`、`mo purge`、`mo installer` |
| **重复文件辅助检查** | 先按大小分组，再用 SHA-256 全文件哈希找出相同内容副本；只检查，不执行清理 |
| **分类** | 扩展名 + 关键词 + 目录提示规则；可选 Ollama / OpenAI / Claude |
| **成本与速度** | 默认「疑难才问 AI」：规则能命中则不请求模型 |
| **一致性** | 相似文件名分组；多数投票可统一同组分类 |
| **扫描范围** | 默认只扫描所选文件夹内一层文件；可开**递归扫描**；在设置中配置**排除规则**（如 `node_modules`、`.git`） |
| **整理流程** | **预览**（dry-run）仅列出源→目标；**执行**后真实移动；支持单条**改分类**与**本次不移动**勾选 |
| **安全** | 执行前确认；部分失败时成功项保留；历史 / 整理页**撤销** |
| **体验** | 整理页拖拽文件夹；浅色 / 深色 / 跟随系统；**中英文**界面 |
| **产品引导** | 首次运行展示可关闭的首页引导，介绍系统状态、预览式清理、Agent 清理和设置；可从设置重新查看 |
| **规则编辑** | 可折叠分类卡片、关键词编辑、排序、一键恢复默认规则 |
| **数据洞察** | 历史搜索与筛选；统计与近 7 日趋势 |

### Agent 清理

侧栏和欢迎页都提供 **Agent 清理** 入口。它只扫描 Codex、OpenCode、Claude Code、Kiro、Devin、Cursor、Windsurf、Gemini CLI / Antigravity、Continue、GitHub Copilot CLI、Amazon Q Developer、Cline、Goose 已记录的可重建路径。

流程是先预览：选择保留天数，按缓存、日志、临时文件、孤立 worktree 和 Git 元数据分组检查，再确认要清理的项目。引用扫描和预览不会写入 refs 或 reflog。普通文件移入系统废纸篓；Codex 引用删除仅针对选中的 `refs/codex/turn-diffs/*`，核对预览时的对象 ID，且不会沿符号引用修改其他分支。不可达 Git 对象只有在仓库干净且单独明确确认后，才按配置的保留截止时间过期 reflog 并修剪对象。固定白名单、运行中 Agent 保护、仓库状态复核、孤立 worktree 复核，以及会话和配置路径保护会在执行前再次校验。完整范围和排除项见 [`docs/AGENT_CLEANUP.md`](docs/AGENT_CLEANUP.md)。

---

## 路线图

产品规划与已完成能力见 [`docs/ROADMAP.md`](docs/ROADMAP.md)（信任与范围、可控性、可靠性、体验与进阶方向）。

---

## 界面截图

> 建议在 `docs/screenshots/` 放置截图并在下方引用，便于新用户快速了解产品。

```text
docs/screenshots/
├── home.png
├── organize.png
├── settings.png
└── history.png
```

---

## 下载安装

从 [GitHub 最新正式 Release](https://github.com/0xJean/StowMind/releases/latest) 下载安装包。请核对版本号和发布说明，确认它包含所需功能；代码合并到 `main` 或 PR 检查通过，不代表新版安装包已经发布。

当前 [publish 工作流](.github/workflows/publish.yml) 构建适用于 Apple Silicon 和 Intel 的 universal macOS 安装包。发布资产前必须通过人工审批、Developer ID 签名检查、Apple 公证、staple 和 Gatekeeper 验证。维护者须遵循 [正式发布流程](docs/RELEASE_PROCESS.md)，并独立下载验收安装包。

---

## 环境要求

| 工具 | 建议版本 |
|------|-----------|
| [Node.js](https://nodejs.org/) | 18+ |
| [pnpm](https://pnpm.io/) | 最新 |
| [Rust](https://rustup.rs/) | stable（1.70+） |
| 系统依赖 | 见 [Tauri 官方环境准备](https://tauri.app/v1/guides/getting-started/prerequisites) |

**可选 — AI 后端（可仅用规则、不配置 AI）：**

- [Ollama](https://ollama.com/)（本地）
- OpenAI API Key
- Anthropic（Claude）API Key

---

## 快速开始

```bash
git clone <仓库地址>
cd <本地目录名>
pnpm install
pnpm tauri dev
```

开发模式下会启动带热更新的 Tauri 窗口。

从欢迎页打开 **Agent 清理**，即可扫描本机开发 Agent 留下的可清理文件和当前仓库的 Git 元数据。默认保留 30 天；扫描结果需要先审核，普通文件会移入系统废纸篓，不可达 Git 对象的修剪需要单独确认且不可撤销。

完成或跳过权限与 Mole 设置后，应用会显示一段简短的产品引导。引导可以随时关闭，也可以从 **设置 → 重新查看引导** 再次打开。

---

## 开发说明

```bash
# 仅前端（Vite）
pnpm dev

# 完整 Tauri 应用
pnpm tauri:dev

# TypeScript 检查
pnpm exec tsc --noEmit

# Rust 单元测试
cd src-tauri && cargo test
```

PR 会自动运行 `frontend` 和 `macos` 两项必需检查，详见 [CI 验证与本地命令](docs/CI.md)。

### 应用图标

`src-tauri/icons/` 下的资源通常由 `public/icon.svg` 生成。若 Tauri CLI 无法解析 SVG，可使用 Node（如 `sharp`、`png-to-ico`）或脚本生成 PNG / ICO / ICNS。

---

## 构建与发布

```bash
pnpm tauri build
```

本地开发产物位于 `src-tauri/target/release/bundle/`。正式 macOS 安装包只能按 [发布流程](docs/RELEASE_PROCESS.md) 通过 **publish** 工作流构建和上传，不能手工发布本地产物。

---

## 配置说明

### AI 模型

1. 打开 **设置**。
2. 选择 **Ollama**、**OpenAI** 或 **Claude**。
3. 填写模型名、Ollama 地址或云端 **API Key**。
4. 使用 **测试连接** 验证。
5. 建议保持 **AI 仅用于疑难文件** 开启，以减少调用次数。

### Mole 系统设置

**设置 → Mole 系统设置** 会集中展示 Mole 的系统级入口：随系统启动、Full Disk Access、Delete mode、License activation 和 Planet landing。部分项会直接打开系统设置；高风险动作仍回退到 Mole Console。

### 界面语言

**设置 → 语言**：可选 **中文** 或 **English**。偏好保存在本地存储键 `stowmind-locale`；若曾使用旧版，数据会从 `ai-file-organizer` 自动迁移。

### 主题

支持 **浅色**、**深色**、**跟随系统**；侧栏底部提供日月图标快捷切换明暗。

### 分类规则

可为每个分类维护扩展名与关键词、调整顺序，或使用 **恢复默认**。内置分类 **其他** 不可删除，作为兜底类别。

### 扫描排除

**设置 → 扫描排除**：每行一条路径片段（不区分大小写，路径中包含该片段即跳过）。用于跳过 `node_modules`、`.git`、`__pycache__` 等目录。

### 整理流程建议

1. 选择文件夹并 **扫描**（需要子目录文件时打开 **递归扫描文件**）。
2. 调整 **分类**，或对不需要移动的项勾选 **本次不移动**。
3. 使用 **预览移动** 查看计划，再 **执行整理**（也可在确认对话框后直接执行）。

### 系统清理与 Mole Console

StowMind 集成 [Mole](https://github.com/tw93/Mole) — 由 [@tw93](https://github.com/tw93) 开发的开源 macOS/Windows 深度清理工具 — 作为系统级清理和维护能力来源。Mole 是外部依赖，StowMind 不内置固定版本的 Mole 二进制文件。

在侧边栏进入 **系统清理**，StowMind 会真实调用 `mo clean --dry-run`，把 Mole 的分组预览、可释放空间、条目数和原始输出展示为原生页面，并通过 Mole 的 `mo clean` 执行确认后的清理计划。实际删除动作仍由 Mole 完成。

进入 **构建产物** 或 **安装包**，StowMind 会复用 Mole `purge.sh` / `installer.sh` 的真实扫描与清理函数。预览由 Mole dry-run 或扫描函数产生；执行时仍调用 Mole 自己的 purge / installer 清理逻辑，StowMind 不直接删除文件。安装包执行前会重新运行 Mole installer 扫描，只清理 Mole 仍能识别的安装包路径。

在侧边栏进入 **Mole Console**，可继续使用现有 Mole Console 命令：

| 入口 | Mole 命令 | 说明 |
|-----|-------------|--------------|
| 交互菜单 | `mo` | 打开 Mole 交互式主菜单 |
| 系统清理 | `mo clean` | 清理系统缓存、应用日志、浏览器残留、开发工具缓存 |
| 应用卸载 | `mo uninstall` | 卸载应用并扫描相关残留 |
| 系统优化 | `mo optimize` | 执行缓存重建、诊断日志清理等维护任务 |
| 磁盘分析 | `mo analyze` | 分析目录空间占用并定位大文件 |
| 系统状态 | `mo status` | 查看 CPU、内存、磁盘、网络等状态 |
| 构建产物 | `mo purge` | 清理 `node_modules`、`target`、`.build` 等构建产物 |
| 安装包清理 | `mo installer` | 查找 `.dmg`、`.pkg` 等安装包文件 |

控制台式集成会继续保留，作为执行入口、高级入口、兼容入口和排障入口。所有核心清理路径都必须对接 Mole 的真实能力；若 Mole 没有对应能力，例如重复文件删除，StowMind 只提供辅助检查，不把它包装成核心清理。

Mole 的版本和更新源由安装渠道决定。StowMind 只执行 `mo update`，展示当前 Mole 的版本、路径和能力探测结果，不在应用内拼接版本下载地址，也不硬编码发布版本。Homebrew 安装使用 `brew upgrade mole`，脚本安装使用 Mole 官方安装流程。

> Mole 是由 [@tw93](https://github.com/tw93/Mole) 开发的独立开源项目，使用 [GPL-3.0-or-later](https://github.com/tw93/Mole/blob/main/LICENSE) 许可证。StowMind 以外部 CLI 方式调用，不捆绑或修改其源码。

---

## 项目结构

```text
stowmind/
├── docs/
│   └── ROADMAP.md          # 产品路线图与实现勾选
├── public/                 # 静态资源（如 icon.svg）
├── src/
│   ├── components/         # UI 组件（如 Sidebar）
│   ├── hooks/              # 主题等 React hooks
│   ├── i18n/               # 中/英文案与 I18nProvider
│   ├── pages/              # 首页、整理、历史、统计、设置
│   ├── stores/             # Zustand（设置、历史、统计）
│   ├── App.tsx
│   └── main.tsx
├── src-tauri/
│   ├── src/
│   │   ├── main.rs         # Tauri 命令与扫描流水线
│   │   ├── ai.rs           # 多模型与流式分类
│   │   └── organizer.rs    # 扫描、移动、分组、跨卷安全移动
│   ├── icons/
│   └── tauri.conf.json
├── .github/workflows/      # publish.yml（标签触发构建）
├── package.json
└── README.md / README.zh-CN.md
```

---

## 参与贡献

欢迎提交 Issue 与 Pull Request。建议：

1. 改动聚焦、风格与现有代码一致。
2. 提交前运行 `pnpm exec tsc --noEmit` 与 `src-tauri` 下的 `cargo test`。
3. 若涉及用户可见行为，请同步更新文档。

---

## 开源协议

[MIT](LICENSE)

---

<div align="center">

**StowMind** — *收好文件，理清思路。*

</div>
