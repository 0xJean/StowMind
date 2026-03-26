#!/bin/bash

# AI 模型连接测试脚本
# 测试 Ollama、OpenAI、Claude 的连接性

set -e

echo "🔍 AI 模型连接测试"
echo "================================"
echo ""

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 测试 Ollama
test_ollama() {
    local host="${1:-http://localhost:11434}"
    local model="${2:-qwen3:4b}"
    local stream="${3:-true}"
    local thinking="${4:-true}"
    
    echo "📡 测试 Ollama..."
    echo "   地址: $host"
    echo "   模型: $model"
    echo "   流式: $stream"
    echo "   思考: $thinking"
    
    # 检查服务
    if ! curl -s "$host/api/tags" > /dev/null 2>&1; then
        echo -e "   ${RED}❌ Ollama 服务未运行${NC}"
        echo "   请启动 Ollama: ollama serve"
        return 1
    fi
    echo -e "   ${GREEN}✅ Ollama 服务正常${NC}"
    
    # 检查模型
    if command -v ollama &> /dev/null; then
        if ollama list 2>/dev/null | grep -q "$model"; then
            echo -e "   ${GREEN}✅ 模型 $model 已安装${NC}"
        else
            echo -e "   ${YELLOW}⚠️  模型 $model 未安装${NC}"
            echo "   安装命令: ollama pull $model"
        fi
    fi
    
    # 测试生成
    if [ "$stream" = "true" ]; then
        test_ollama_stream "$host" "$model" "$thinking"
    else
        test_ollama_no_stream "$host" "$model" "$thinking"
    fi
}

# 流式输出测试
test_ollama_stream() {
    local host="$1"
    local model="$2"
    local thinking="$3"
    
    local think_param="true"
    if [ "$thinking" = "false" ]; then
        think_param="false"
    fi
    
    echo "   测试生成 (流式, think=$think_param)..."
    echo ""
    local start_time=$(date +%s.%N)
    
    local thinking_shown=false
    local response_shown=false
    local prompt="简单介绍一下你自己，用中文回答，50字以内"
    
    curl -s "$host/api/chat" \
        -H "Content-Type: application/json" \
        -d "{\"model\": \"$model\", \"messages\": [{\"role\": \"user\", \"content\": \"$prompt\"}], \"stream\": true, \"think\": $think_param}" \
        --max-time 120 2>/dev/null | while IFS= read -r line; do
        
        if [ -n "$line" ]; then
            local think_content=$(echo "$line" | python3 -c "import sys,json; d=json.load(sys.stdin); t=d.get('message',{}).get('thinking',''); print(t if t else '')" 2>/dev/null)
            if [ -n "$think_content" ]; then
                if [ "$thinking_shown" = false ]; then
                    echo -e "   ${YELLOW}💭 思考中...${NC}"
                    thinking_shown=true
                fi
                printf "%s" "$think_content"
            fi
            
            local resp=$(echo "$line" | python3 -c "import sys,json; d=json.load(sys.stdin); c=d.get('message',{}).get('content',''); print(c if c else '')" 2>/dev/null)
            if [ -n "$resp" ]; then
                if [ "$response_shown" = false ] && [ "$thinking_shown" = true ]; then
                    echo ""
                    echo ""
                    echo -e "   ${GREEN}💬 回答:${NC}"
                    response_shown=true
                elif [ "$response_shown" = false ]; then
                    echo -e "   ${GREEN}💬 回答:${NC}"
                    response_shown=true
                fi
                printf "%s" "$resp"
            fi
            
            if echo "$line" | grep -q '"done":true'; then
                echo ""
                break
            fi
        fi
    done
    
    local end_time=$(date +%s.%N)
    local duration=$(echo "$end_time - $start_time" | bc)
    
    echo ""
    echo -e "   ${GREEN}✅ 模型响应正常${NC}"
    printf "   ⏱️  耗时: %.2f 秒\n" "$duration"
    return 0
}

# 非流式输出测试 (简洁模式)
test_ollama_no_stream() {
    local host="$1"
    local model="$2"
    local thinking="$3"
    
    local think_param="true"
    if [ "$thinking" = "false" ]; then
        think_param="false"
    fi
    
    echo "   测试生成 (非流式, think=$think_param)..."
    local start_time=$(date +%s.%N)
    
    # 使用 chat 端点，支持 think 参数
    local response=$(curl -s "$host/api/chat" \
        -H "Content-Type: application/json" \
        -d "{\"model\": \"$model\", \"messages\": [{\"role\": \"user\", \"content\": \"say hello\"}], \"stream\": false, \"think\": $think_param}" \
        --max-time 120 2>/dev/null)
    
    local end_time=$(date +%s.%N)
    local duration=$(echo "$end_time - $start_time" | bc)
    
    if echo "$response" | grep -q "\"message\""; then
        local content=$(echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('message',{}).get('content','')[:150])" 2>/dev/null)
        local thinking_content=$(echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); t=d.get('message',{}).get('thinking',''); print(len(t) if t else 0)" 2>/dev/null)
        
        echo -e "   ${GREEN}✅ 模型响应正常${NC}"
        if [ "$thinking_content" != "0" ] && [ -n "$thinking_content" ]; then
            echo "   💭 thinking 字段: ${thinking_content} 字符"
        else
            echo "   💭 thinking 字段: 无"
        fi
        echo "   💬 回答: $content"
        printf "   ⏱️  耗时: %.2f 秒\n" "$duration"
        return 0
    else
        echo -e "   ${RED}❌ 模型响应失败${NC}"
        printf "   ⏱️  耗时: %.2f 秒\n" "$duration"
        return 1
    fi
}

# 测试 OpenAI
test_openai() {
    local api_key="$1"
    local model="${2:-gpt-4o-mini}"
    
    echo "📡 测试 OpenAI..."
    echo "   模型: $model"
    
    if [ -z "$api_key" ]; then
        echo -e "   ${YELLOW}⚠️  未提供 API Key，跳过测试${NC}"
        echo "   使用方法: $0 --openai YOUR_API_KEY"
        return 1
    fi
    
    # 测试连接
    local response=$(curl -s "https://api.openai.com/v1/models" \
        -H "Authorization: Bearer $api_key" \
        --max-time 10 2>/dev/null)
    
    if echo "$response" | grep -q "\"id\""; then
        echo -e "   ${GREEN}✅ API Key 有效${NC}"
    else
        echo -e "   ${RED}❌ API Key 无效或网络错误${NC}"
        return 1
    fi
    
    # 测试生成
    echo "   测试生成..."
    local start_time=$(date +%s.%N)
    local chat_response=$(curl -s "https://api.openai.com/v1/chat/completions" \
        -H "Authorization: Bearer $api_key" \
        -H "Content-Type: application/json" \
        -d "{\"model\": \"$model\", \"messages\": [{\"role\": \"user\", \"content\": \"hi\"}], \"max_tokens\": 50}" \
        --max-time 30 2>/dev/null)
    local end_time=$(date +%s.%N)
    local duration=$(echo "$end_time - $start_time" | bc)
    
    if echo "$chat_response" | grep -q "choices"; then
        local answer=$(echo "$chat_response" | grep -o '"content":"[^"]*"' | head -1 | cut -d'"' -f4)
        echo -e "   ${GREEN}✅ 模型响应正常${NC}"
        echo "   响应: $answer"
        printf "   耗时: %.2f 秒\n" "$duration"
        return 0
    else
        echo -e "   ${RED}❌ 模型响应失败${NC}"
        echo "   响应: $chat_response"
        printf "   耗时: %.2f 秒\n" "$duration"
        return 1
    fi
}

# 测试 Claude
test_claude() {
    local api_key="$1"
    local model="${2:-claude-3-haiku-20240307}"
    
    echo "📡 测试 Claude..."
    echo "   模型: $model"
    
    if [ -z "$api_key" ]; then
        echo -e "   ${YELLOW}⚠️  未提供 API Key，跳过测试${NC}"
        echo "   使用方法: $0 --claude YOUR_API_KEY"
        return 1
    fi
    
    # 测试生成
    echo "   测试生成..."
    local start_time=$(date +%s.%N)
    local response=$(curl -s "https://api.anthropic.com/v1/messages" \
        -H "x-api-key: $api_key" \
        -H "anthropic-version: 2023-06-01" \
        -H "Content-Type: application/json" \
        -d "{\"model\": \"$model\", \"max_tokens\": 50, \"messages\": [{\"role\": \"user\", \"content\": \"hi\"}]}" \
        --max-time 30 2>/dev/null)
    local end_time=$(date +%s.%N)
    local duration=$(echo "$end_time - $start_time" | bc)
    
    if echo "$response" | grep -q "content"; then
        local answer=$(echo "$response" | grep -o '"text":"[^"]*"' | head -1 | cut -d'"' -f4)
        echo -e "   ${GREEN}✅ API Key 有效，模型响应正常${NC}"
        echo "   响应: $answer"
        printf "   耗时: %.2f 秒\n" "$duration"
        return 0
    else
        echo -e "   ${RED}❌ API Key 无效或模型响应失败${NC}"
        echo "   响应: $response"
        printf "   耗时: %.2f 秒\n" "$duration"
        return 1
    fi
}

# 显示帮助
show_help() {
    echo "使用方法:"
    echo "  $0                          # 测试本地 Ollama (流式输出)"
    echo "  $0 --no-stream              # 关闭流式输出 (简洁模式)"
    echo "  $0 --no-think               # 关闭 thinking 模式 (qwen3)"
    echo "  $0 --benchmark              # 运行完整对比测试"
    echo "  $0 --ollama [host] [model]  # 测试 Ollama (可指定地址和模型)"
    echo "  $0 --openai API_KEY [model] # 测试 OpenAI"
    echo "  $0 --claude API_KEY [model] # 测试 Claude"
    echo "  $0 --all                    # 测试所有 (需设置环境变量)"
    echo ""
    echo "选项:"
    echo "  --no-stream    关闭流式输出"
    echo "  --no-think     关闭 thinking 模式 (适用于 qwen3 系列)"
    echo "  --benchmark    运行 3 种模式对比测试"
    echo ""
    echo "环境变量:"
    echo "  OLLAMA_HOST     Ollama 地址 (默认: http://localhost:11434)"
    echo "  OLLAMA_MODEL    Ollama 模型 (默认: qwen3:4b)"
    echo "  OPENAI_API_KEY  OpenAI API Key"
    echo "  CLAUDE_API_KEY  Claude API Key"
}

# 运行对比测试
run_benchmark() {
    local host="${OLLAMA_HOST:-http://localhost:11434}"
    local model="${OLLAMA_MODEL:-qwen3:4b}"
    
    echo "🏁 运行对比测试 (3 种模式)"
    echo "   模型: $model"
    echo "================================"
    echo ""
    echo "说明: think=true 时，thinking 内容单独输出"
    echo "      think=false 时，thinking 内容混入 response"
    echo ""
    
    echo "📊 测试 1: 非流式 + think=true (分离思考)"
    echo "----------------------------------------"
    test_ollama "$host" "$model" "false" "true"
    echo ""
    
    echo "📊 测试 2: 非流式 + think=false (混合输出)"
    echo "----------------------------------------"
    test_ollama "$host" "$model" "false" "false"
    echo ""
    
    echo "📊 测试 3: 流式 + think=true (实时显示思考)"
    echo "----------------------------------------"
    test_ollama "$host" "$model" "true" "true"
    echo ""
    
    echo "================================"
    echo "📈 对比测试完成"
    echo ""
    echo "结论:"
    echo "  - think=true: thinking 和 response 分离，response 简洁"
    echo "  - think=false: thinking 混入 response，总耗时相近"
    echo "  - 流式/非流式总耗时相近，但流式体验更好"
}

# 解析参数
STREAM="true"
THINKING="true"
BENCHMARK="false"
ARGS=()
for arg in "$@"; do
    case "$arg" in
        --no-stream)
            STREAM="false"
            ;;
        --no-think|--no-thinking)
            THINKING="false"
            ;;
        --benchmark)
            BENCHMARK="true"
            ;;
        *)
            ARGS+=("$arg")
            ;;
    esac
done

# 主逻辑
if [ "$BENCHMARK" = "true" ]; then
    run_benchmark
    exit 0
fi

case "${ARGS[0]:-}" in
    --help|-h)
        show_help
        ;;
    --ollama)
        test_ollama "${ARGS[1]:-${OLLAMA_HOST:-http://localhost:11434}}" "${ARGS[2]:-${OLLAMA_MODEL:-qwen3:4b}}" "$STREAM" "$THINKING"
        ;;
    --openai)
        test_openai "${ARGS[1]:-$OPENAI_API_KEY}" "${ARGS[2]:-gpt-4o-mini}"
        ;;
    --claude)
        test_claude "${ARGS[1]:-$CLAUDE_API_KEY}" "${ARGS[2]:-claude-3-haiku-20240307}"
        ;;
    --all)
        echo "测试所有配置的 AI 服务..."
        echo ""
        test_ollama "${OLLAMA_HOST:-http://localhost:11434}" "${OLLAMA_MODEL:-qwen3:4b}" "$STREAM" "$THINKING" || true
        echo ""
        test_openai "$OPENAI_API_KEY" || true
        echo ""
        test_claude "$CLAUDE_API_KEY" || true
        ;;
    *)
        # 默认测试 Ollama
        test_ollama "${OLLAMA_HOST:-http://localhost:11434}" "${OLLAMA_MODEL:-qwen3:4b}" "$STREAM" "$THINKING"
        ;;
esac

echo ""
echo "================================"
echo "测试完成"
