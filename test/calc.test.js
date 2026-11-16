'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readAppSource } = require('./helpers/read-app-source');

const root = path.resolve(__dirname, '..');
const app = readAppSource(root);
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
  assert.match(build, /ui-utils\.mjs/);
  assert.match(build, /state-normalizers\.mjs/);
  assert.match(template, /@@ONNET_RUNTIME@@/);
  assert.doesNotMatch(template, /@@ONNET_API@@|@@ONNET_UTILS@@|@@ONNET_APP@@/);
  assert.doesNotMatch(template, /@@ONNET_CALC@@/);
});

test('le formulaire indique la source officielle sans répéter un pavé de consentement', () => {
  assert.match(template, /Calculs via l’Urssaf/);
  assert.match(template, /Service Mon-entreprise/);
  assert.doesNotMatch(template, /Quelles données sont transmises/);
  assert.doesNotMatch(template, /En renseignant ou modifiant ces données, vous acceptez leur transmission/);
  assert.doesNotMatch(template, /id="updateDeclaredSalary"|id="urssafCalculateBtn"/);
  assert.match(app, /function showOnboardingModal/);
  assert.match(app, /function grantUrssafConsent[(][)]/,
    'l’autorisation explicite doit être centralisée');
  assert.equal((app.match(/grantUrssafConsent[(][)];/g) || []).length, 4,
    'l’onboarding, l’ajout, la modification et l’action de consentement accordent explicitement l’autorisation persistante');
  assert.match(app, /URSSAF_CONSENT_STORAGE_KEY/);
  assert.match(app, /localStorage[.]setItem[(]URSSAF_CONSENT_STORAGE_KEY, 'granted'[)]/);
  assert.match(app, /urssafConsentGrant/);
  assert.match(app, /urssafConsentRevoke/);
  assert.match(app, /revokeUrssafConsent[(][)]/);
  assert.doesNotMatch(app, /urssafConsentGranted/);
  assert.match(app, /scheduleUrssafCalculations\(false,false\)/);
  assert.doesNotMatch(template, /urssafRememberConsent|Se souvenir de mon choix/);
  assert.match(app, /calculateWithUrssafApi/);
  assert.doesNotMatch(app, /function calculerCotisations|function calculerImpot/);
});
