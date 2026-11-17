import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUrssafSessionState } from '../src/urssaf-session-state.mjs';

test('starts without transmission consent and with an idle SMIC state', () => {
  const state = createUrssafSessionState();
  assert.equal(state.isConsentGranted(), false);
  assert.deepEqual(state.getOfficialSmicState(), {
    status:'idle',
    amount:null,
    checkedAt:null,
    missingVariables:[],
    warnings:[],
    error:null
  });
});

test('granting consent is local to one runtime instance', () => {
  const first = createUrssafSessionState();
  const second = createUrssafSessionState();
  first.grantConsent();

  assert.equal(first.isConsentGranted(), true);
  assert.equal(second.isConsentGranted(), false);
});

test('stores SMIC loading, ready and error snapshots without leaking mutable arrays', () => {
  const state = createUrssafSessionState();
  const readyInput = {
    status:'ready',
    amount:1867.02,
    checkedAt:'2026-11-15T08:00:00Z',
    missingVariables:['variable-a'],
    warnings:['warning-a'],
    error:null
  };
  state.setOfficialSmicState(readyInput);
  readyInput.missingVariables.push('mutated-input');
  readyInput.warnings[0] = 'mutated-input';

  const snapshot = state.getOfficialSmicState();
  assert.deepEqual(snapshot, {
    status:'ready',
    amount:1867.02,
    checkedAt:'2026-11-15T08:00:00Z',
    missingVariables:['variable-a'],
    warnings:['warning-a'],
    error:null
  });

  snapshot.missingVariables.push('mutated-snapshot');
  snapshot.warnings.length = 0;
  assert.deepEqual(state.getOfficialSmicState().missingVariables, ['variable-a']);
  assert.deepEqual(state.getOfficialSmicState().warnings, ['warning-a']);

  state.setOfficialSmicState({
    status:'loading', amount:null, checkedAt:null,
    missingVariables:[], warnings:[], error:null
  });
  assert.equal(state.getOfficialSmicState().status, 'loading');

  state.setOfficialSmicState({
    status:'error', amount:null, checkedAt:null,
    missingVariables:[], warnings:[], error:'service down'
  });
  assert.equal(state.getOfficialSmicState().error, 'service down');
});

test('rejects invalid state objects and statuses without replacing the current snapshot', () => {
  const state = createUrssafSessionState();
  state.setOfficialSmicState({
    status:'ready', amount:1800, checkedAt:null,
    missingVariables:[], warnings:[], error:null
  });

  assert.throws(() => state.setOfficialSmicState(null), /doit être un objet/);
  assert.throws(() => state.setOfficialSmicState([]), /doit être un objet/);
  assert.throws(() => state.setOfficialSmicState({ status:'unknown' }), /Statut du SMIC invalide/);
  assert.equal(state.getOfficialSmicState().amount, 1800);
});

test('the session API is read-only and exposes no mutable state fields', () => {
  const state = createUrssafSessionState();
  assert.equal(Object.isFrozen(state), true);
  assert.equal('consentGranted' in state, false);
  assert.equal('officialSmicState' in state, false);
});

test('revoking consent prevents further salary transmissions in this runtime', () => {
  const state = createUrssafSessionState();
  state.grantConsent();
  assert.equal(state.isConsentGranted(), true);
  state.revokeConsent();
  assert.equal(state.isConsentGranted(), false);
});
