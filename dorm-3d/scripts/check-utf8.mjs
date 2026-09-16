#!/usr/bin/env node
/** 递归检查 src/index.html 中所有文本文件是否为合法 UTF-8（不含 U+FFFD）。 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const roots = ['src', 'index.html'];
const allow = new Set(['.ts', '.css', '.html', '.js', '.mjs', '.json']);
let bad = 0;

function walk(p) {
  const st = statSync(p);
  if (st.isDirectory()) {
    for (const name of readdirSync(p)) {
      if (name === 'node_modules' || name === 'dist') continue;
      walk(join(p, name));
    }
  } else if (allow.has(extname(p))) {
    const buf = readFileSync(p);
    const text = buf.toString('utf8');
    if (text.includes('\uFFFD')) {
      console.error(`✗ U+FFFD found in ${p}`);
      bad++;
    }
  }
}

for (const r of roots) walk(r);
if (bad > 0) {
  console.error(`UTF-8 检查失败：${bad} 个文件包含替换字符`);
  process.exit(1);
}
console.log('✓ UTF-8 检查通过');
