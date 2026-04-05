<div align="center">

<img src="public/icon.svg" alt="StowMind" width="96" height="96" />

# StowMind

**AI file organizer · 智能文件整理**

*一款注重速度与隐私的桌面应用：先规则、后 AI，可预览再整理，支持撤销；部分失败时成功项仍会保留。*

[![License: MIT](https://img.shields.io/badge/License-MIT-indigo.svg)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-1.5-24C8D8?logo=tauri&logoColor=white)](https://tauri.app/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)

[English](README.md) · [简体中文](README.zh-CN.md)

</div>

---

## 目录

- [为什么选择 StowMind](#为什么选择-stowmind)
- [功能特性](#功能特性)
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

下载目录、项目目录里文件一多就难以维护。StowMind 先**扫描**目录，支持逐条**调整分类**，可选**预览移动**（不落盘），再**执行整理**；整理后可在历史或整理页**一键撤销**，跨卷时在无法 `rename` 时用**复制+删除**安全完成移动。

**部分成功不回滚**：有失败项时，已成功移动的文件会保留，失败原因会记录，而不是整批撤销。分类以**规则优先**（扩展名、文件名关键词、父目录名提示）为主，日常文件不必调用大模型。开启 **「AI 仅用于疑难文件」**（默认开启）可在保证效果的同时显著节省时间与 API 成本。

---

## 功能特性

| 模块 | 说明 |
|------|------|
| **分类** | 扩展名 + 关键词 + 目录提示规则；可选 Ollama / OpenAI / Claude |
| **成本与速度** | 默认「疑难才问 AI」：规则能命中则不请求模型 |
| **一致性** | 相似文件名分组；多数投票可统一同组分类 |
| **扫描范围** | 默认只扫描所选文件夹内一层文件；可开**递归扫描**；在设置中配置**排除规则**（如 `node_modules`、`.git`） |
| **整理流程** | **预览**（dry-run）仅列出源→目标；**执行**后真实移动；支持单条**改分类**与**本次不移动**勾选 |
| **安全** | 执行前确认；部分失败时成功项保留；历史 / 整理页**撤销** |
| **体验** | 整理页拖拽文件夹；浅色 / 深色 / 跟随系统；**中英文**界面 |
| **规则编辑** | 可折叠分类卡片、关键词编辑、排序、一键恢复默认规则 |
| **数据洞察** | 历史搜索与筛选；统计与近 7 日趋势 |

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

通过 [GitHub Actions](.github/workflows/publish.yml) 在推送版本标签时构建各平台安装包：

```bash
git tag v1.0.0
git push origin v1.0.0
```

Release 默认以**草稿**形式创建，请在 GitHub Releases 页面核对后再正式发布。

**支持平台：** macOS（Apple Silicon / Intel）、Windows、Linux（CI 基于 Ubuntu 环境构建）。

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

### 应用图标

`src-tauri/icons/` 下的资源通常由 `public/icon.svg` 生成。若 Tauri CLI 无法解析 SVG，可使用 Node（如 `sharp`、`png-to-ico`）或脚本生成 PNG / ICO / ICNS。

---

## 构建与发布

```bash
pnpm tauri build
```

产物位于 `src-tauri/target/release/bundle/`。多平台自动化构建请使用 **publish** 工作流（标签形如 `v*`）。

---

## 配置说明

### AI 模型

1. 打开 **设置**。
2. 选择 **Ollama**、**OpenAI** 或 **Claude**。
3. 填写模型名、Ollama 地址或云端 **API Key**。
4. 使用 **测试连接** 验证。
5. 建议保持 **AI 仅用于疑难文件** 开启，以减少调用次数。

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
