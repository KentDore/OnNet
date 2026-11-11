'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
const template = fs.readFileSync(path.join(root, 'src', 'template.html'), 'utf8');
const client = fs.readFileSync(path.join(root, 'src', 'urssaf-api-client.mjs'), 'utf8');
const build = fs.readFileSync(path.join(root, 'scripts', 'build.js'), 'utf8');

test('le calculateur principal ne contient plus de moteur de cotisations ou d’impôt local', () => {
  assert.match(app, /calculateWithUrssafApi/);
  assert.match(app, /getCurrentComputed/);
  assert.doesNotMatch(app, /function\s+compute\s*\(/);
  assert.doesNotMatch(app, /function\s+cotisations\s*\(/);
  assert.doesNotMatch(app, /function\s+impotFoyer\s*\(/);
  assert.doesNotMatch(app, /P\.pmss|baremeIR\s*\(/);
});

test('le build utilise l’API officielle et n’embarque pas l’ancien fichier de calcul', () => {
  assert.match(client, /https:\/\/mon-entreprise\.urssaf\.fr\/api\/v1\/evaluate/);
  assert.match(build, /urssaf-api-client\.mjs/);
  assert.match(build, /ui-utils\.js/);
  assert.match(template, /@@ONNET_API@@/);
  assert.doesNotMatch(template, /@@ONNET_CALC@@/);
});

test('le résultat principal indique la source Urssaf et requiert un clic avant transmission', () => {
  assert.match(template, /Calculs effectués par le moteur officiel de l’Urssaf/);
  assert.match(template, /Détails techniques \(facultatif\)/);
  assert.match(template, /id="urssafCalculateBtn"/);
  assert.match(app, /urssafConsentGranted\s*=\s*true/);
  assert.match(app, /Aucun calcul local de cotisations ou d’impôt/);
});
