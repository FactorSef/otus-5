import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Корень проекта вычисляется от расположения исходников и намеренно
// не переопределяется через окружение: сервер читает только свою папку.
export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DOCS_DIR = path.join(PROJECT_ROOT, 'docs');

export const SERVER_INFO = { name: 'printing-kb-mcp', version: '1.0.0' };

// Версия формата ответа. Меняется только при несовместимых изменениях конверта.
export const RESPONSE_SCHEMA_VERSION = '1.0';

export const LIMITS = {
  maxFileBytes: 256 * 1024,
  maxContentChars: 20_000,
  maxResults: 50,
  maxTreeDepth: 6,
  maxLogValueChars: 2_000,
};

// Каталоги и файлы, которые project_helper не показывает и не читает.
// docs/ обслуживает docs_context, остальное — служебное или чувствительное.
export const PROJECT_DENYLIST = {
  dirs: new Set(['node_modules', '.git', 'logs', 'docs', '.claude']),
  filePatterns: [/^\.env(\..*)?$/i, /\.(pem|key|p12|pfx)$/i],
};

export const SEARCHABLE_CODE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.json', '.md']);
export const SEARCH_SKIP_FILES = new Set(['package-lock.json']);
