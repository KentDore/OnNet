'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { readStylesSource } = require('../scripts/source-loader');
const normalizersPromise = import(pathToFileURL(path.join(__dirname, '..', 'src', 'state-normalizers.mjs')).href);

test('package.json et package-lock.json utilisent la même version', () => {
  const root = path.resolve(__dirname, '..');
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const packageLock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  assert.equal(packageLock.version, packageJson.version, 'la version racine du lockfile doit suivre package.json');
  assert.equal(packageLock.packages?.['']?.version, packageJson.version,
    'la version du package racine dans le lockfile doit suivre package.json');
});

test('le build autonome embarque le client officiel et les modules source', t => {
  const root = path.resolve(__dirname, '..');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onnet-build-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const output = path.join(tempDir, 'Onnet-test.html');
  const run = spawnSync(process.execPath, [
    path.join(root, 'scripts', 'build.js'), '9.9.9', output
  ], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);

  const html = fs.readFileSync(output, 'utf8');
  const styles = readStylesSource(root).trim();
  const favicon = fs.readFileSync(path.join(root, 'favicon.svg'), 'utf8');
  const appleTouchIcon = fs.readFileSync(path.join(root, 'apple-touch-icon.png'));
  assert.ok(html.includes('<link rel="icon" type="image/svg+xml" href="./favicon.svg?v=2.2.8">'));
  assert.ok(html.includes('<link rel="icon" type="image/png" sizes="180x180" href="./apple-touch-icon.png?v=2.2.8">'));
  assert.ok(html.includes('<link rel="apple-touch-icon" sizes="180x180" href="./apple-touch-icon.png?v=2.2.8">'));
  assert.match(html, /<meta name="theme-color" content="#176b49">/);
  assert.match(favicon, /<svg[^>]+viewBox="0 0 64 64"/);
  assert.equal(appleTouchIcon.readUInt32BE(16), 180, 'l’icône iOS doit mesurer 180 px de large');
  assert.equal(appleTouchIcon.readUInt32BE(20), 180, 'l’icône iOS doit mesurer 180 px de haut');

  assert.ok(html.includes(styles));
  assert.equal(styles.split('@font-face').length - 1, 5,
    'les cinq polices doivent être intégrées au CSS final');
  assert.equal(styles.split('data:font/woff2;base64,').length - 1, 5,
    'les cinq ressources WOFF2 doivent être réinjectées dans les styles');
  assert.doesNotMatch(styles, /@@ONNET_FONT_/,
    'aucun marqueur de police ne doit subsister après assemblage');
  assert.match(html, /function parseNum\(v\)/, 'le module utilitaire doit être intégré au bundle');
  assert.match(html, /function fmtHoraire\(n\)/, 'les fonctions de formatage doivent être conservées');
  assert.match(html, /function sanitizeScenario\(raw\)/, 'le module de normalisation doit être intégré');
  assert.match(html, /function createUrssafSessionState\(\)/, "l'état de session Urssaf doit être intégré");
  assert.match(html, /function deserializePersistedState[(]raw[)]/, "le codec de restauration doit être intégré");
  assert.match(html, /function serializePersistedState[(]state[)]/, "le codec de sauvegarde doit être intégré");
  assert.match(html, /function createUrssafCalculationCache\(options\s*=\s*\{\}\)/, 'le cache Urssaf doit être intégré');
  assert.match(html, /function buildSmicScenario\(base, amount\)/, 'la construction du scénario SMIC doit être intégrée');
  assert.match(html, /function createRateLimitedFetch\(fetchImpl, options\s*=\s*\{\}\)/, 'la file réseau temporisée doit être intégrée');
  assert.match(html, /function buildUrssafCalculationKey\([^)]*\)/, 'la clé de cache des calculs doit être intégrée');
  assert.match(html, /function buildUrssafInput\([^)]*\)/, 'les adaptateurs de calcul Urssaf doivent être intégrés');
  assert.match(html, /function mapUrssafResultToOnNet\(result\)/, 'la conversion des réponses Urssaf doit être intégrée');
  assert.doesNotMatch(html, /sanitizeFoyer|FOYER_DEFAUT|foyerModule|foyerPasRate/, 'aucun module de foyer fiscal ne doit être embarqué');
  assert.match(html, /\b(?:const|let|var)\s+METRIC_KEYS\s*=/, 'les métriques autorisées doivent être intégrées');
  assert.match(html, /\b(?:const|let|var)\s+scenarioDefaults\s*=\s*\{/, 'les valeurs par défaut doivent être conservées');
  assert.match(html, /DEFAULT_ENDPOINT\s*=\s*[\"']https:\/\/mon-entreprise\.urssaf\.fr\/api\/v1\/evaluate[\"']/);
  assert.match(html, /window\.OnNetUrssafApi\s*=\s*\{/);
  assert.ok(html.includes('brand-version">v9.9.9</span>'));
  assert.equal(html.includes('@@ONNET_'), false);
  assert.equal(html.includes('@@ONNET_CALC@@'), false);
  assert.equal(html.includes('const P = {'), false, 'aucune table locale de taux ne doit être embarquée');
  assert.doesNotMatch(html, /from\s+[\"']\.\/src\/(?:ui-utils|state-normalizers|urssaf-api-client)\.mjs[\"']/,
    'aucun import externe ne doit rendre le HTML autonome dépendant des sources');
  const scriptTags = [...html.matchAll(/<script\b([^>]*)>/g)].map(match => match[1].trim());
  assert.deepEqual(scriptTags, ['', 'type="module"'],
    'le HTML doit contenir uniquement le bootstrap de thème pré-rendu et le runtime ES regroupé');
  assert.match(html, /<script>\s*\(\(\) => \{/,
    'le bootstrap de thème doit rester un script inline minimal exécuté avant le CSS');
  assert.match(html, /document\.documentElement\.dataset\.theme = theme/,
    'le bootstrap doit appliquer le thème avant le rendu');
});

test('la restauration renumérote les scénarios et conserve les références valides', async () => {
  const { sanitizeScenario, normalizeScenarioIds } = await normalizersPromise;
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

test('la normalisation applique les valeurs historiques et rejette les scénarios hors limites', async () => {
  const { sanitizeScenario } = await normalizersPromise;
  const restored = sanitizeScenario({ brut: '2800', mutuelle: '30' });
  assert.equal(restored.brut, 2800);
  assert.equal(restored.mutuelle, 30);
  assert.equal(restored.mutuellePat, 30);
  assert.equal(restored.commune, 'Pacé');
  assert.equal(restored.codePostal, '35740');
  assert.equal(restored.departement, 'Ille-et-Vilaine');
  assert.equal(restored.name, 'Salaire');
  assert.equal(restored.dureeType, '35');
  assert.equal(sanitizeScenario(null), null);
  assert.equal(sanitizeScenario({ brut: -1 }), null);
  assert.equal(sanitizeScenario({ brut: 3000, joursResto: 32 }), null);
});

test('la restauration neutralise les paramètres d’absence des anciennes sauvegardes', async () => {
  const { sanitizeScenario } = await normalizersPromise;
  const restored = sanitizeScenario({
    id: 2, name: 'Ancien scénario', brut: 3000,
    absenceType: 'arret', absenceDuree: 5, maintienPct: 90, carenceCouverte: false
  });
  assert.equal(restored.absenceType, undefined);
  assert.equal(restored.absenceDuree, undefined);
  assert.equal(restored.maintienPct, undefined);
  assert.equal(restored.carenceCouverte, undefined);
});

test('la restauration utilise le premier scénario si la référence est invalide', async () => {
  const { sanitizeScenario, normalizeScenarioIds } = await normalizersPromise;
  const restored = [
    { id: Number.MAX_SAFE_INTEGER, name: 'A', brut: 2800, mutuelle: 30 },
    { id: 8, name: 'B', brut: 3000, mutuelle: 30 }
  ].map(sanitizeScenario).filter(Boolean);
  const result = normalizeScenarioIds(restored, Number.MAX_SAFE_INTEGER + 1, [8, 123]);

  assert.equal(result.refId, 0);
  assert.deepEqual(result.openCardIds, [1]);
  assert.deepEqual(result.scenarios.map(s => s.id), [0, 1]);
});

test('les normalisateurs n’exposent plus de paramètres fiscaux', async () => {
  const normalizers = await normalizersPromise;
  assert.equal(Object.hasOwn(normalizers, 'sanitizeFoyer'), false);
  assert.equal(Object.hasOwn(normalizers, 'FOYER_DEFAUT'), false);
});

test('les fichiers HTML publiables restent synchronisés avec les sources', t => {
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
  const published = fs.readFileSync(artifactPath, 'utf8');
  const styles = readStylesSource(root).trim();
  assert.equal(index, published, 'index.html et le fichier autonome doivent rester identiques');
  assert.equal(generated, published, 'le build doit reproduire exactement le HTML autonome publié');
  assert.ok(published.includes(styles), 'le fichier publié doit embarquer le CSS actuel');
  assert.ok(generated.includes(styles), 'le build doit toujours intégrer le CSS source');
  assert.match(published, /function parseNum\(v\)/, 'le bundle publié doit inclure les utilitaires');
  assert.match(generated, /function parseNum\(v\)/, 'le build doit inclure les utilitaires');
  assert.equal(published.includes('@@ONNET_'), false, 'aucun marqueur de template ne doit rester');
});
