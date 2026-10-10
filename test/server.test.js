import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { ResponseEnvelopeSchema } from '../src/core/response.js';
import { connect } from './helpers.js';

let ctx;
before(async () => {
  ctx = await connect();
});
after(() => ctx.close());

function assertEnvelope({ result, envelope }, { tool, status }) {
  assert.ok(ResponseEnvelopeSchema.safeParse(envelope).success, 'конверт соответствует схеме');
  assert.deepEqual(JSON.parse(result.content[0].text), envelope, 'text-контент совпадает со structuredContent');
  assert.equal(envelope.tool, tool);
  assert.equal(envelope.status, status);
  assert.equal(result.isError, status === 'error');
  return envelope;
}

describe('list tools', () => {
  it('регистрирует два тула с общей схемой ответа', async () => {
    const { tools } = await ctx.client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ['docs_context', 'project_helper']);
    for (const t of tools) {
      assert.equal(t.inputSchema.type, 'object');
      assert.deepEqual(t.outputSchema.required.sort(), ['data', 'error', 'meta', 'requestId', 'schemaVersion', 'status', 'tool']);
    }
  });
});

describe('docs_context', () => {
  it('list возвращает оглавление базы', async () => {
    const env = assertEnvelope(await ctx.call('docs_context', { action: 'list' }), { tool: 'docs_context', status: 'success' });
    const paths = env.data.documents.map((d) => d.path);
    assert.ok(paths.includes('filaments/pla.md'));
    assert.ok(paths.includes('printers/bambu-lab-p1s.md'));
  });

  it('list фильтрует по scope', async () => {
    const env = assertEnvelope(await ctx.call('docs_context', { action: 'list', scope: 'printers' }), {
      tool: 'docs_context',
      status: 'success',
    });
    assert.equal(env.data.total, 3);
    assert.ok(env.data.documents.every((d) => d.category === 'printers'));
  });

  it('search находит релевантные секции на русском', async () => {
    const env = assertEnvelope(await ctx.call('docs_context', { action: 'search', query: 'сушка нейлона' }), {
      tool: 'docs_context',
      status: 'success',
    });
    assert.ok(env.data.results.length > 0);
    assert.ok(env.data.results.some((r) => r.path === 'filaments/pa-composites.md'));
  });

  it('read возвращает конкретную секцию с подсекциями', async () => {
    const env = assertEnvelope(
      await ctx.call('docs_context', { action: 'read', path: 'printers/bambu-lab-p1s.md', section: 'поправки' }),
      { tool: 'docs_context', status: 'success' },
    );
    assert.equal(env.data.section, 'Поправки по материалам');
    assert.match(env.data.content, /### TPU/);
    assert.doesNotMatch(env.data.content, /## Советы/);
  });

  it('read неизвестной секции — NOT_FOUND со списком доступных', async () => {
    const env = assertEnvelope(
      await ctx.call('docs_context', { action: 'read', path: 'filaments/pla.md', section: 'нет такой' }),
      { tool: 'docs_context', status: 'error' },
    );
    assert.equal(env.error.code, 'NOT_FOUND');
    assert.ok(env.error.details.available.length > 0);
  });

  for (const bad of ['../package.json', '../src/server.js', 'C:/Windows/win.ini', '/etc/passwd']) {
    it(`read не выходит за docs/: ${bad}`, async () => {
      const env = assertEnvelope(await ctx.call('docs_context', { action: 'read', path: bad }), {
        tool: 'docs_context',
        status: 'error',
      });
      assert.equal(env.error.code, 'ACCESS_DENIED');
    });
  }

  it('без обязательного параметра — VALIDATION_ERROR', async () => {
    const env = assertEnvelope(await ctx.call('docs_context', { action: 'search' }), { tool: 'docs_context', status: 'error' });
    assert.equal(env.error.code, 'VALIDATION_ERROR');
    assert.equal(env.error.details.issues[0].path, 'query');
  });

  it('лишние параметры отклоняются', async () => {
    const env = assertEnvelope(await ctx.call('docs_context', { action: 'list', foo: 1 }), { tool: 'docs_context', status: 'error' });
    assert.equal(env.error.code, 'VALIDATION_ERROR');
  });
});

describe('project_helper', () => {
  it('overview описывает проект и тулы', async () => {
    const env = assertEnvelope(await ctx.call('project_helper', { action: 'overview' }), { tool: 'project_helper', status: 'success' });
    assert.equal(env.data.name, 'printing-kb-mcp');
    assert.ok(env.data.files.includes('src/server.js'));
    assert.ok(!env.data.files.some((f) => f.startsWith('node_modules/') || f.startsWith('docs/')));
  });

  it('tree строит дерево src', async () => {
    const env = assertEnvelope(await ctx.call('project_helper', { action: 'tree', path: 'src', depth: 2 }), {
      tool: 'project_helper',
      status: 'success',
    });
    assert.ok(env.data.entries.some((e) => e.path === 'src/tools/docsContext.js'));
  });

  it('read_file читает диапазон строк', async () => {
    const env = assertEnvelope(
      await ctx.call('project_helper', { action: 'read_file', path: 'src/config.js', startLine: 1, endLine: 3 }),
      { tool: 'project_helper', status: 'success' },
    );
    assert.equal(env.data.language, 'javascript');
    assert.equal(env.data.content.split('\n').length, 3);
  });

  it('search_code находит определения', async () => {
    const env = assertEnvelope(await ctx.call('project_helper', { action: 'search_code', query: 'async function resolveInside' }), {
      tool: 'project_helper',
      status: 'success',
    });
    const hit = env.data.matches.find((m) => m.path === 'src/core/pathGuard.js');
    assert.ok(hit, 'определение найдено');
    assert.match(hit.text, /^export async function resolveInside/);
  });

  it('list_tools отдаёт схемы входа и формат ответа', async () => {
    const env = assertEnvelope(await ctx.call('project_helper', { action: 'list_tools' }), { tool: 'project_helper', status: 'success' });
    assert.equal(env.data.tools.length, 2);
    assert.ok(env.data.responseFormat.properties.schemaVersion);
  });

  for (const bad of ['..', '../..', 'node_modules/zod/package.json', 'docs/README.md', '.claude/settings.local.json', 'D:/secret.txt']) {
    it(`read_file запрещён: ${bad}`, async () => {
      const env = assertEnvelope(await ctx.call('project_helper', { action: 'read_file', path: bad }), {
        tool: 'project_helper',
        status: 'error',
      });
      assert.equal(env.error.code, 'ACCESS_DENIED');
    });
  }
});

describe('общие ошибки и логгер', () => {
  it('неизвестный тул — UNKNOWN_TOOL в том же формате', async () => {
    const env = assertEnvelope(await ctx.call('nope', {}), { tool: 'nope', status: 'error' });
    assert.equal(env.error.code, 'UNKNOWN_TOOL');
  });

  it('логирует имя тула, вход, выход и статус', async () => {
    const { envelope } = await ctx.call('docs_context', { action: 'list', scope: 'guides' });
    const entry = ctx.lines.find((l) => l.event === 'tool_call' && l.requestId === envelope.requestId);
    assert.ok(entry, 'запись в логе найдена');
    assert.equal(entry.tool, 'docs_context');
    assert.equal(entry.status, 'success');
    assert.deepEqual(entry.input, { action: 'list', scope: 'guides' });
    assert.equal(entry.output.total, 3);
    assert.equal(typeof entry.durationMs, 'number');
  });

  it('ошибочный вызов логируется с уровнем warn и кодом ошибки', async () => {
    const { envelope } = await ctx.call('project_helper', { action: 'read_file', path: '../x' });
    const entry = ctx.lines.find((l) => l.requestId === envelope.requestId);
    assert.equal(entry.level, 'warn');
    assert.equal(entry.status, 'error');
    assert.equal(entry.output.code, 'ACCESS_DENIED');
  });
});
