/**
 * Разбивает markdown на секции по заголовкам (#..######), игнорируя
 * строки внутри блоков кода. Текст до первого заголовка — секция без заголовка.
 */
export function parseSections(markdown) {
  const lines = markdown.split(/\r?\n/);
  const sections = [];
  let current = { heading: null, level: 0, startLine: 1, lines: [] };
  let inFence = false;

  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const m = !inFence && /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) {
      if (current.heading !== null || current.lines.some((l) => l.trim())) sections.push(current);
      current = { heading: m[2], level: m[1].length, startLine: i + 1, lines: [] };
    }
    current.lines.push(line);
  });
  sections.push(current);

  return sections.map((s) => ({
    heading: s.heading,
    level: s.level,
    startLine: s.startLine,
    content: s.lines.join('\n').trim(),
  }));
}

export function extractTitle(markdown, fallback) {
  const m = /^#\s+(.+)$/m.exec(markdown);
  return m ? m[1].trim() : fallback;
}

/** Нормализация для поиска: нижний регистр, ё → е. */
export function normalize(text) {
  return text.toLowerCase().replace(/ё/g, 'е');
}

/** Разбивает запрос на термы (буквы/цифры, в т.ч. кириллица). */
export function tokenize(text) {
  return normalize(text).match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * Примитивный стемминг для русского и английского: у длинных слов
 * отбрасываются окончания, чтобы «сушки» находило «сушка», «сушить».
 */
export function stem(term) {
  if (term.length >= 7) return term.slice(0, -3);
  if (term.length >= 5) return term.slice(0, -2);
  return term;
}
