import path from 'node:path';
import { z } from 'zod';
import { DOCS_DIR, LIMITS } from '../config.js';
import { ErrorCode, ToolError } from '../core/errors.js';
import { clip, readTextFile, walk } from '../core/fsUtils.js';
import { resolveInside } from '../core/pathGuard.js';
import { extractTitle, normalize, parseSections, stem, tokenize } from '../docs/markdown.js';

const SCOPES = ['all', 'printers', 'filaments', 'guides'];

const inputSchema = z
  .object({
    action: z
      .enum(['list', 'search', 'read'])
      .describe('list — оглавление базы; search — поиск по секциям; read — чтение документа или его секции'),
    query: z.string().min(1).max(200).optional().describe('Поисковый запрос (для action=search), напр. "PETG P1S адгезия"'),
    scope: z.enum(SCOPES).default('all').describe('Раздел базы для list/search'),
    path: z.string().min(1).max(300).optional().describe('Путь документа относительно docs/ (для action=read), напр. "filaments/pla.md"'),
    section: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('Заголовок секции для action=read (поиск по вхождению, без учёта регистра)'),
    maxResults: z.number().int().min(1).max(LIMITS.maxResults).default(5).describe('Сколько результатов поиска вернуть'),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.action === 'search' && !v.query) ctx.addIssue({ code: 'custom', path: ['query'], message: 'обязателен для action=search' });
    if (v.action === 'read' && !v.path) ctx.addIssue({ code: 'custom', path: ['path'], message: 'обязателен для action=read' });
  });

function categoryOf(relPath) {
  const top = relPath.split('/')[0];
  return SCOPES.includes(top) && relPath.includes('/') ? top : 'root';
}

async function loadDocs(scope) {
  const entries = await walk(DOCS_DIR, { filter: (rel, d) => d.isDirectory() || rel.endsWith('.md') });
  const docs = [];
  for (const entry of entries) {
    if (entry.type !== 'file') continue;
    const category = categoryOf(entry.path);
    if (scope !== 'all' && category !== scope) continue;
    const { text, sizeBytes } = await readTextFile(path.join(DOCS_DIR, entry.path), entry.path);
    docs.push({ path: entry.path, category, title: extractTitle(text, entry.path), text, sizeBytes });
  }
  return docs;
}

async function list({ scope }) {
  const docs = await loadDocs(scope);
  return {
    action: 'list',
    scope,
    total: docs.length,
    documents: docs.map((d) => ({
      path: d.path,
      title: d.title,
      category: d.category,
      sizeBytes: d.sizeBytes,
      sections: parseSections(d.text)
        .filter((s) => s.level === 2)
        .map((s) => s.heading),
    })),
  };
}

function makeSnippet(content, stems) {
  const lines = content.split('\n');
  const idx = lines.findIndex((l) => tokenize(l).some((w) => stems.some((s) => w.startsWith(s))));
  const from = Math.max(0, idx - 1);
  return clip(lines.slice(from, from + 3).join('\n'), 400).text;
}

async function search({ query, scope, maxResults }) {
  const stems = [...new Set(tokenize(query).map(stem))];
  if (stems.length === 0) throw new ToolError(ErrorCode.VALIDATION_ERROR, 'Запрос не содержит слов для поиска');

  const docs = await loadDocs(scope);
  const hits = [];
  for (const doc of docs) {
    const titleWords = tokenize(doc.title);
    for (const section of parseSections(doc.text)) {
      const words = tokenize(section.content);
      const headingWords = tokenize(section.heading ?? '');
      let score = 0;
      let matchedTerms = 0;
      for (const s of stems) {
        const count = words.filter((w) => w.startsWith(s)).length;
        const inHeading = headingWords.some((w) => w.startsWith(s));
        const inTitle = titleWords.some((w) => w.startsWith(s));
        if (count || inTitle) matchedTerms += 1;
        score += Math.min(count, 10) + (inHeading ? 5 : 0) + (inTitle ? 3 : 0);
      }
      if (matchedTerms === 0) continue;
      hits.push({
        path: doc.path,
        title: doc.title,
        section: section.heading,
        startLine: section.startLine,
        matchedTerms,
        score,
        snippet: makeSnippet(section.content, stems),
      });
    }
  }

  hits.sort((a, b) => b.matchedTerms - a.matchedTerms || b.score - a.score);
  return {
    action: 'search',
    query,
    scope,
    terms: stems,
    totalMatches: hits.length,
    results: hits.slice(0, maxResults),
  };
}

async function read({ path: docPath, section }) {
  const { absolute, relative } = await resolveInside(DOCS_DIR, docPath);
  if (!relative.endsWith('.md')) {
    throw new ToolError(ErrorCode.UNSUPPORTED_FILE, 'В базе знаний читаются только .md файлы', { path: docPath });
  }
  const { text } = await readTextFile(absolute, relative);
  const sections = parseSections(text);
  let content = text;
  let matchedSection = null;

  if (section) {
    const needle = normalize(section);
    const idx = sections.findIndex((s) => s.heading && normalize(s.heading).includes(needle));
    if (idx === -1) {
      throw new ToolError(ErrorCode.NOT_FOUND, 'Секция не найдена', {
        path: relative,
        section,
        available: sections.filter((s) => s.heading).map((s) => s.heading),
      });
    }
    // Секция включает вложенные подзаголовки до следующего заголовка того же или более высокого уровня.
    const { level } = sections[idx];
    const end = sections.findIndex((s, i) => i > idx && s.level > 0 && s.level <= level);
    content = sections
      .slice(idx, end === -1 ? undefined : end)
      .map((s) => s.content)
      .join('\n\n');
    matchedSection = sections[idx].heading;
  }

  const clipped = clip(content);
  return {
    action: 'read',
    path: relative,
    title: extractTitle(text, relative),
    section: matchedSection,
    content: clipped.text,
    truncated: clipped.truncated,
  };
}

export const docsContextTool = {
  name: 'docs_context',
  title: 'База знаний по 3D-печати',
  description:
    'Контекст из базы знаний по FDM-печати (папка docs/): филаменты (PLA, PETG, ABS/ASA, TPU, PC, PA/композиты, поддержки), ' +
    'принтеры (Anycubic Kobra X, Bambu Lab P1S, Creality K2), сушка, адгезия, дефекты. ' +
    'Сначала используйте search или list, затем read для нужного документа/секции.',
  inputSchema,
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: (args) => ({ list, search, read })[args.action](args),
};
