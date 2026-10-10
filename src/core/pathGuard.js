import fs from 'node:fs/promises';
import path from 'node:path';
import { ErrorCode, ToolError } from './errors.js';

function isInside(base, target) {
  const rel = path.relative(base, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Разрешает пользовательский путь относительно baseDir и гарантирует,
 * что итоговый файл (после раскрытия симлинков) лежит внутри baseDir.
 * Принимаются только относительные пути.
 */
export async function resolveInside(baseDir, userPath = '.') {
  if (typeof userPath !== 'string' || userPath.includes('\0')) {
    throw new ToolError(ErrorCode.VALIDATION_ERROR, 'Некорректный путь');
  }
  if (path.isAbsolute(userPath) || /^[a-zA-Z]:/.test(userPath)) {
    throw new ToolError(ErrorCode.ACCESS_DENIED, 'Абсолютные пути запрещены, укажите путь относительно корня', {
      path: userPath,
    });
  }

  const resolved = path.resolve(baseDir, userPath);
  if (!isInside(baseDir, resolved)) {
    throw new ToolError(ErrorCode.ACCESS_DENIED, 'Путь выходит за пределы разрешённой директории', { path: userPath });
  }

  let real;
  try {
    real = await fs.realpath(resolved);
  } catch {
    throw new ToolError(ErrorCode.NOT_FOUND, 'Файл или директория не найдены', { path: userPath });
  }
  const realBase = await fs.realpath(baseDir);
  if (!isInside(realBase, real)) {
    throw new ToolError(ErrorCode.ACCESS_DENIED, 'Ссылка указывает за пределы разрешённой директории', {
      path: userPath,
    });
  }

  return { absolute: real, relative: toPosix(path.relative(realBase, real)) || '.' };
}

export function toPosix(p) {
  return p.split(path.sep).join('/');
}
