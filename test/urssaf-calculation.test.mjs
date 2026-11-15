import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  taxInputForFoyer,
  unsupportedCalculationReason,
  buildUrssafInput,
  mapUrssafResultToOnNet
} from '../src/urssaf-calculation.mjs';

const scenario = {
  brut: 3000, dureeType: '35', mutuelle: 30, mutuellePat: 30,
  joursResto: 21, valeurResto: 8, partResto: 50,
  commune: 'Pacé', codePostal: '35740', departement: 'Ille-et-Vilaine',
  nbMois: 12, primes: 0
};

test('construit les paramètres fiscaux du barème sans transmettre les revenus du partenaire hors couple', () => {
  assert.deepEqual(taxInputForFoyer({
    mode: 'bareme', couple: false, personnesCharge: 1,
    parentIsole: true, autresRevenus: 1200
  }), {
    modeImpot: 'barème', situationFamille: 'célibataire',
    enfantsACharge: 1, parentIsole: true, autresRevenusImposables: 0
  });
});

test('construit les paramètres du taux personnalisé', () => {
  assert.deepEqual(taxInputForFoyer({ mode: 'taux', pasRate: '7.5' }), {
    modeImpot: 'personnalisé', tauxPAS: 7.5
  });
});

test('refuse explicitement les scénarios hors périmètre ou dont la commune est incomplète', () => {
  assert.match(unsupportedCalculationReason({ ...scenario, brut: 0 }), /strictement supérieur à 0/);
  assert.match(unsupportedCalculationReason({ ...scenario, nbMois: 13 }), /mensualités différent de 12/);
  assert.match(unsupportedCalculationReason({ ...scenario, primes: 500 }), /primes annuelles libres/);
  assert.match(unsupportedCalculationReason({ ...scenario, codePostal: '' }), /Sélectionnez une commune/);
  assert.equal(unsupportedCalculationReason(scenario), null);
});

test('construit les paramètres API complets et ajoute les données fiscales hors benchmark', () => {
  const input = buildUrssafInput(scenario, {
    mode: 'bareme', couple: true, personnesCharge: 2,
    parentIsole: false, autresRevenus: 900
  });
  assert.equal(input.brut, 3000);
  assert.equal(input.commune, 'Pacé');
  assert.equal(input.codePostal, '35740');
  assert.equal(input.modeImpot, 'barème');
  assert.equal(input.situationFamille, 'couple');
  assert.equal(input.autresRevenusImposables, 900);
  assert.equal(input.benchmarkOnly, false);
});

test('ne transmet pas de paramètres fiscaux pour un scénario benchmark', () => {
  const input = buildUrssafInput({ ...scenario, isBenchmark: true }, {});
  assert.equal(input.benchmarkOnly, true);
  assert.equal('modeImpot' in input, false);
  assert.equal('situationFamille' in input, false);
});

test('convertit une réponse Urssaf standard sans recompter la mutuelle ou les titres-restaurant', () => {
  const mapped = mapUrssafResultToOnNet({
    engine: 'mon-entreprise', checkedAt: '2026-11-15T08:00:00Z',
    missingVariables: [], warnings: [], grossCalculated: 3000,
    overtimeHours: 0, employeeContributions: 660, employeeHealth: 30,
    netBeforeTax: 2310, taxableNet: 2500, mealTicketEmployee: 100,
    mealTicketEmployer: 100, mealTicketNonDeductible: 5,
    overtimePay: 0, baseGross: 3000, netAfterTax: 2200,
    incomeTax: 110, calculatedTaxRate: 5
  });
  assert.equal(mapped.m.brutTotal, 3000);
  assert.equal(mapped.m.netApres, 2310);
  assert.equal(mapped.m.cotisNettes, 630);
  assert.equal(mapped.m.mutuelle, 30);
  assert.equal(mapped.m.netSocial, 2410);
  assert.deepEqual(mapped.tr, {
    totalSalarie: 100, totalEmployeur: 100, reintegre: 5, motif: 'api'
  });
  assert.equal(mapped.netApresImpot, 2200);
});

test('convertit une réponse benchmark sans créer de détail de paie', () => {
  assert.deepEqual(mapUrssafResultToOnNet({
    benchmarkOnly: true, engine: 'mon-entreprise',
    checkedAt: '2026-11-15T08:00:00Z', missingVariables: [],
    warnings: [], netBeforeTax: 1600
  }), {
    engine: 'mon-entreprise', checkedAt: '2026-11-15T08:00:00Z',
    missingVariables: [], warnings: [], netApres: 1600
  });
});

test('conserve le calcul horaire du scénario 39 h avec ses heures supplémentaires', () => {
  const mapped = mapUrssafResultToOnNet({
    engine: 'mon-entreprise', checkedAt: '2026-11-15T08:00:00Z',
    missingVariables: [], warnings: [], grossCalculated: 3400,
    overtimeHours: 17.33, employeeContributions: 748, employeeHealth: 30,
    netBeforeTax: 2622, taxableNet: 2800, mealTicketEmployee: 0,
    mealTicketEmployer: 0, mealTicketNonDeductible: 0,
    overtimePay: 400, baseGross: 3000, netAfterTax: 2500,
    incomeTax: 122, calculatedTaxRate: 4.5
  });
  assert.equal(mapped.hasHS, true);
  assert.equal(mapped.heuresSup, 17.33);
  assert.equal(mapped.brutHS, 400);
  assert.equal(mapped.netHoraire, (2622 + 30) / (39 * 52 / 12));
});
