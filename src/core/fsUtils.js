import fs from 'node:fs/promises';
import path from 'node:path';
import { LIMITS } from '../config.js';
import { ErrorCode, ToolError } from './errors.js';
import { toPosix } from './pathGuard.js';

/**
 * Рекурсивно обходит директорию, не следуя за симлинками.
 * filter(relPath, dirent) => false исключает элемент (и поддерево для каталога).
 */
export async function walk(rootDir, { filter = () => true, maxDepth = Infinity } = {}) {
  const result = [];
  async function visit(dir, depth) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const abs = path.join(dir, entry.name);
      const rel = toPosix(path.relative(rootDir, abs));
      if (!filter(rel, entry)) continue;
      if (entry.isDirectory()) {
        result.push({ path: rel, type: 'dir', depth });
        if (depth < maxDepth) await visit(abs, depth + 1);
      } else if (entry.isFile()) {
        result.push({ path: rel, type: 'file', depth });
      }
    }
  }
  await visit(rootDir, 1);
  return result;
}

export async function readTextFile(absPath, relPath) {
  const stat = await fs.stat(absPath);
  if (!stat.isFile()) {
    throw new ToolError(ErrorCode.UNSUPPORTED_FILE, 'Указанный путь не является файлом', { path: relPath });
  }
  if (stat.size > LIMITS.maxFileBytes) {
    throw new ToolError(ErrorCode.FILE_TOO_LARGE, `Файл больше ${LIMITS.maxFileBytes} байт`, {
      path: relPath,
      sizeBytes: stat.size,
    });
  }
  const buf = await fs.readFile(absPath);
  if (buf.includes(0)) {
    throw new ToolError(ErrorCode.UNSUPPORTED_FILE, 'Бинарные файлы не поддерживаются', { path: relPath });
  }
  return { text: buf.toString('utf8'), sizeBytes: stat.size };
}

export function clip(text, max = LIMITS.maxContentChars) {
  return text.length > max ? { text: text.slice(0, max), truncated: true } : { text, truncated: false };
}
