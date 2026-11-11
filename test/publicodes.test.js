'use strict'

const { test, before } = require('node:test')
const assert = require('node:assert/strict')

let calculatePublicodes

before(async () => {
  const adapter = await import('../src/publicodes-adapter.mjs')
  calculatePublicodes = adapter.calculatePublicodes
})

function scenario(overrides = {}) {
  return {
    brut: 2300,
    dureeType: '39',
    mutuelle: 30,
    mutuellePat: 30,
    joursResto: 0,
    valeurResto: 0,
    partResto: 50,
    date: '2026-11-11',
    ...overrides
  }
}

function near(actual, expected, tolerance, label) {
  assert.ok(Number.isFinite(actual), `${label} n'est pas un nombre fini : ${actual}`)
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label} : attendu ${expected} ± ${tolerance}, obtenu ${actual}`
  )
}

test('39 h : recompose le brut global avec les heures supplémentaires annualisées exactes', () => {
  const result = calculatePublicodes(scenario())
  assert.equal(result.overtimeHours, 4 * 52 / 12)
  assert.ok(result.overtimePay > 0)
  near(result.grossCalculated, 2300, 0.005, 'brut reconstitué')
  assert.ok(result.baseGross < result.grossTarget)
  const expectedOvertimeGross = result.baseGross / 151.67 * (4 * 52 / 12) * 1.25
  near(result.overtimePay, expectedOvertimeGross, 0.03, 'heures supplémentaires majorées à 25 %')
})

test('35 h : transmet le brut comme salaire de base et aucune heure supplémentaire', () => {
  const result = calculatePublicodes(scenario({ brut: 3000, dureeType: '35' }))
  assert.equal(result.overtimeHours, 0)
  near(result.baseGross, 3000, 0.001, 'salaire de base')
  near(result.overtimePay, 0, 0.001, 'rémunération heures supplémentaires')
  near(result.grossCalculated, 3000, 0.02, 'brut reconstitué')
})

test('calcule un net avant impôt et un net imposable finis', () => {
  const result = calculatePublicodes(scenario())
  assert.ok(result.netBeforeTax > 0)
  assert.ok(result.netBeforeTax < result.grossCalculated)
  assert.ok(result.taxableNet > 0)
  assert.ok(result.employeeContributions > 0)
})

test('convertit les deux parts de mutuelle en montant total et taux employeur', () => {
  const result = calculatePublicodes(scenario())
  near(result.employeeHealth, 30, 0.01, 'part salariale mutuelle')
  near(result.employerHealth, 30, 0.01, 'part employeur mutuelle')
})

test('la mutuelle salariale et patronale sont bien distinguées', () => {
  const result = calculatePublicodes(scenario({
    mutuelle: 24,
    mutuellePat: 36,
    joursResto: 0,
    valeurResto: 0
  }))
  near(result.employeeHealth, 24, 0.01, 'part salariale mutuelle')
  near(result.employerHealth, 36, 0.01, 'part employeur mutuelle')
})

test('les titres-restaurant réduisent le net du montant de la part salariale', () => {
  const withoutTickets = calculatePublicodes(scenario({
    joursResto: 0,
    valeurResto: 0
  }))
  const withTickets = calculatePublicodes(scenario({
    joursResto: 21,
    valeurResto: 8,
    partResto: 50
  }))
  near(withoutTickets.netBeforeTax - withTickets.netBeforeTax, 84, 0.03, 'retenue titres-restaurant')
})

test('rejette les valeurs de saisie hors limites et les durées inconnues', () => {
  assert.throws(() => calculatePublicodes(scenario({ brut: -10 })), /brut/)
  assert.throws(() => calculatePublicodes(scenario({ dureeType: '42' })), /dureeType/)
  assert.throws(() => calculatePublicodes(scenario({ partResto: 150 })), /partResto/)
})

test('rejette un nombre fractionnaire de titres-restaurant', () => {
  assert.throws(() => calculatePublicodes(scenario({ joursResto: 20.5 })), /entier/)
})

test('rejette une date impossible plutôt que de la transmettre au moteur', () => {
  assert.throws(
    () => calculatePublicodes(scenario({ date: '2026-02-31' })),
    /date calendaire valide/
  )
})

test('39 h : conserve le brut demandé sur plusieurs montants', () => {
  for (const brut of [0, 1, 1800, 2300, 3990, 4020, 8000, 1000000]) {
    const result = calculatePublicodes(scenario({ brut }))
    near(result.grossCalculated, brut, 0.005, `brut reconstitué pour ${brut} €`)
  }
})


test('le taux personnalisé est appliqué par le modèle fiscal officiel', () => {
  const result = calculatePublicodes(scenario({ modeImpot: 'personnalisé', tauxPAS: 10 }))
  near(result.calculatedTaxRate, 10, 0.001, 'taux personnalisé évalué')
  assert.ok(result.incomeTax > 0, `impôt calculé invalide : ${result.incomeTax}`)
  assert.ok(result.netAfterTax < result.netBeforeTax)
  near(result.netBeforeTax - result.netAfterTax, result.taxableNet * 0.1, 0.5, 'retenue au taux personnalisé')
})

test('le taux neutre est calculé par le modèle officiel', () => {
  const result = calculatePublicodes(scenario({ modeImpot: 'neutre' }))
  assert.ok(Number.isFinite(result.netAfterTax))
  assert.ok(result.netAfterTax <= result.netBeforeTax)
})

test('le barème standard prend en compte la situation familiale', () => {
  const single = calculatePublicodes(scenario({ modeImpot: 'barème' }))
  const couple = calculatePublicodes(scenario({ modeImpot: 'barème', situationFamille: 'couple' }))
  assert.ok(single.incomeTax > 0)
  assert.ok(couple.incomeTax > 0)
  assert.notEqual(single.netAfterTax, couple.netAfterTax)
})

test('refuse un taux personnalisé absent et une configuration familiale incohérente', () => {
  assert.throws(() => calculatePublicodes(scenario({ modeImpot: 'personnalisé' })), /tauxPAS est requis/)
  assert.throws(() => calculatePublicodes(scenario({ parentIsole: true })), /parentIsole nécessite/)
})