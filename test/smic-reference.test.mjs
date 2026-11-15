import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSmicScenario, getSmicGrossTarget } from '../src/smic-reference.mjs';

const smicGross = 1867.02;
const baseScenario = {
  id:7, name:'Poste actuel', brut:2800, dureeType:'35',
  commune:'Pacé', codePostal:'35740', departement:'Ille-et-Vilaine',
  mutuelle:30, mutuellePat:35, joursResto:21,
  valeurResto:8, partResto:50, nbMois:12, primes:0
};

test('le repère SMIC 35 h conserve le montant brut mensuel officiel', () => {
  assert.equal(getSmicGrossTarget(smicGross, 35), smicGross);
  const scenario = buildSmicScenario(baseScenario, smicGross);
  assert.equal(scenario.brut, smicGross);
  assert.equal(scenario.dureeType, '35');
});

test('le repère SMIC 39 h ajoute quatre heures supplémentaires hebdomadaires à 25 %', () => {
  const scenario = buildSmicScenario({ ...baseScenario, dureeType:'39' }, smicGross);
  assert.equal(getSmicGrossTarget(smicGross, 39), 2133.73);
  assert.equal(scenario.brut, 2133.73);
  assert.equal(scenario.dureeType, '39');
});

test('la construction du scénario SMIC neutralise les avantages propres à la rémunération comparée', () => {
  const original = structuredClone(baseScenario);
  const scenario = buildSmicScenario(baseScenario, smicGross);
  assert.equal(scenario.id, -1);
  assert.equal(scenario.name, 'Référence SMIC');
  assert.equal(scenario.isBenchmark, true);
  assert.equal(scenario.mutuelle, 0);
  assert.equal(scenario.mutuellePat, 0);
  assert.equal(scenario.joursResto, 0);
  assert.equal(scenario.valeurResto, 0);
  assert.equal(scenario.partResto, 0);
  assert.equal(scenario.nbMois, 12);
  assert.equal(scenario.primes, 0);
  assert.equal(scenario.commune, baseScenario.commune);
  assert.equal(scenario.codePostal, baseScenario.codePostal);
  assert.deepEqual(baseScenario, original);
  assert.notEqual(scenario, baseScenario);
});

test('un montant SMIC nul, négatif ou non fini ne crée pas de scénario', () => {
  for (const amount of [0, -1, NaN, Infinity, null, undefined]) {
    assert.equal(buildSmicScenario(baseScenario, amount), null);
  }
});

test('une durée différente de 39 h utilise le repère 35 h, conformément au périmètre actuel', () => {
  assert.equal(getSmicGrossTarget(smicGross, 37), smicGross);
  const scenario = buildSmicScenario({ ...baseScenario, dureeType:'37' }, smicGross);
  assert.equal(scenario.dureeType, '35');
  assert.equal(scenario.brut, smicGross);
});
