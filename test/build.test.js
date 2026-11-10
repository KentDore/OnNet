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

test('la restauration renumérote les scénarios et conserve les références valides', () => {
  const appPath = path.join(__dirname, '..', 'src', 'app.js');
  const app = fs.readFileSync(appPath, 'utf8');
  const start = app.indexOf('function sanitizeScenario(raw){');
  const end = app.indexOf('\nfunction loadPersistedState(){', start);
  assert.notEqual(start, -1, 'sanitizeScenario doit être présent');
  assert.notEqual(end, -1, 'le bloc de normalisation doit être délimité');
  const factory = new Function(app.slice(start, end) +
    '\nreturn { sanitizeScenario, normalizeScenarioIds };');
  const { sanitizeScenario, normalizeScenarioIds } = factory();

  // Ce test isole la normalisation des identifiants : fournir les champs
  // historiques requis évite de dépendre de scenarioDefaults (déclaré dans
  // calc.js, hors du bloc de fonctions extrait ici).
  const restored = [
    { id: 9007199254740992, name: 'Identifiant non sûr', brut: 2800, mutuelle: 30 },
    { id: 42, name: 'Premier doublon', brut: 3000, mutuelle: 30 },
    { id: 42, name: 'Second doublon', brut: 3200, mutuelle: 30 },
    { id: -1, name: 'Identifiant négatif', brut: 3400, mutuelle: 30 }
  ].map(sanitizeScenario).filter(Boolean);

  const result = normalizeScenarioIds(restored, 42, [42, 42, -1, 9007199254740992, 999]);
  assert.deepEqual(result.scenarios.map(s => s.id), [0, 1, 2, 3]);
  assert.deepEqual(result.scenarios.map(s => s.name), [
    'Identifiant non sûr', 'Premier doublon', 'Second doublon', 'Identifiant négatif'
  ]);
  assert.equal(result.refId, 1, 'la référence conserve le premier scénario portant cet ancien id');
  assert.deepEqual(result.openCardIds, [1], 'les cartes ouvertes sont remappées sans doublon');
});

test('la restauration utilise le premier scénario si la référence est invalide', () => {
  const appPath = path.join(__dirname, '..', 'src', 'app.js');
  const app = fs.readFileSync(appPath, 'utf8');
  const start = app.indexOf('function sanitizeScenario(raw){');
  const end = app.indexOf('\nfunction loadPersistedState(){', start);
  const factory = new Function(app.slice(start, end) +
    '\nreturn { sanitizeScenario, normalizeScenarioIds };');
  const { sanitizeScenario, normalizeScenarioIds } = factory();

  const restored = [
    { id: Number.MAX_SAFE_INTEGER, name: 'A', brut: 2800, mutuelle: 30 },
    { id: 8, name: 'B', brut: 3000, mutuelle: 30 }
  ].map(sanitizeScenario).filter(Boolean);
  const result = normalizeScenarioIds(restored, Number.MAX_SAFE_INTEGER + 1, [8, 123]);

  assert.equal(result.refId, 0);
  assert.deepEqual(result.openCardIds, [1]);
  assert.deepEqual(result.scenarios.map(s => s.id), [0, 1]);
});
