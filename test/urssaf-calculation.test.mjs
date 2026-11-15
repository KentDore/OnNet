import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildUrssafCalculationKey,
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

test('refuse les scénarios hors périmètre ou dont la commune est incomplète', () => {
  assert.match(unsupportedCalculationReason({ ...scenario, brut: 0 }), /strictement supérieur à 0/);
  assert.match(unsupportedCalculationReason({ ...scenario, nbMois: 13 }), /mensualités différent de 12/);
  assert.match(unsupportedCalculationReason({ ...scenario, primes: 500 }), /primes annuelles libres/);
  assert.match(unsupportedCalculationReason({ ...scenario, codePostal: '' }), /Sélectionnez une commune/);
  assert.equal(unsupportedCalculationReason(scenario), null);
});

test('ne transmet que les paramètres utiles au calcul de paie', () => {
  const input = buildUrssafInput(scenario, { mode: 'bareme', personnesCharge: 2 }, '2026-11-15');
  assert.equal(input.brut, 3000);
  assert.equal(input.date, '2026-11-15');
  assert.equal(input.commune, 'Pacé');
  assert.equal(input.codePostal, '35740');
  assert.equal(input.benchmarkOnly, false);
  for (const key of ['modeImpot', 'tauxPAS', 'situationFamille', 'enfantsACharge', 'autresRevenusImposables']) {
    assert.equal(Object.hasOwn(input, key), false);
  }
});

test('convertit une réponse Urssaf sans exposer de métrique fiscale', () => {
  const mapped = mapUrssafResultToOnNet({
    engine: 'mon-entreprise', checkedAt: '2026-11-15T08:00:00Z',
    missingVariables: [], warnings: [], grossCalculated: 3000,
    overtimeHours: 0, employeeContributions: 660, employeeHealth: 30,
    netBeforeTax: 2310, mealTicketEmployee: 100,
    mealTicketEmployer: 100, mealTicketNonDeductible: 5,
    overtimePay: 0, baseGross: 3000
  });
  assert.equal(mapped.m.brutTotal, 3000);
  assert.equal(mapped.m.netApres, 2310);
  assert.equal(mapped.m.cotisNettes, 630);
  assert.equal(mapped.m.mutuelle, 30);
  assert.equal(mapped.m.netSocial, 2410);
  assert.deepEqual(mapped.tr, {
    totalSalarie: 100, totalEmployeur: 100, reintegre: 5, motif: 'api'
  });
  for (const key of ['netImposable', 'netApresImpot', 'netApresImpotHoraire', 'impotAnnuel', 'tauxImpot']) {
    assert.equal(Object.hasOwn(mapped, key), false);
  }
});

test('conserve le calcul horaire du scénario 39 h avec ses heures supplémentaires', () => {
  const mapped = mapUrssafResultToOnNet({
    engine: 'mon-entreprise', checkedAt: '2026-11-15T08:00:00Z',
    missingVariables: [], warnings: [], grossCalculated: 3400,
    overtimeHours: 17.33, employeeContributions: 748, employeeHealth: 30,
    netBeforeTax: 2622, mealTicketEmployee: 0,
    mealTicketEmployer: 0, mealTicketNonDeductible: 0,
    overtimePay: 400, baseGross: 3000
  });
  assert.equal(mapped.hasHS, true);
  assert.equal(mapped.heuresSup, 17.33);
  assert.equal(mapped.brutHS, 400);
  assert.equal(mapped.netHoraire, (2622 + 30) / (39 * 52 / 12));
});

test('la clé de cache ignore les anciens paramètres fiscaux et suit les paramètres de paie', () => {
  const legacyTax = { mode: 'bareme', personnesCharge: 2 };
  const key = buildUrssafCalculationKey(scenario, legacyTax, '2026-11-15');
  assert.equal(buildUrssafCalculationKey(scenario, { mode: 'taux', pasRate: 9 }, '2026-11-15'), key);
  assert.notEqual(buildUrssafCalculationKey({ ...scenario, brut: 3100 }, null, '2026-11-15'), key);
  assert.notEqual(buildUrssafCalculationKey(scenario, null, '2026-11-16'), key);
});
