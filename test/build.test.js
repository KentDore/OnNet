'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('le build autonome embarque le client officiel Urssaf et les seuls utilitaires de présentation', t => {
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
  const utils = fs.readFileSync(path.join(root, 'src', 'ui-utils.js'), 'utf8').trim();
  const app = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8').trim();

  assert.ok(html.includes(styles));
  assert.ok(html.includes(utils));
  assert.ok(html.includes(app));
  assert.ok(html.includes("const DEFAULT_ENDPOINT = 'https://mon-entreprise.urssaf.fr/api/v1/evaluate'"));
  assert.ok(html.includes('window.OnNetUrssafApi = { calculateWithUrssafApi, urssafApiExpressions };'));
  assert.ok(html.includes('brand-version">v9.9.9</span>'));
  assert.equal(html.includes('@@ONNET_'), false);
  assert.equal(html.includes('@@ONNET_CALC@@'), false);
  assert.equal(html.includes('const P = {'), false, 'aucune table locale de taux ne doit être embarquée');
  assert.equal((html.match(/<script>/g) || []).length, 3);
});

test('la restauration renumérote les scénarios et conserve les références valides', () => {
  const appPath = path.join(__dirname, '..', 'src', 'app.js');
  const app = fs.readFileSync(appPath, 'utf8');
  const start = app.indexOf('function sanitizeScenario(raw){');
  const end = app.indexOf('\nfunction loadPersistedState(){', start);
  assert.notEqual(start, -1, 'sanitizeScenario doit être présent');
  assert.notEqual(end, -1, 'le bloc de normalisation doit être délimité');
  const factory = new Function('scenarioDefaults', app.slice(start, end) +
    '\nreturn { sanitizeScenario, normalizeScenarioIds };');
  const { sanitizeScenario, normalizeScenarioIds } = factory({ mutuelle:30 });

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
  assert.equal(result.refId, 1);
  assert.deepEqual(result.openCardIds, [1]);
});

test('la restauration neutralise les paramètres d’absence des anciennes sauvegardes', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
  const start = app.indexOf('function sanitizeScenario(raw){');
  const end = app.indexOf('\nfunction loadPersistedState(){', start);
  const factory = new Function('scenarioDefaults', app.slice(start, end) + '\nreturn sanitizeScenario;');
  const sanitizeScenario = factory({ mutuelle:30 });
  const restored = sanitizeScenario({
    id: 2, name: 'Ancien scénario', brut: 3000,
    absenceType: 'arret', absenceDuree: 5, maintienPct: 90, carenceCouverte: false
  });
  assert.equal(restored.absenceType, undefined);
  assert.equal(restored.absenceDuree, undefined);
  assert.equal(restored.maintienPct, undefined);
  assert.equal(restored.carenceCouverte, undefined);
});

test('la restauration utilise le premier scénario si la référence est invalide', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
  const start = app.indexOf('function sanitizeScenario(raw){');
  const end = app.indexOf('\nfunction loadPersistedState(){', start);
  const factory = new Function('scenarioDefaults', app.slice(start, end) +
    '\nreturn { sanitizeScenario, normalizeScenarioIds };');
  const { sanitizeScenario, normalizeScenarioIds } = factory({ mutuelle:30 });

  const restored = [
    { id: Number.MAX_SAFE_INTEGER, name: 'A', brut: 2800, mutuelle: 30 },
    { id: 8, name: 'B', brut: 3000, mutuelle: 30 }
  ].map(sanitizeScenario).filter(Boolean);
  const result = normalizeScenarioIds(restored, Number.MAX_SAFE_INTEGER + 1, [8, 123]);

  assert.equal(result.refId, 0);
  assert.deepEqual(result.openCardIds, [1]);
  assert.deepEqual(result.scenarios.map(s => s.id), [0, 1]);
});

test('la page publiée reste synchronisée avec les sources lors d’une publication sur main', t => {
  if(process.env.GITHUB_EVENT_NAME !== 'push' || process.env.GITHUB_REF !== 'refs/heads/main'){
    t.skip('Le contrôle de synchronisation est réservé à une publication sur main ; la branche de migration ne modifie pas la production.');
    return;
  }
  const root = path.resolve(__dirname, '..');
  const indexPath = path.join(root, 'index.html');
  const index = fs.readFileSync(indexPath, 'utf8');
  const match = index.match(/class="brand-version">v(\d+\.\d+\.\d+)<\/span>/);
  assert.ok(match, 'la version doit être présente dans index.html');
  const version = match[1];
  assert.notEqual(version, '999.999.999');
  const artifactPath = path.join(root, 'Onnet-' + version + '.html');
  assert.ok(fs.existsSync(artifactPath));

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onnet-release-sync-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const output = path.join(tempDir, 'Onnet-release-check.html');
  const run = spawnSync(process.execPath, [
    path.join(root, 'scripts', 'build.js'), version, output
  ], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const generated = fs.readFileSync(output, 'utf8');
  assert.equal(fs.readFileSync(artifactPath, 'utf8'), generated,
    'le fichier autonome versionné doit correspondre aux sources');
  assert.equal(index, generated, 'index.html doit correspondre au fichier autonome versionné');
});
