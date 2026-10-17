'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('le build assemble les sources en HTML autonome', t => {
  const root = path.resolve(__dirname, '..');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onnet-build-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const output = path.join(tempDir, 'Onnet-test.html');
  const run = spawnSync(process.execPath, [
    path.join(root, 'scripts', 'build.js'), '9.9.9', output
  ], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const html = fs.readFileSync(output, 'utf8');
  const styles = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8').trim();
  const calc = fs.readFileSync(path.join(root, 'src', 'calc.js'), 'utf8').trim();
  const app = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8').trim();
  assert.ok(html.includes(styles));
  assert.ok(html.includes(calc));
  assert.ok(html.includes(app));
  assert.ok(html.includes('brand-version">v9.9.9</span>'));
  assert.equal(html.includes('@@ONNET_'), false);
  assert.equal((html.match(/<script>/g) || []).length, 2);
});
