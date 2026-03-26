#!/bin/bash

# AI 文件整理工具 - 一键启动脚本

set -e

echo "🚀 启动 AI 文件整理工具"
echo "================================"
echo ""

# 检查 Ollama 服务
echo "📋 检查 Ollama 服务..."
if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo "✅ Ollama 服务正常"
    if command -v ollama &> /dev/null; then
        if ollama list 2>/dev/null | grep -q "qwen3:4b"; then
            echo "✅ qwen3:4b 模型已就绪"
        else
            echo "⚠️  未找到 qwen3:4b 模型，可在设置中配置其他模型"
        fi
    fi
else
    echo "⚠️  Ollama 服务未运行"
    echo "   可使用云端 API (OpenAI/Claude) 或启动 Ollama"
fi

echo ""
echo "================================"
echo ""

# 检查依赖是否安装
if [ ! -d "node_modules" ]; then
    echo "📦 首次运行，安装依赖..."
    pnpm install
fi

# 启动应用
echo "🖥️  启动应用 (首次编译可能需要几分钟)..."
echo ""
pnpm tauri dev
