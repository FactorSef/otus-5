import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { resolveInside } from '../src/core/pathGuard.js';

describe('resolveInside', () => {
  let base;
  let outside;

  before(async () => {
    base = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-base-'));
    outside = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-outside-'));
    await fs.mkdir(path.join(base, 'sub'));
    await fs.writeFile(path.join(base, 'sub', 'ok.md'), 'ok');
    await fs.writeFile(path.join(outside, 'secret.md'), 'secret');
    // junction не требует прав администратора на Windows
    await fs.symlink(outside, path.join(base, 'link'), 'junction');
  });

  after(async () => {
    await fs.rm(base, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });

  it('разрешает путь внутри базы', async () => {
    const r = await resolveInside(base, 'sub/ok.md');
    assert.equal(r.relative, 'sub/ok.md');
  });

  it('нормализует ./ и вложенные ..', async () => {
    const r = await resolveInside(base, './sub/../sub/ok.md');
    assert.equal(r.relative, 'sub/ok.md');
  });

  for (const bad of ['..', '../x', 'sub/../../x', 'C:\\Windows', '\\\\server\\share']) {
    it(`отклоняет ${bad}`, async () => {
      await assert.rejects(resolveInside(base, bad), { code: 'ACCESS_DENIED' });
    });
  }

  it('отклоняет абсолютный путь даже к существующему файлу', async () => {
    await assert.rejects(resolveInside(base, path.join(outside, 'secret.md')), { code: 'ACCESS_DENIED' });
  });

  it('отклоняет ссылку, ведущую наружу', async () => {
    await assert.rejects(resolveInside(base, 'link/secret.md'), { code: 'ACCESS_DENIED' });
  });

  it('отклоняет нулевой байт', async () => {
    await assert.rejects(resolveInside(base, 'sub/ok.md\0'), { code: 'VALIDATION_ERROR' });
  });

  it('несуществующий файл — NOT_FOUND', async () => {
    await assert.rejects(resolveInside(base, 'sub/none.md'), { code: 'NOT_FOUND' });
  });
});
