import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deserializePersistedState,
  serializePersistedState
} from '../src/persistence-codec.mjs';

const scenario = (overrides = {}) => ({
  id:42,
  name:'Poste actuel',
  brut:3000,
  dureeType:'39',
  mutuelle:30,
  mutuellePat:35,
  joursResto:21,
  valeurResto:8,
  partResto:50,
  nbMois:12,
  primes:0,
  commune:'Pacé',
  codePostal:'35740',
  departement:'Ille-et-Vilaine',
  ...overrides
});

test('returns null for empty, malformed or unsupported persisted payloads', () => {
  for(const raw of [null, undefined, '', '{', 'null', '[]', '{"scenarios":{}}', '{"scenarios":[]}']){
    assert.equal(deserializePersistedState(raw), null);
  }
  assert.equal(deserializePersistedState(JSON.stringify({
    scenarios:[{ brut:-1 }, { brut:'not-a-number' }]
  })), null);
});

test('restores scenarios, identifiers, open cards and fiscal household through normalizers', () => {
  const restored = deserializePersistedState(JSON.stringify({
    v:1,
    scenarios:[scenario({ id:42 }), scenario({ id:17, name:'Offre B', brut:3500 })],
    refId:17,
    openCardIds:[42,17,42,999],
    metric:'netHoraire',
    displayAmt:'net',
    displayPeriod:'mois',
    foyer:{ situation:'commun', couple:true, personnesCharge:2, autresRevenus:1200 }
  }));

  assert.equal(restored.scenarios.length, 2);
  assert.deepEqual(restored.scenarios.map(item=>item.id), [0,1]);
  assert.equal(restored.refId, 1);
  assert.deepEqual(restored.openCardIds, [0,1]);
  assert.equal(restored.foyer.couple, true);
  assert.equal(restored.foyer.autresRevenus, 1200);
  assert.equal(restored.displayAmt, 'net');
  assert.equal(restored.displayPeriod, 'mois');
});

test('preserves the historical pristine-onboarding detection and explicit user choices', () => {
  const pristine = deserializePersistedState(JSON.stringify({
    scenarios:[scenario({
      brut:2300,
      dureeType:'39',
      mutuelle:30,
      mutuellePat:30,
      joursResto:21,
      valeurResto:8,
      partResto:50
    })]
  }));
  assert.equal(pristine.onboardingCompleted, false);

  const customized = deserializePersistedState(JSON.stringify({
    scenarios:[scenario({ brut:2700 })]
  }));
  assert.equal(customized.onboardingCompleted, true);

  const explicitlyIncomplete = deserializePersistedState(JSON.stringify({
    scenarios:[scenario({ brut:2700 })],
    onboardingCompleted:false
  }));
  assert.equal(explicitlyIncomplete.onboardingCompleted, false);

  const explicitlyCompleted = deserializePersistedState(JSON.stringify({
    scenarios:[scenario()],
    onboardingCompleted:true
  }));
  assert.equal(explicitlyCompleted.onboardingCompleted, true);
});

test('serializes the current versioned schema and copies open card identifiers', () => {
  const openCardIds = new Set([3,7]);
  const state = {
    scenarios:[scenario()],
    refId:3,
    metric:'netHoraire',
    displayAmt:'net',
    displayPeriod:'mois',
    foyer:{ couple:false, personnesCharge:0 },
    onboardingCompleted:true,
    openCardIds
  };
  const serialized = serializePersistedState(state);
  const data = JSON.parse(serialized);

  assert.deepEqual(data, {
    v:1,
    scenarios:state.scenarios,
    refId:3,
    metric:'netHoraire',
    displayAmt:'net',
    displayPeriod:'mois',
    foyer:state.foyer,
    onboardingCompleted:true,
    openCardIds:[3,7]
  });
  assert.equal(state.openCardIds, openCardIds);
});


test('round-trips a saved snapshot without mutating the source state', () => {
  const openCardIds = new Set([42]);
  const state = {
    scenarios:[scenario()],
    refId:42,
    metric:'netHoraire',
    displayAmt:'net',
    displayPeriod:'mois',
    foyer:{ couple:true, personnesCharge:1, autresRevenus:500 },
    onboardingCompleted:true,
    openCardIds
  };
  const before = [...openCardIds];
  const restored = deserializePersistedState(serializePersistedState(state));

  assert.equal(restored.scenarios.length, 1);
  assert.equal(restored.scenarios[0].brut, 3000);
  assert.equal(restored.refId, 0);
  assert.deepEqual(restored.openCardIds, [0]);
  assert.equal(restored.foyer.couple, true);
  assert.equal(restored.foyer.autresRevenus, 500);
  assert.equal(restored.onboardingCompleted, true);
  assert.deepEqual([...openCardIds], before);
});
