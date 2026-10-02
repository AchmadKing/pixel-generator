import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveSafePath } from '../../studio/server/storage/path-jail.js';

test('Path Traversal Security & Jail Suite', async (t) => {
  const baseDir = path.resolve('assets');

  await t.test('Valid relative path resolves correctly inside baseDir', () => {
    const resolved = resolveSafePath(baseDir, 'generated/ast_01/ver_01/raw.png');
    assert.ok(resolved.startsWith(baseDir));
    assert.ok(resolved.endsWith(path.join('ast_01', 'ver_01', 'raw.png')));
  });

  await t.test('Unix-style directory traversal attempt is rejected with Security Violation', () => {
    assert.throws(() => {
      resolveSafePath(baseDir, '../../Windows/System32');
    }, /Security Violation: Path traversal detected outside safe root/);
  });

  await t.test('Windows-style directory traversal attempt is rejected with Security Violation', () => {
    assert.throws(() => {
      resolveSafePath(baseDir, '..\\..\\secret.env');
    }, /Security Violation: Path traversal detected outside safe root/);
  });

  await t.test('Sneaky nested traversal resolving outside is rejected', () => {
    assert.throws(() => {
      resolveSafePath(baseDir, 'generated/../../../outside.txt');
    }, /Security Violation: Path traversal detected outside safe root/);
  });

  await t.test('Null byte in path is rejected immediately', () => {
    assert.throws(() => {
      resolveSafePath(baseDir, 'generated/ast_01\0/evil.txt');
    }, /Security Violation: Null byte detected in path/);
  });

  await t.test('Empty baseDir or relativePath throws descriptive error', () => {
    assert.throws(() => {
      resolveSafePath('', 'sub');
    }, /Base directory must be a valid non-empty string/);

    assert.throws(() => {
      resolveSafePath(baseDir, '');
    }, /Relative path must be a valid non-empty string/);
  });
});
