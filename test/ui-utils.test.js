'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src', 'ui-utils.js'), 'utf8');

// Évalue le fichier source dans un scope isolé pour tester ses fonctions pures
// sans dépendre du DOM ni du runtime complet de l'application.
const utils = new Function(source + `
  return {
    parseNum, clamp, fmt, fmtHoraire, fmtHoraireSigned, fmtSigned, esc,
    scenarioDefaults, ICON, HEURES_BASE
  };
`)();

test('parseNum accepte les montants français et refuse les saisies partielles', () => {
  assert.equal(utils.parseNum('1 234,56'), 1234.56);
  assert.equal(utils.parseNum(' 2 300 '), 2300);
  assert.equal(utils.parseNum('.5'), 0.5);
  assert.equal(utils.parseNum(null), 0);
  assert.equal(utils.parseNum(undefined), 0);
  assert.equal(utils.parseNum(''), 0);
  assert.equal(utils.parseNum('3000abc'), 0);
  assert.equal(utils.parseNum('1e3'), 0);
  assert.equal(utils.parseNum('Infinity'), 0);
});

test('clamp borne une valeur sans la modifier lorsqu’elle est dans l’intervalle', () => {
  assert.equal(utils.clamp(-1, 0, 10), 0);
  assert.equal(utils.clamp(11, 0, 10), 10);
  assert.equal(utils.clamp(5, 0, 10), 5);
  assert.equal(utils.clamp(-1, undefined, 10), -1);
  assert.equal(utils.clamp(11, 0, undefined), 11);
});

test('les formatters affichent les montants et taux en français', () => {
  assert.equal(utils.fmt(1234.56), Math.round(1234.56).toLocaleString('fr-FR') + ' €');
  assert.equal(utils.fmt('invalide'), '—');
  assert.equal(utils.fmtHoraire(12.5), '12,50 €/h');
  assert.equal(utils.fmtHoraire('invalide'), '—');
  assert.equal(utils.fmtHoraireSigned(12.5), '+12,50 €/h');
  assert.equal(utils.fmtHoraireSigned(-12.5), '−12,50 €/h');
  assert.equal(utils.fmtHoraireSigned(0), '0,00 €/h');
  assert.equal(utils.fmtHoraireSigned(NaN), '—');
  assert.equal(utils.fmtSigned(-12.6), '−13 €');
  assert.equal(utils.fmtSigned(12.4), '+12 €');
  assert.equal(utils.fmtSigned(NaN), '—');
});

test('esc échappe les cinq caractères HTML sensibles', () => {
  assert.equal(utils.esc(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
});

test('les constantes d’interface conservent leurs clés attendues', () => {
  assert.deepEqual(Object.keys(utils.scenarioDefaults).sort(),
    ['joursResto', 'mutuelle', 'nbMois', 'partResto', 'valeurResto'].sort());
  assert.deepEqual(Object.keys(utils.ICON).sort(), ['info', 'plus', 'warn']);
  assert.equal(utils.HEURES_BASE, 151.67);
});
