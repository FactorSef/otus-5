import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { LIMITS, PROJECT_DENYLIST, PROJECT_ROOT, SEARCH_SKIP_FILES, SEARCHABLE_CODE_EXTENSIONS } from '../config.js';
import { ErrorCode, ToolError } from '../core/errors.js';
import { clip, readTextFile, walk } from '../core/fsUtils.js';
import { resolveInside } from '../core/pathGuard.js';

const inputSchema = z
  .object({
    action: z
      .enum(['overview', 'tree', 'read_file', 'search_code', 'list_tools'])
      .describe(
        'overview — назначение, скрипты, зависимости, структура; tree — дерево файлов; read_file — чтение файла; ' +
          'search_code — поиск подстроки по коду; list_tools — описание тулов сервера и их схем',
      ),
    path: z.string().min(1).max(300).optional().describe('Путь относительно корня проекта (для tree и read_file)'),
    query: z.string().min(1).max(200).optional().describe('Подстрока для search_code (без учёта регистра)'),
    depth: z.number().int().min(1).max(LIMITS.maxTreeDepth).default(3).describe('Глубина дерева для action=tree'),
    startLine: z.number().int().min(1).optional().describe('Первая строка для read_file (с 1)'),
    endLine: z.number().int().min(1).optional().describe('Последняя строка для read_file (включительно)'),
    maxResults: z.number().int().min(1).max(LIMITS.maxResults).default(20).describe('Лимит совпадений для search_code'),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.action === 'read_file' && !v.path) ctx.addIssue({ code: 'custom', path: ['path'], message: 'обязателен для action=read_file' });
    if (v.action === 'search_code' && !v.query) ctx.addIssue({ code: 'custom', path: ['query'], message: 'обязателен для action=search_code' });
    if (v.startLine && v.endLine && v.endLine < v.startLine) {
      ctx.addIssue({ code: 'custom', path: ['endLine'], message: 'должен быть не меньше startLine' });
    }
  });

function isDenied(relPath) {
  if (relPath === '.') return false;
  const parts = relPath.split('/');
  const name = parts[parts.length - 1];
  return (
    parts.some((p) => PROJECT_DENYLIST.dirs.has(p)) || PROJECT_DENYLIST.filePatterns.some((re) => re.test(name))
  );
}

function assertAllowed(relPath) {
  if (!isDenied(relPath)) return;
  const hint = relPath.split('/')[0] === 'docs' ? ' Для базы знаний используйте тул docs_context.' : '';
  throw new ToolError(ErrorCode.ACCESS_DENIED, `Путь закрыт для project_helper.${hint}`, { path: relPath });
}

const projectFilter = (rel) => !isDenied(rel);

const LANGUAGES = { '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.json': 'json', '.md': 'markdown' };

async function overview(_args, ctx) {
  const pkg = JSON.parse((await readTextFile(path.join(PROJECT_ROOT, 'package.json'), 'package.json')).text);
  const files = (await walk(PROJECT_ROOT, { filter: projectFilter })).filter((e) => e.type === 'file');
  return {
    action: 'overview',
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    entrypoint: pkg.main,
    scripts: pkg.scripts ?? {},
    dependencies: pkg.dependencies ?? {},
    fileCount: files.length,
    files: files.map((f) => f.path),
    tools: ctx.tools.map((t) => ({ name: t.name, title: t.title })),
    accessPolicy: {
      root: 'корень проекта (папка с package.json)',
      hiddenDirs: [...PROJECT_DENYLIST.dirs],
      hiddenFilePatterns: PROJECT_DENYLIST.filePatterns.map(String),
    },
  };
}

async function tree({ path: dirPath = '.', depth }) {
  const { absolute, relative } = await resolveInside(PROJECT_ROOT, dirPath);
  assertAllowed(relative);
  if (!(await fs.stat(absolute)).isDirectory()) {
    throw new ToolError(ErrorCode.UNSUPPORTED_FILE, 'Указанный путь не является директорией', { path: relative });
  }
  const prefix = relative === '.' ? '' : `${relative}/`;
  const entries = await walk(absolute, { filter: (rel) => projectFilter(prefix + rel), maxDepth: depth });
  return {
    action: 'tree',
    root: relative,
    depth,
    entries: entries.map((e) => ({ path: prefix + e.path, type: e.type, depth: e.depth })),
    text: entries.map((e) => `${'  '.repeat(e.depth - 1)}${e.path.split('/').pop()}${e.type === 'dir' ? '/' : ''}`).join('\n'),
  };
}

async function readFile({ path: filePath, startLine, endLine }) {
  const { absolute, relative } = await resolveInside(PROJECT_ROOT, filePath);
  assertAllowed(relative);
  const { text } = await readTextFile(absolute, relative);
  const lines = text.split(/\r?\n/);
  const from = Math.min(startLine ?? 1, lines.length);
  const to = Math.min(endLine ?? lines.length, lines.length);
  const clipped = clip(lines.slice(from - 1, to).join('\n'));
  return {
    action: 'read_file',
    path: relative,
    language: LANGUAGES[path.extname(relative)] ?? 'text',
    totalLines: lines.length,
    startLine: from,
    endLine: to,
    content: clipped.text,
    truncated: clipped.truncated,
  };
}

async function searchCode({ query, maxResults }) {
  const needle = query.toLowerCase();
  const files = (await walk(PROJECT_ROOT, { filter: projectFilter })).filter(
    (e) =>
      e.type === 'file' &&
      SEARCHABLE_CODE_EXTENSIONS.has(path.extname(e.path)) &&
      !SEARCH_SKIP_FILES.has(path.basename(e.path)),
  );
  const matches = [];
  let totalMatches = 0;
  for (const file of files) {
    const { text } = await readTextFile(path.join(PROJECT_ROOT, file.path), file.path);
    text.split(/\r?\n/).forEach((line, i) => {
      if (!line.toLowerCase().includes(needle)) return;
      totalMatches += 1;
      if (matches.length < maxResults) matches.push({ path: file.path, line: i + 1, text: clip(line.trim(), 300).text });
    });
  }
  return { action: 'search_code', query, filesScanned: files.length, totalMatches, truncated: totalMatches > matches.length, matches };
}

async function listTools(_args, ctx) {
  return {
    action: 'list_tools',
    responseFormat: ctx.responseFormat,
    tools: ctx.tools.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchemaJson,
    })),
  };
}

export const projectHelperTool = {
  name: 'project_helper',
  title: 'Помощник по кодовой базе MCP',
  description:
    'Навигация по исходному коду этого MCP-сервера: обзор проекта, дерево файлов, чтение файлов с диапазоном строк, ' +
    'поиск по коду, описание зарегистрированных тулов и формата ответа. Доступ ограничен корнем проекта; ' +
    'node_modules, .git, logs, docs, .claude и секреты (.env, ключи) скрыты.',
  inputSchema,
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: (args, ctx) =>
    ({ overview, tree, read_file: readFile, search_code: searchCode, list_tools: listTools })[args.action](args, ctx),
};
