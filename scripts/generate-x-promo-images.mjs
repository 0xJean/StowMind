import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const outDir = path.join(repoRoot, "assets", "banners", "stowmind-x");
const width = 1600;
const height = 900;
const font =
  '"Inter", "SF Pro Display", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Arial, sans-serif';

const esc = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

function text(x, y, content, size, color = "#111827", weight = 500, extra = "") {
  return `<text x="${x}" y="${y}" font-family="${esc(font)}" font-size="${size}" font-weight="${weight}" fill="${color}" ${extra}>${esc(content)}</text>`;
}

function lines(x, y, rows, size, lineHeight, color = "#111827", weight = 500, extra = "") {
  return rows
    .map((row, index) =>
      text(x, y + index * lineHeight, row, size, color, weight, extra),
    )
    .join("");
}

function rect(x, y, w, h, r, fill, extra = "") {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" ${extra}/>`;
}

function chip(x, y, label, fill = "#EEF2FF", color = "#4338CA", stroke = "none", w = null) {
  const chipWidth = w ?? Math.max(98, label.length * 20 + 38);
  return [
    rect(x, y, chipWidth, 44, 22, fill, stroke === "none" ? "" : `stroke="${stroke}"`),
    text(x + 20, y + 29, label, 20, color, 700),
  ].join("");
}

function appIcon(x, y, size) {
  const s = size / 24;
  return `
    <g transform="translate(${x} ${y}) scale(${s})">
      <rect x="0" y="0" width="24" height="24" rx="5" fill="#6366F1"/>
      <g transform="translate(3.84 3.84) scale(0.68)" stroke="#FFFFFF" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" fill="none">
        <path d="M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z"/>
        <path d="M20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.92-.6H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z"/>
        <path d="M3 5a2 2 0 0 0 2 2h3"/>
        <path d="M3 3v13a2 2 0 0 0 2 2h3"/>
      </g>
    </g>`;
}

function cardShell(bg, body, defs = "") {
  return `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <filter id="softShadow" x="-20%" y="-20%" width="140%" height="150%">
        <feDropShadow dx="0" dy="24" stdDeviation="30" flood-color="#0F172A" flood-opacity="0.16"/>
      </filter>
      <filter id="smallShadow" x="-20%" y="-20%" width="140%" height="150%">
        <feDropShadow dx="0" dy="12" stdDeviation="18" flood-color="#0F172A" flood-opacity="0.12"/>
      </filter>
      ${defs}
    </defs>
    ${bg}
    ${body}
  </svg>`;
}

function topBrand(x = 96, y = 76, dark = false) {
  return [
    appIcon(x, y - 38, 54),
    text(x + 72, y, "StowMind", 30, dark ? "#F8FAFC" : "#111827", 800),
    text(x + 72, y + 32, "AI file organizer", 18, dark ? "#CBD5E1" : "#64748B", 600),
  ].join("");
}

function mockWindow(x, y, w, h, dark = false) {
  const surface = dark ? "#111827" : "#FFFFFF";
  const line = dark ? "#334155" : "#E2E8F0";
  const muted = dark ? "#94A3B8" : "#64748B";
  const fg = dark ? "#F8FAFC" : "#111827";
  const sidebar = dark ? "#0F172A" : "#F8FAFC";
  return `
    <g filter="url(#softShadow)">
      ${rect(x, y, w, h, 28, surface)}
      ${rect(x, y, w, 62, 28, dark ? "#1E293B" : "#F8FAFC")}
      <circle cx="${x + 32}" cy="${y + 31}" r="8" fill="#FB7185"/>
      <circle cx="${x + 58}" cy="${y + 31}" r="8" fill="#FBBF24"/>
      <circle cx="${x + 84}" cy="${y + 31}" r="8" fill="#34D399"/>
      ${rect(x + 24, y + 88, 190, h - 116, 18, sidebar)}
      ${chip(x + 44, y + 118, "整理文件", dark ? "#312E81" : "#EEF2FF", dark ? "#C7D2FE" : "#4338CA", "none", 126)}
      ${text(x + 44, y + 212, "历史记录", 20, muted, 650)}
      ${text(x + 44, y + 268, "统计", 20, muted, 650)}
      ${text(x + 44, y + 324, "设置", 20, muted, 650)}
      ${text(x + 248, y + 128, "分类结果", 30, fg, 800)}
      ${text(x + 248, y + 168, "扫描完成：32 个文件", 19, muted, 600)}
      ${fileRow(x + 248, y + 214, w - 292, "report.pdf", "文档", "#6366F1", dark)}
      ${fileRow(x + 248, y + 286, w - 292, "image.png", "图片", "#0EA5E9", dark)}
      ${fileRow(x + 248, y + 358, w - 292, "invoice.xls", "表格", "#10B981", dark)}
      <line x1="${x + 248}" y1="${y + h - 100}" x2="${x + w - 44}" y2="${y + h - 100}" stroke="${line}" stroke-width="2"/>
      ${rect(x + w - 240, y + h - 72, 184, 48, 24, "#6366F1")}
      ${text(x + w - 194, y + h - 41, "预览移动", 20, "#FFFFFF", 800)}
    </g>`;
}

function fileRow(x, y, w, name, category, accent, dark) {
  const surface = dark ? "#1E293B" : "#F8FAFC";
  const fg = dark ? "#E2E8F0" : "#111827";
  const muted = dark ? "#94A3B8" : "#64748B";
  return `
    ${rect(x, y, w, 54, 14, surface, `stroke="${dark ? "#334155" : "#E2E8F0"}"`)}
    <circle cx="${x + 30}" cy="${y + 27}" r="10" fill="${accent}"/>
    ${text(x + 54, y + 34, name, 20, fg, 700)}
    ${rect(x + w - 118, y + 11, 82, 32, 16, `${accent}1A`)}
    ${text(x + w - 96, y + 33, category, 17, muted, 700)}
  `;
}

function overview() {
  const bg = `
    <rect width="1600" height="900" fill="#F8FAFC"/>
    <circle cx="1290" cy="110" r="260" fill="#DBEAFE"/>
    <circle cx="1370" cy="760" r="220" fill="#CCFBF1"/>
    <path d="M0 760 C280 640 460 860 760 750 C1030 650 1240 710 1600 610 L1600 900 L0 900 Z" fill="#EEF2FF"/>
    <path d="M1030 128 L1480 128" stroke="#CBD5E1" stroke-width="2" stroke-dasharray="10 14"/>
  `;
  const body = `
    ${topBrand()}
    ${chip(96, 188, "桌面文件整理工具", "#ECFEFF", "#0F766E", "none", 194)}
    ${lines(96, 292, ["下载夹乱了？", "StowMind 自动归类"], 68, 82, "#0F172A", 900)}
    ${lines(100, 520, ["规则优先处理常见文件，疑难项再交给 AI。", "扫描、预览、执行、撤销，一套流程把风险降下来。"], 31, 47, "#475569", 650)}
    ${rect(96, 676, 190, 58, 29, "#111827")}
    ${text(139, 714, "了解项目", 23, "#FFFFFF", 800)}
    ${chip(314, 684, "Rules first", "#FFFFFF", "#4338CA", "#C7D2FE", 146)}
    ${chip(482, 684, "AI when needed", "#FFFFFF", "#0F766E", "#99F6E4", 184)}
    ${mockWindow(876, 178, 584, 526)}
  `;
  return cardShell(bg, body);
}

function rulesAi() {
  const defs = `
    <linearGradient id="rulesBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0F172A"/>
      <stop offset="52%" stop-color="#1E293B"/>
      <stop offset="100%" stop-color="#042F2E"/>
    </linearGradient>
  `;
  const bg = `
    <rect width="1600" height="900" fill="url(#rulesBg)"/>
    <circle cx="250" cy="220" r="170" fill="#6366F1" opacity="0.22"/>
    <circle cx="1340" cy="680" r="260" fill="#14B8A6" opacity="0.18"/>
    <path d="M950 84 C1170 190 1120 420 1375 505" stroke="#38BDF8" stroke-width="3" opacity="0.35" fill="none"/>
  `;
  const stepY = 620;
  const body = `
    ${topBrand(96, 76, true)}
    ${chip(96, 184, "更快，也更省", "#0F766E", "#CCFBF1", "none", 154)}
    ${lines(96, 292, ["规则先跑，", "AI 只处理疑难文件"], 76, 90, "#F8FAFC", 900)}
    ${lines(100, 494, ["扩展名、关键词、父目录提示先命中；", "无法判断时再调用 Ollama / OpenAI / Claude。"], 30, 44, "#CBD5E1", 650)}
    ${pipelineStep(124, stepY, "01", "扩展名规则", ".pdf / .png / .zip", "#818CF8")}
    ${arrow(405, stepY + 62, "#94A3B8")}
    ${pipelineStep(484, stepY, "02", "关键词匹配", "合同 / 截图 / 发票", "#22D3EE")}
    ${arrow(765, stepY + 62, "#94A3B8")}
    ${pipelineStep(844, stepY, "03", "目录提示", "Downloads / Projects", "#34D399")}
    ${arrow(1125, stepY + 62, "#94A3B8")}
    ${pipelineStep(1204, stepY, "04", "AI 判断", "仅疑难项", "#FBBF24")}
    ${rect(1030, 150, 430, 270, 28, "#F8FAFC", 'filter="url(#softShadow)" opacity="0.98"')}
    ${text(1082, 220, "32 个文件", 34, "#0F172A", 900)}
    ${text(1082, 262, "本次扫描结果", 21, "#64748B", 700)}
    ${metricBar(1082, 318, 298, "规则命中", "28", "#6366F1")}
    ${metricBar(1082, 374, 106, "AI 处理", "4", "#14B8A6")}
  `;
  return cardShell(bg, body, defs);
}

function pipelineStep(x, y, num, title, subtitle, color) {
  return `
    <g filter="url(#smallShadow)">
      ${rect(x, y, 244, 138, 24, "#F8FAFC")}
      ${rect(x + 22, y + 22, 54, 36, 18, `${color}22`)}
      ${text(x + 37, y + 47, num, 19, color, 900)}
      ${text(x + 22, y + 90, title, 26, "#0F172A", 850)}
      ${text(x + 22, y + 120, subtitle, 18, "#64748B", 650)}
    </g>`;
}

function arrow(x, y, color) {
  return `
    <path d="M${x} ${y} L${x + 46} ${y}" stroke="${color}" stroke-width="5" stroke-linecap="round"/>
    <path d="M${x + 46} ${y} L${x + 30} ${y - 13} M${x + 46} ${y} L${x + 30} ${y + 13}" stroke="${color}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  `;
}

function metricBar(x, y, w, label, value, color) {
  return `
    ${text(x, y, label, 18, "#64748B", 700)}
    ${text(x + 320, y, value, 18, "#0F172A", 900, 'text-anchor="end"')}
    ${rect(x, y + 18, 320, 14, 7, "#E2E8F0")}
    ${rect(x, y + 18, w, 14, 7, color)}
  `;
}

function previewUndo() {
  const bg = `
    <rect width="1600" height="900" fill="#FFFBEB"/>
    <rect x="0" y="0" width="1600" height="900" fill="#FFFFFF" opacity="0.42"/>
    <circle cx="1180" cy="178" r="210" fill="#FED7AA" opacity="0.58"/>
    <circle cx="1420" cy="740" r="240" fill="#BAE6FD" opacity="0.58"/>
    <path d="M96 790 C380 690 540 820 780 726 C1000 640 1220 715 1504 610" stroke="#F59E0B" stroke-width="5" opacity="0.24" fill="none"/>
  `;
  const body = `
    ${topBrand()}
    ${chip(96, 184, "安全整理流程", "#FFF7ED", "#C2410C", "none", 168)}
    ${lines(96, 292, ["先预览，再移动；", "整理后也能撤销"], 76, 90, "#111827", 900)}
    ${lines(100, 516, ["移动前看到完整源路径与目标路径，", "执行失败时保留成功项并记录原因。"], 30, 46, "#475569", 650)}
    ${previewPanel(820, 150)}
    ${undoPanel(902, 594)}
    ${rect(96, 690, 250, 56, 28, "#EA580C")}
    ${text(139, 727, "适合真实磁盘操作", 22, "#FFFFFF", 850)}
    ${chip(372, 698, "Dry-run preview", "#FFFFFF", "#C2410C", "#FDBA74", 184)}
    ${chip(580, 698, "Undo from History", "#FFFFFF", "#0369A1", "#7DD3FC", 210)}
  `;
  return cardShell(bg, body);
}

function previewPanel(x, y) {
  return `
    <g filter="url(#softShadow)">
      ${rect(x, y, 616, 360, 28, "#FFFFFF")}
      ${text(x + 42, y + 68, "预览移动计划", 34, "#111827", 900)}
      ${text(x + 42, y + 108, "尚未写入磁盘", 20, "#64748B", 700)}
      ${moveRow(x + 42, y + 154, "Downloads/report.pdf", "文档/report.pdf", "#6366F1")}
      ${moveRow(x + 42, y + 224, "Desktop/screenshot.png", "图片/screenshot.png", "#0EA5E9")}
      ${moveRow(x + 42, y + 294, "Downloads/app.zip", "归档/app.zip", "#F59E0B")}
    </g>`;
}

function moveRow(x, y, from, to, color) {
  return `
    ${rect(x, y, 532, 52, 16, "#F8FAFC", 'stroke="#E2E8F0"')}
    <circle cx="${x + 26}" cy="${y + 26}" r="9" fill="${color}"/>
    ${text(x + 48, y + 33, from, 18, "#334155", 700)}
    ${text(x + 300, y + 33, "->", 18, "#94A3B8", 900)}
    ${text(x + 332, y + 33, to, 18, "#0F172A", 800)}
  `;
}

function undoPanel(x, y) {
  return `
    <g filter="url(#smallShadow)">
      ${rect(x, y, 446, 144, 26, "#111827")}
      ${text(x + 34, y + 48, "本次整理可一键撤销", 27, "#FFFFFF", 900)}
      ${text(x + 34, y + 86, "已成功移动 32 项", 19, "#CBD5E1", 650)}
      ${rect(x + 288, y + 45, 116, 48, 24, "#FFFFFF")}
      ${text(x + 324, y + 76, "撤销", 20, "#111827", 900)}
    </g>`;
}

function deepClean() {
  const defs = `
    <linearGradient id="cleanBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#F0FDFA"/>
      <stop offset="48%" stop-color="#F8FAFC"/>
      <stop offset="100%" stop-color="#EEF2FF"/>
    </linearGradient>
  `;
  const bg = `
    <rect width="1600" height="900" fill="url(#cleanBg)"/>
    <path d="M1050 92 C1270 180 1220 360 1458 430 C1540 455 1560 525 1490 590" stroke="#14B8A6" stroke-width="6" opacity="0.2" fill="none"/>
    <circle cx="220" cy="760" r="230" fill="#BFDBFE" opacity="0.45"/>
  `;
  const body = `
    ${topBrand()}
    ${chip(96, 184, "整理 + 清理", "#ECFEFF", "#0F766E", "none", 140)}
    ${lines(96, 292, ["不只归档文件，", "也能释放磁盘空间"], 76, 90, "#0F172A", 900)}
    ${lines(100, 516, ["集成开源 Mole：系统缓存、构建产物、磁盘分析，", "先预览再执行，避免误删。"], 30, 46, "#475569", 650)}
    ${cleanDashboard(842, 140)}
    ${featureTile(118, 690, "系统缓存", "清理日志、缓存、浏览器残留", "#0EA5E9")}
    ${featureTile(410, 690, "构建产物", "定位 node_modules / target", "#10B981")}
    ${featureTile(702, 690, "磁盘分析", "快速发现大文件和目录", "#F59E0B")}
  `;
  return cardShell(bg, body, defs);
}

function cleanDashboard(x, y) {
  return `
    <g filter="url(#softShadow)">
      ${rect(x, y, 620, 536, 30, "#FFFFFF")}
      ${text(x + 42, y + 70, "深度清理", 36, "#0F172A", 900)}
      ${text(x + 42, y + 110, "Mole powered cleanup", 20, "#64748B", 700)}
      ${ring(x + 160, y + 278, 112, 34, "#14B8A6", "18.6 GB")}
      ${text(x + 292, y + 220, "可释放空间", 25, "#0F172A", 900)}
      ${text(x + 292, y + 258, "预览结果，确认后才清理", 21, "#64748B", 650)}
      ${cleanRow(x + 292, y + 312, "System clean", "系统缓存与日志", "#0EA5E9")}
      ${cleanRow(x + 292, y + 374, "Build purge", "项目构建产物", "#10B981")}
      ${cleanRow(x + 292, y + 436, "Disk analyze", "目录空间分析", "#F59E0B")}
    </g>`;
}

function ring(cx, cy, r, stroke, color, label) {
  return `
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="#F8FAFC" stroke="#E2E8F0" stroke-width="${stroke}"/>
    <path d="M${cx} ${cy - r} A${r} ${r} 0 1 1 ${cx - 95} ${cy + 60}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"/>
    ${text(cx, cy + 10, label, 32, "#0F172A", 900, 'text-anchor="middle"')}
    ${text(cx, cy + 44, "preview", 18, "#64748B", 700, 'text-anchor="middle"')}
  `;
}

function cleanRow(x, y, title, subtitle, color) {
  return `
    ${rect(x, y, 250, 48, 16, "#F8FAFC", 'stroke="#E2E8F0"')}
    <circle cx="${x + 25}" cy="${y + 24}" r="9" fill="${color}"/>
    ${text(x + 46, y + 21, title, 17, "#0F172A", 850)}
    ${text(x + 46, y + 40, subtitle, 14, "#64748B", 650)}
  `;
}

function featureTile(x, y, title, subtitle, color) {
  return `
    <g filter="url(#smallShadow)">
      ${rect(x, y, 250, 108, 24, "#FFFFFF")}
      <circle cx="${x + 38}" cy="${y + 38}" r="14" fill="${color}"/>
      ${text(x + 66, y + 46, title, 24, "#0F172A", 900)}
      ${text(x + 26, y + 84, subtitle, 18, "#64748B", 650)}
    </g>`;
}

const images = [
  ["01-overview-1600x900", overview()],
  ["02-rules-ai-1600x900", rulesAi()],
  ["03-preview-undo-1600x900", previewUndo()],
  ["04-deep-clean-1600x900", deepClean()],
];

await mkdir(outDir, { recursive: true });

for (const [name, svg] of images) {
  const svgPath = path.join(outDir, `${name}.svg`);
  const pngPath = path.join(outDir, `${name}.png`);
  await writeFile(svgPath, svg, "utf8");
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(pngPath);
  console.log(`Wrote ${path.relative(repoRoot, pngPath)}`);
}
