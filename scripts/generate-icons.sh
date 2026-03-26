#!/bin/bash

# AI 文件整理工具 - 图标生成脚本 (macOS)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ICON_DIR="$PROJECT_DIR/src-tauri/icons"
SVG_FILE="$PROJECT_DIR/public/icon.svg"

echo "🎨 生成应用图标..."

# 创建图标目录
mkdir -p "$ICON_DIR"

# 检查是否有 rsvg-convert (用于 SVG 转 PNG)
if command -v rsvg-convert &> /dev/null; then
    echo "使用 rsvg-convert 转换 SVG..."
    rsvg-convert -w 512 -h 512 "$SVG_FILE" -o "$ICON_DIR/icon_512.png"
elif command -v npx &> /dev/null; then
    echo "尝试使用 tauri icon 命令..."
    cd "$PROJECT_DIR"
    npx tauri icon "$SVG_FILE" 2>/dev/null && echo "✅ 图标生成完成" && exit 0
fi

# 如果上面的方法都不行，创建一个简单的占位图标
echo "创建占位图标..."

# 使用 sips 创建纯色图标作为占位
create_placeholder() {
    local size=$1
    local output=$2
    
    # 创建一个临时的 TIFF 文件
    local temp_file=$(mktemp).tiff
    
    # 使用 Python 创建简单图标
    python3 << EOF
from PIL import Image, ImageDraw
import sys

size = $size
img = Image.new('RGBA', (size, size), (99, 102, 241, 255))
draw = ImageDraw.Draw(img)

# 绘制圆角矩形背景
# 简单起见，直接保存纯色图标
img.save('$output', 'PNG')
print(f'Created {size}x{size} icon')
EOF
}

# 检查是否有 Pillow
if python3 -c "from PIL import Image" 2>/dev/null; then
    echo "使用 Python Pillow 生成图标..."
    
    python3 << 'PYTHON_SCRIPT'
from PIL import Image, ImageDraw
import os

icon_dir = os.environ.get('ICON_DIR', 'src-tauri/icons')
os.makedirs(icon_dir, exist_ok=True)

sizes = [32, 128, 256, 512]

for size in sizes:
    # 创建渐变背景
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # 绘制圆角矩形
    radius = size // 5
    draw.rounded_rectangle(
        [(0, 0), (size-1, size-1)],
        radius=radius,
        fill=(99, 102, 241, 255)
    )
    
    # 绘制文件夹图标 (简化版)
    folder_margin = size // 4
    folder_height = size // 3
    draw.rounded_rectangle(
        [(folder_margin, folder_margin + size//8), 
         (size - folder_margin, size - folder_margin)],
        radius=size//20,
        fill=(255, 255, 255, 230)
    )
    
    # 保存
    if size == 256:
        img.save(f'{icon_dir}/128x128@2x.png', 'PNG')
    img.save(f'{icon_dir}/{size}x{size}.png', 'PNG')
    print(f'✅ 生成 {size}x{size}.png')

# 生成 .icns (macOS)
print('\n生成 macOS .icns 文件...')
os.system(f'mkdir -p {icon_dir}/icon.iconset')
for size in [16, 32, 64, 128, 256, 512]:
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    radius = size // 5
    draw.rounded_rectangle([(0, 0), (size-1, size-1)], radius=radius, fill=(99, 102, 241, 255))
    folder_margin = size // 4
    draw.rounded_rectangle(
        [(folder_margin, folder_margin + size//8), (size - folder_margin, size - folder_margin)],
        radius=max(1, size//20),
        fill=(255, 255, 255, 230)
    )
    img.save(f'{icon_dir}/icon.iconset/icon_{size}x{size}.png', 'PNG')
    if size <= 256:
        img2 = img.resize((size*2, size*2), Image.LANCZOS)
        img2.save(f'{icon_dir}/icon.iconset/icon_{size}x{size}@2x.png', 'PNG')

os.system(f'iconutil -c icns {icon_dir}/icon.iconset -o {icon_dir}/icon.icns 2>/dev/null')
os.system(f'rm -rf {icon_dir}/icon.iconset')

if os.path.exists(f'{icon_dir}/icon.icns'):
    print('✅ 生成 icon.icns')
else:
    print('⚠️  无法生成 .icns 文件')

print('\n✅ 图标生成完成!')
print('⚠️  注意: Windows .ico 文件需要在 Windows 上生成或使用在线工具')
PYTHON_SCRIPT

else
    echo "❌ 需要安装 Python Pillow: pip3 install Pillow"
    echo ""
    echo "或者使用 Tauri 官方工具:"
    echo "  npx tauri icon public/icon.svg"
    exit 1
fi
