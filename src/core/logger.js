import fs from 'node:fs';
import path from 'node:path';
import { LIMITS, PROJECT_ROOT } from '../config.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

/** Обрезает длинные строки и глубокие структуры, чтобы лог оставался читаемым. */
export function truncateForLog(value, maxChars = LIMITS.maxLogValueChars, depth = 0) {
  if (typeof value === 'string') {
    return value.length > maxChars ? `${value.slice(0, maxChars)}… [+${value.length - maxChars} chars]` : value;
  }
  if (value === null || typeof value !== 'object') return value;
  if (depth > 6) return '[depth limit]';
  if (Array.isArray(value)) return value.map((v) => truncateForLog(v, maxChars, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, truncateForLog(v, maxChars, depth + 1)]));
}

/**
 * Логгер в формате JSON Lines.
 * stdout занят протоколом MCP (stdio), поэтому вывод идёт в stderr
 * и, если не отключено через MCP_LOG_FILE=off, в файл logs/mcp-server.log.
 */
export function createLogger({
  level = process.env.MCP_LOG_LEVEL ?? 'info',
  file = process.env.MCP_LOG_FILE ?? path.join(PROJECT_ROOT, 'logs', 'mcp-server.log'),
  stream = process.stderr,
} = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;
  let fileStream = null;
  if (file && file !== 'off') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fileStream = fs.createWriteStream(file, { flags: 'a' });
  }

  function write(lvl, event, fields = {}) {
    if (LEVELS[lvl] < threshold) return;
    const line = JSON.stringify({ ts: new Date().toISOString(), level: lvl, event, ...truncateForLog(fields) });
    stream?.write(`${line}\n`);
    fileStream?.write(`${line}\n`);
  }

  return {
    debug: (event, fields) => write('debug', event, fields),
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),

    /** Запись о вызове тула: имя, вход, выход, статус, длительность. */
    toolCall({ tool, requestId, input, envelope }) {
      const ok = envelope.status === 'success';
      write(ok ? 'info' : 'warn', 'tool_call', {
        tool,
        requestId,
        status: envelope.status,
        durationMs: envelope.meta.durationMs,
        input,
        output: ok ? envelope.data : envelope.error,
      });
    },

    close() {
      fileStream?.end();
    },
  };
}
