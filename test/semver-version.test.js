'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { nextVersion } = require('../scripts/next-version')

test('incrémente le patch pour une correction ou une modification UX', () => {
  assert.equal(nextVersion('2.2.2', '2.2.2', 'fix: corriger le calcul'), '2.2.3')
  assert.equal(nextVersion('2.2.2', '2.2.2', 'ux: déplacer un contrôle'), '2.2.3')
})

test('incrémente le mineur pour une nouvelle fonctionnalité', () => {
  assert.equal(nextVersion('2.2.2', '2.2.2', 'feat(comparateur): ajouter un filtre'), '2.3.0')
})

test('incrémente le majeur pour un changement incompatible', () => {
  assert.equal(nextVersion('2.2.2', '2.2.2', 'feat!: changer le format des données'), '3.0.0')
  assert.equal(nextVersion('2.2.2', '2.2.2', 'refactor: API', 'BREAKING CHANGE: contrat modifié'), '3.0.0')
})

test('rattrape une branche en retard sur la version de la branche cible', () => {
  assert.equal(nextVersion('2.2.1', '2.2.2', 'fix: corriger'), '2.2.3')
})

test('ne double pas une version déjà avancée manuellement dans la PR', () => {
  assert.equal(nextVersion('2.2.3', '2.2.2', 'fix: corriger'), '2.2.3')
})
