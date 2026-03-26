#!/usr/bin/env python3
"""生成 Tauri 应用图标"""
from PIL import Image, ImageDraw
import os
import subprocess

icon_dir = 'src-tauri/icons'
os.makedirs(icon_dir, exist_ok=True)

sizes = [32, 128, 256, 512]

def create_icon(size):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # 圆角矩形背景
    radius = size // 5
    draw.rounded_rectangle(
        [(0, 0), (size-1, size-1)],
        radius=radius,
        fill=(99, 102, 241, 255)  # 紫色
    )
    
    # 文件夹图标
    folder_margin = size // 4
    draw.rounded_rectangle(
        [(folder_margin, folder_margin + size//8), 
         (size - folder_margin, size - folder_margin)],
        radius=max(1, size//20),
        fill=(255, 255, 255, 230)
    )
    
    # AI 星星装饰
    star_x = size - folder_margin - size//8
    star_y = folder_margin
    star_r = size // 12
    draw.ellipse(
        [(star_x - star_r, star_y - star_r), (star_x + star_r, star_y + star_r)],
        fill=(251, 191, 36, 255)  # 金色
    )
    
    return img

# 生成 PNG 图标
for size in sizes:
    img = create_icon(size)
    if size == 256:
        img.save(f'{icon_dir}/128x128@2x.png', 'PNG')
    img.save(f'{icon_dir}/{size}x{size}.png', 'PNG')
    print(f'✅ 生成 {size}x{size}.png')

# 生成 macOS .icns
print('\n生成 macOS .icns 文件...')
iconset_dir = f'{icon_dir}/icon.iconset'
os.makedirs(iconset_dir, exist_ok=True)

for size in [16, 32, 64, 128, 256, 512]:
    img = create_icon(size)
    img.save(f'{iconset_dir}/icon_{size}x{size}.png', 'PNG')
    if size <= 256:
        img2 = create_icon(size * 2)
        img2.save(f'{iconset_dir}/icon_{size}x{size}@2x.png', 'PNG')

# 使用 iconutil 生成 .icns
subprocess.run(['iconutil', '-c', 'icns', iconset_dir, '-o', f'{icon_dir}/icon.icns'], check=True)
subprocess.run(['rm', '-rf', iconset_dir])
print('✅ 生成 icon.icns')

# 生成 Windows .ico
print('\n生成 Windows .ico 文件...')
ico_sizes = [16, 32, 48, 64, 128, 256]
ico_images = [create_icon(s) for s in ico_sizes]
ico_images[0].save(f'{icon_dir}/icon.ico', format='ICO', sizes=[(s, s) for s in ico_sizes], append_images=ico_images[1:])
print('✅ 生成 icon.ico')

print('\n🎉 所有图标生成完成!')
