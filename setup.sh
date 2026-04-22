#!/bin/bash

# AI 文件整理工具 - 一键安装脚本
# 支持 macOS 和 Windows (Git Bash/WSL)

set -e

echo "🚀 AI 文件整理工具 - 安装向导"
echo "================================"
echo ""

# 检测操作系统
OS="unknown"
if [[ "$OSTYPE" == "darwin"* ]]; then
    OS="macos"
elif [[ "$OSTYPE" == "linux-gnu"* ]] || [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
    OS="linux"
fi
echo "📋 检测到操作系统: $OS"

# 检查 Node.js
echo ""
echo "📋 检查 Node.js..."
if ! command -v node &> /dev/null; then
    echo "❌ 未找到 Node.js"
    echo "   请安装 Node.js 18+: https://nodejs.org/"
    exit 1
fi
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js 版本过低，需要 18+"
    exit 1
fi
echo "✅ Node.js $(node -v)"

# 检查 pnpm
echo ""
echo "📋 检查 pnpm..."
if ! command -v pnpm &> /dev/null; then
    echo "⚠️  未找到 pnpm，正在安装..."
    npm install -g pnpm
fi
echo "✅ pnpm $(pnpm -v)"

# 检查 Rust
echo ""
echo "📋 检查 Rust..."
if ! command -v rustc &> /dev/null; then
    echo "❌ 未找到 Rust"
    echo "   请安装 Rust: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    exit 1
fi
echo "✅ Rust $(rustc --version | cut -d' ' -f2)"

# 检查 Ollama (可选)
echo ""
echo "📋 检查 Ollama (可选)..."
if command -v ollama &> /dev/null; then
    echo "✅ Ollama 已安装"
    if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
        echo "✅ Ollama 服务正在运行"
        if ollama list 2>/dev/null | grep -q "qwen3:4b"; then
            echo "✅ qwen3:4b 模型已安装"
        else
            echo "⚠️  未找到 qwen3:4b 模型"
            read -p "是否现在下载？(y/n) " -n 1 -r
            echo
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                ollama pull qwen3:4b
            fi
        fi
    else
        echo "⚠️  Ollama 服务未运行，请启动 Ollama 应用"
    fi
else
    echo "⚠️  未安装 Ollama (可选，用于本地 AI)"
    echo "   下载地址: https://ollama.ai"
fi

# 检查 Mole (可选 - 深度清理功能)
echo ""
echo "📋 检查 Mole (可选，用于深度清理)..."
if command -v mo &> /dev/null; then
    echo "✅ Mole 已安装 ($(mo --version 2>/dev/null || echo '未知版本'))"
else
    echo "⚠️  未安装 Mole (可选，用于系统深度清理)"
    if [[ "$OS" == "macos" ]]; then
        echo "   安装: brew install mole"
        echo "   或: curl -fsSL https://raw.githubusercontent.com/tw93/mole/main/install.sh | bash"
    else
        echo "   安装: irm https://raw.githubusercontent.com/tw93/Mole/windows/install.ps1 | iex"
    fi
    echo "   项目地址: https://github.com/tw93/Mole"
fi

# 安装前端依赖
echo ""
echo "📦 安装前端依赖..."
pnpm install

# 检查 Tauri CLI
echo ""
echo "📋 检查 Tauri CLI..."
if ! pnpm tauri --version &> /dev/null; then
    echo "Tauri CLI 将在首次运行时自动安装"
fi

echo ""
echo "================================"
echo "🎉 安装完成！"
echo "================================"
echo ""
echo "使用方法："
echo ""
echo "  开发模式:  ./start.sh 或 pnpm tauri dev"
echo "  构建应用:  pnpm tauri build"
echo ""
echo "⚠️  首次运行会编译 Rust 代码，可能需要几分钟"
echo ""
