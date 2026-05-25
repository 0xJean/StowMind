#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.join(__dirname, '..');
const svgPath = path.join(projectDir, 'public/icon.svg');
const tempDir = path.join(os.tmpdir(), 'stowmind-icon-gen');
const tempPng = path.join(tempDir, 'stowmind-icon.png');

if (!fs.existsSync(svgPath)) {
  console.error(`Missing source icon: ${svgPath}`);
  process.exit(1);
}

fs.mkdirSync(tempDir, { recursive: true });

async function main() {
  await sharp(svgPath).resize(1024, 1024).png().toFile(tempPng);
  execFileSync(path.join(projectDir, 'node_modules/.bin/tauri'), ['icon', tempPng], {
    cwd: projectDir,
    stdio: 'inherit',
  });
  console.log('done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
