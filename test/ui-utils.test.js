'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const utilsPromise = import(pathToFileURL(path.join(root, 'src', 'ui-utils.mjs')).href);

test('parseNum accepte les montants français et refuse les saisies partielles', async () => {
  const utils = await utilsPromise;
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

test('clamp borne une valeur sans la modifier lorsqu’elle est dans l’intervalle', async () => {
  const utils = await utilsPromise;
  assert.equal(utils.clamp(-1, 0, 10), 0);
  assert.equal(utils.clamp(11, 0, 10), 10);
  assert.equal(utils.clamp(5, 0, 10), 5);
  assert.equal(utils.clamp(-1, undefined, 10), -1);
  assert.equal(utils.clamp(11, 0, undefined), 11);
});

test('les formatters affichent les montants et taux en français', async () => {
  const utils = await utilsPromise;
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

test('esc échappe les cinq caractères HTML sensibles', async () => {
  const utils = await utilsPromise;
  assert.equal(utils.esc(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
});

test('les constantes d’interface conservent leurs clés attendues', async () => {
  const utils = await utilsPromise;
  assert.deepEqual(Object.keys(utils.scenarioDefaults).sort(),
    ['joursResto', 'mutuelle', 'nbMois', 'partResto', 'valeurResto'].sort());
  assert.deepEqual(Object.keys(utils.ICON).sort(), ['info', 'plus', 'warn']);
  assert.equal(utils.HEURES_BASE, 151.67);
});
