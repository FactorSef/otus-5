import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseSections, stem, tokenize } from '../src/docs/markdown.js';

describe('markdown', () => {
  it('режет по заголовкам и игнорирует # в блоках кода', () => {
    const md = '# T\nintro\n## A\n```\n# not heading\n```\n### A1\nx\n## B\ny';
    const s = parseSections(md);
    assert.deepEqual(
      s.map((x) => [x.heading, x.level]),
      [
        ['T', 1],
        ['A', 2],
        ['A1', 3],
        ['B', 2],
      ],
    );
  });

  it('tokenize понимает кириллицу и ё', () => {
    assert.deepEqual(tokenize('Сушка PLA, всё-таки!'), ['сушка', 'pla', 'все', 'таки']);
  });

  it('stem сводит словоформы к общему префиксу', () => {
    assert.ok('сушить'.startsWith(stem('сушка')));
    assert.ok('нейлон'.startsWith(stem('нейлона')));
  });
});
