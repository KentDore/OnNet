import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deserializePersistedState, serializePersistedState } from '../src/persistence-codec.mjs';

const scenario = {
  id: 0, name: 'Salaire actuel', brut: 2300, dureeType: '39',
  mutuelle: 30, mutuellePat: 30, joursResto: 21, valeurResto: 8,
  partResto: 50, commune: 'Pacé', codePostal: '35740', departement: 'Ille-et-Vilaine'
};

test('returns null for empty, malformed or unsupported persisted payloads', () => {
  assert.equal(deserializePersistedState(null), null);
  assert.equal(deserializePersistedState('{'), null);
  assert.equal(deserializePersistedState(JSON.stringify({ scenarios: [] })), null);
});

test('restores salary scenarios and normalizes identifiers', () => {
  const restored = deserializePersistedState(JSON.stringify({
    scenarios: [{ ...scenario, id: 42 }, { ...scenario, id: 77, name: 'Offre B' }],
    refId: 77, openCardIds: [42, 77], foyer: { mode: 'bareme', personnesCharge: 3 }
  }));
  assert.deepEqual(restored.scenarios.map(item => item.id), [0, 1]);
  assert.equal(restored.refId, 1);
  assert.deepEqual(restored.openCardIds, [0, 1]);
  assert.equal(Object.hasOwn(restored, 'foyer'), false);
});

test('preserves historical pristine-onboarding detection and explicit user choices', () => {
  const pristine = deserializePersistedState(JSON.stringify({
    scenarios: [scenario], refId: 0, onboardingCompleted: undefined
  }));
  assert.equal(pristine.onboardingCompleted, false);
  const completed = deserializePersistedState(JSON.stringify({
    scenarios: [scenario], refId: 0, onboardingCompleted: true
  }));
  assert.equal(completed.onboardingCompleted, true);
});

test('serializes only salary comparison state and never persists fiscal settings', () => {
  const state = {
    scenarios: [scenario], refId: 0, metric: 'netHoraire',
    displayAmt: 'net', displayPeriod: 'mois', onboardingCompleted: true,
    openCardIds: new Set([0]), foyer: { mode: 'bareme', personnesCharge: 2 }
  };
  const serialized = serializePersistedState(state);
  const parsed = JSON.parse(serialized);
  assert.deepEqual(parsed.openCardIds, [0]);
  assert.equal(Object.hasOwn(parsed, 'foyer'), false);
  assert.equal(parsed.metric, 'netHoraire');
});
