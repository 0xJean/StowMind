#!/usr/bin/env node

/**
 * 图标生成脚本
 * 
 * 使用方法:
 * 1. 安装依赖: npm install sharp png-to-ico
 * 2. 运行: node scripts/generate-icons.js
 * 
 * 或者使用在线工具:
 * - https://icon.kitchen/ (推荐)
 * - https://www.npmjs.com/package/tauri-icon
 */

const fs = require('fs');
const path = require('path');

// 检查是否安装了 sharp
let sharp;
try {
  sharp = require('sharp');
} catch (e) {
  console.log('请先安装依赖: npm install sharp png-to-ico');
  console.log('或者使用 tauri 官方工具: npm install -g @tauri-apps/cli && tauri icon public/icon.svg');
  process.exit(1);
}

const sizes = [32, 128, 256, 512];
const iconDir = path.join(__dirname, '../src-tauri/icons');

// 确保目录存在
if (!fs.existsSync(iconDir)) {
  fs.mkdirSync(iconDir, { recursive: true });
}

async function generateIcons() {
  const svgPath = path.join(__dirname, '../public/icon.svg');
  const svgBuffer = fs.readFileSync(svgPath);

  // 生成 PNG 图标
  for (const size of sizes) {
    const outputPath = path.join(iconDir, `${size}x${size}.png`);
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(outputPath);
    console.log(`✅ 生成 ${size}x${size}.png`);
  }

  // 生成 128x128@2x.png (256x256)
  await sharp(svgBuffer)
    .resize(256, 256)
    .png()
    .toFile(path.join(iconDir, '128x128@2x.png'));
  console.log('✅ 生成 128x128@2x.png');

  console.log('\n⚠️  注意: .icns 和 .ico 文件需要额外工具生成');
  console.log('推荐使用: npx tauri icon public/icon.svg');
}

generateIcons().catch(console.error);
