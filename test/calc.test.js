'use strict';
//
// Tests de non-régression du moteur de calcul d'Onnet.
//
//   node --test test/
//
// Aucune dépendance : le bloc de calcul est extrait du fichier HTML entre les
// marqueurs ONNET_CALC_START / ONNET_CALC_END, puis évalué tel quel. On teste
// donc exactement le code qui tourne dans le navigateur, pas une copie.
//
// Les valeurs attendues marquées « calculé à la main » ont été posées à la main
// à partir des taux légaux, indépendamment du code. Ne les régénérez pas depuis
// la sortie du programme : elles n'ont de valeur que parce qu'elles en sont
// indépendantes.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// ---------- Chargement du moteur depuis le HTML ----------

function latestHtmlFile(dir){
  const files = fs.readdirSync(dir).filter(f => /^Onnet-\d+\.\d+\.\d+\.html$/.test(f));
  if(!files.length) throw new Error('Aucun fichier Onnet-X.Y.Z.html trouvé dans ' + dir);
  const key = f => f.match(/(\d+)\.(\d+)\.(\d+)/).slice(1,4).map(Number);
  files.sort((a, b) => {
    const [aM,aN,aP] = key(a), [bM,bN,bP] = key(b);
    return aM - bM || aN - bN || aP - bP;
  });
  return files[files.length - 1];
}

function loadCalc(){
  const dir = path.join(__dirname, '..');
  const file = latestHtmlFile(dir);
  const html = fs.readFileSync(path.join(dir, file), 'utf8');
  const m = html.match(/\/\* ONNET_CALC_START[^\n]*\*\/([\s\S]*?)\/\* ONNET_CALC_END \*\//);
  if(!m) throw new Error('Marqueurs ONNET_CALC_START/END introuvables dans ' + file);
  const factory = new Function('"use strict";' + m[1] + `
    return { P, HEURES_BASE, scenarioDefaults, parseNum, clamp,
             cotisations, titresResto, splitHeures, periode, compute,
             baremeIR, abattementFraisPro, partsFiscales, impotFoyer };`);
  const api = factory();
  api.__file = file;
  return api;
}

const C = loadCalc();
const P = C.P;

// ---------- Aides ----------

/** Scénario neutre : tout ce qui n'est pas testé est mis à zéro. */
function scn(over){
  return Object.assign({
    id: 0, name: 'Test', brut: 3000, statut: 'non-cadre', rate: 22,
    mutuelle: 0, mutuellePat: 0,
    joursResto: 0, valeurResto: 0, partResto: 50,
    dureeType: '35', nbMois: 12, primes: 0,
    maintienPct: 90, carenceCouverte: false,
    absenceType: 'none', absenceDuree: 0
  }, over || {});
}

/** Foyer fiscal — réglage global, passé à compute() en second argument. */
function foy(over){
  return Object.assign({ couple: false, personnesCharge: 0, autresRevenus: 0 }, over || {});
}

function near(actual, expected, eps, label){
  assert.ok(Number.isFinite(actual), `${label || 'valeur'} non finie : ${actual}`);
  assert.ok(Math.abs(actual - expected) <= (eps === undefined ? 0.01 : eps),
    `${label || 'valeur'} : attendu ≈ ${expected}, obtenu ${actual}`);
}

function allFinite(obj, label){
  for(const [k, v] of Object.entries(obj)){
    if(typeof v === 'number'){
      assert.ok(Number.isFinite(v), `${label}.${k} n'est pas fini : ${v}`);
    } else if(v && typeof v === 'object'){
      allFinite(v, `${label}.${k}`);
    }
  }
}

// ---------- Garde-fous sur les paramètres légaux ----------

describe('paramètres légaux 2026', () => {
  test('valeurs officielles', () => {
    assert.equal(P.pmss, 4005, 'PMSS 2026');
    assert.equal(P.plafondTR, 7.32, 'plafond exonération par titre restaurant 2026');
    assert.equal(P.csgDed, 6.80, 'CSG déductible');
    assert.equal(P.csgNonDed, 2.40, 'CSG non déductible');
    assert.equal(P.crds, 0.50, 'CRDS');
    assert.equal(P.reducHS, 11.31, 'réduction salariale heures sup');
    assert.equal(P.plafondExoIR, 7500, 'plafond annuel exonération IR heures sup');
    assert.equal(P.majoration, 25, 'majoration heures sup');
  });

  test('CSG totale cohérente (9,20 %)', () => {
    near(P.csgDed + P.csgNonDed, 9.20, 1e-9, 'CSG totale');
  });

  test('taux fonction publique = pension + CSG/CRDS abattues', () => {
    // 11,10 (retenue pour pension) + 9,20 × 0,9825 + 0,50 × 0,9825
    const attendu = 11.10 + (P.csgDed + P.csgNonDed + P.crds) * 0.9825;
    near(P.fpRate, attendu, 0.01, 'fpRate');
  });
});

// ---------- cotisations() ----------

describe('cotisations()', () => {
  test('assiette nulle ou négative → tout à zéro', () => {
    for(const a of [0, -1, -5000]){
      const c = C.cotisations(a, 'non-cadre', P.pmss, 0);
      assert.equal(c.total, 0);
      assert.equal(c.deductible, 0);
      assert.equal(c.nonDeductible, 0);
      assert.equal(c.retraite, 0);
    }
  });

  test('non-cadre 3000 € sous le PMSS — ligne à ligne (calculé à la main)', () => {
    const c = C.cotisations(3000, 'non-cadre', P.pmss, 0);
    // baseCSG = 3000 × 0,9825 = 2947,50
    near(c.csgDed, 200.43, 0.005, 'CSG déductible');       // 2947,50 × 6,80 %
    near(c.csgNonDed, 70.74, 0.005, 'CSG non déductible');  // 2947,50 × 2,40 %
    near(c.crds, 14.7375, 0.005, 'CRDS');                   // 2947,50 × 0,50 %
    near(c.vieillessePlaf, 207, 0.005);                     // 3000 × 6,90 %
    near(c.vieillesseDeplaf, 12, 0.005);                    // 3000 × 0,40 %
    near(c.rcT1, 94.5, 0.005);                              // 3000 × 3,15 %
    near(c.cegT1, 25.8, 0.005);                             // 3000 × 0,86 %
    assert.equal(c.rcT2, 0, 'pas de tranche 2 sous le PMSS');
    assert.equal(c.cegT2, 0, 'pas de tranche 2 sous le PMSS');
    assert.equal(c.cet, 0, 'CET seulement au-dessus du PMSS');
    assert.equal(c.apec, 0, 'APEC réservée aux cadres');
    near(c.retraite, 339.3, 0.005);
    near(c.total, 625.2075, 0.005);
    near(c.deductible, 539.73, 0.005);
    near(c.nonDeductible, 85.4775, 0.005);
  });

  test('cadre 5000 € à cheval sur le PMSS — ligne à ligne (calculé à la main)', () => {
    const c = C.cotisations(5000, 'cadre', P.pmss, 0);
    // T1 = 4005, T2 = 995, baseCSG = 5000 × 0,9825 = 4912,50
    near(c.csgDed, 334.05, 0.005);
    near(c.csgNonDed, 117.9, 0.005);
    near(c.crds, 24.5625, 0.005);
    near(c.vieillessePlaf, 276.345, 0.005);   // 4005 × 6,90 %
    near(c.vieillesseDeplaf, 20, 0.005);      // 5000 × 0,40 %
    near(c.rcT1, 126.1575, 0.005);            // 4005 × 3,15 %
    near(c.cegT1, 34.443, 0.005);             // 4005 × 0,86 %
    near(c.rcT2, 85.968, 0.005);              // 995 × 8,64 %
    near(c.cegT2, 10.746, 0.005);             // 995 × 1,08 %
    near(c.cet, 7, 0.005);                    // 5000 × 0,14 %
    near(c.apec, 1.2, 0.005);                 // 5000 × 0,024 %
    near(c.retraite, 560.6595, 0.005);
    near(c.total, 1038.372, 0.005);
    near(c.deductible, 895.9095, 0.005);
    near(c.nonDeductible, 142.4625, 0.005);
  });

  test('invariant total = déductible + non déductible', () => {
    for(const statut of ['non-cadre', 'cadre']){
      for(const a of [500, 1500, 3000, 4005, 4006, 10000, 16020, 20000, 32040, 50000]){
        const c = C.cotisations(a, statut, P.pmss, 0);
        near(c.total, c.deductible + c.nonDeductible, 1e-6,
          `total (${statut}, ${a} €)`);
      }
    }
  });

  test("l'abattement CSG de 1,75 % s'arrête à 4 PASS", () => {
    const seuil = 4 * P.pmss;                       // 16 020
    const c = C.cotisations(20000, 'cadre', P.pmss, 0);
    // baseCSG = 16 020 × 0,9825 + 3 980 = 15 739,65 + 3 980 = 19 719,65
    const baseAttendue = seuil * 0.9825 + (20000 - seuil);
    near(c.csgDed, baseAttendue * P.csgDed / 100, 0.005, 'CSG déductible au-delà de 4 PASS');
    near(baseAttendue, 19719.65, 0.005, 'assiette CSG');
  });

  test('la tranche 2 est plafonnée à 8 PASS', () => {
    const c8 = C.cotisations(8 * P.pmss, 'cadre', P.pmss, 0);
    const c20 = C.cotisations(20 * P.pmss, 'cadre', P.pmss, 0);
    near(c20.rcT2, c8.rcT2, 1e-6, 'RC T2 plafonnée');
    near(c20.cegT2, c8.cegT2, 1e-6, 'CEG T2 plafonnée');
    near(c20.cet, c8.cet, 1e-6, 'CET plafonnée');
    // au-delà, seule la vieillesse déplafonnée continue de croître
    assert.ok(c20.vieillesseDeplaf > c8.vieillesseDeplaf);
  });

  test("l'APEC ne concerne que les cadres et plafonne à 4 PASS", () => {
    assert.equal(C.cotisations(5000, 'non-cadre', P.pmss, 0).apec, 0);
    const cadre = C.cotisations(20000, 'cadre', P.pmss, 0);
    near(cadre.apec, 4 * P.pmss * P.apec / 100, 0.005, 'APEC plafonnée');
  });

  test('la CET ne se déclenche qu’au-dessus du PMSS', () => {
    assert.equal(C.cotisations(P.pmss, 'cadre', P.pmss, 0).cet, 0);
    assert.ok(C.cotisations(P.pmss + 1, 'cadre', P.pmss, 0).cet > 0);
  });

  test('fonction publique : total = fpRate × assiette', () => {
    const c = C.cotisations(3000, 'fp', P.pmss, 0);
    near(c.total, 3000 * P.fpRate / 100, 0.005, 'total FP');
    // CSG non déductible + CRDS extraits du total, le reste est déductible
    near(c.nonDeductible, 3000 * 0.9825 * (P.csgNonDed + P.crds) / 100, 0.005);
    near(c.deductible, c.total - c.nonDeductible, 1e-6);
    assert.ok(c.deductible > 0, 'la part déductible doit rester positive');
  });

  test('taux forfaitaire : total = rate × assiette', () => {
    const c = C.cotisations(3000, 'custom', P.pmss, 22);
    near(c.total, 660, 0.005, 'total forfaitaire 22 %');
  });

  test('taux forfaitaire très bas : la part déductible ne devient pas négative', () => {
    const c = C.cotisations(3000, 'custom', P.pmss, 1);
    assert.ok(c.deductible >= 0, 'deductible >= 0');
  });

  test('les cotisations croissent avec l’assiette', () => {
    let prec = -1;
    for(const a of [1000, 2000, 3000, 4005, 6000, 10000, 20000, 40000]){
      const c = C.cotisations(a, 'cadre', P.pmss, 0);
      assert.ok(c.total > prec, `total non croissant à ${a} €`);
      prec = c.total;
    }
  });
});

// ---------- titresResto() ----------

describe('titresResto()', () => {
  test('50 / 50 dans les clous → aucune réintégration', () => {
    const tr = C.titresResto(20, 10, 50);
    assert.equal(tr.partEmployeurPct, 50);
    near(tr.parTitreEmployeur, 5);
    near(tr.totalEmployeur, 100);
    near(tr.totalSalarie, 100);
    assert.equal(tr.reintegre, 0);
    assert.equal(tr.motif, null);
  });

  test('part patronale à 60 % pile → toujours dans les clous', () => {
    const tr = C.titresResto(20, 10, 40);
    assert.equal(tr.partEmployeurPct, 60);
    near(tr.parTitreEmployeur, 6);
    assert.equal(tr.reintegre, 0, 'la borne 60 % est incluse');
    assert.equal(tr.motif, null);
  });

  test('part patronale à 50 % pile → toujours dans les clous', () => {
    const tr = C.titresResto(20, 10, 50);
    assert.equal(tr.reintegre, 0, 'la borne 50 % est incluse');
  });

  test('part patronale > 60 % → seul l’excédent est réintégré', () => {
    const tr = C.titresResto(20, 10, 39);       // patronale 61 %
    assert.equal(tr.partEmployeurPct, 61);
    near(tr.reintegre, 2, 0.005);               // 20 × 10 × 1 %
    assert.equal(tr.motif, 'sur60');
  });

  test('part patronale < 50 % → la totalité est réintégrée', () => {
    const tr = C.titresResto(20, 10, 51);       // patronale 49 %
    assert.equal(tr.partEmployeurPct, 49);
    near(tr.reintegre, tr.totalEmployeur, 1e-9);
    near(tr.reintegre, 98, 0.005);              // 20 × 10 × 49 %
    assert.equal(tr.motif, 'sous50');
  });

  test('plafond par titre dépassé → l’excédent est réintégré', () => {
    const tr = C.titresResto(20, 15, 50);       // part patronale 7,50 € > 7,32 €
    near(tr.parTitreEmployeur, 7.5);
    near(tr.reintegre, 20 * (7.5 - P.plafondTR), 0.005);
    near(tr.reintegre, 3.6, 0.005);
    assert.equal(tr.motif, 'plafond');
  });

  test('dépassement des 60 % ET du plafond → le plus pénalisant l’emporte', () => {
    const tr = C.titresResto(20, 15, 38);       // patronale 62 %, soit 9,30 €/titre
    const excesSur60 = 20 * 15 * 0.02;          // 6
    const excesPlafond = 20 * (9.3 - P.plafondTR); // 39,60
    near(tr.reintegre, Math.max(excesSur60, excesPlafond), 0.005);
    near(tr.reintegre, 39.6, 0.005);
    assert.equal(tr.motif, 'plafond');
  });

  test('aucun titre → tout à zéro', () => {
    const tr = C.titresResto(0, 0, 50);
    assert.equal(tr.totalEmployeur, 0);
    assert.equal(tr.totalSalarie, 0);
    assert.equal(tr.reintegre, 0);
  });

  test('invariant : part salariale + part patronale = valeur faciale totale', () => {
    for(const part of [30, 40, 50, 55, 60, 70]){
      const tr = C.titresResto(21, 8, part);
      near(tr.totalSalarie + tr.totalEmployeur, 21 * 8, 1e-6, `part salariale ${part} %`);
    }
  });
});

// ---------- splitHeures() ----------

describe('splitHeures()', () => {
  test('35 h → aucune heure supplémentaire', () => {
    const s = C.splitHeures(scn({ dureeType: '35', brut: 3000 }));
    assert.equal(s.heuresSup, 0);
    near(s.brutHS, 0, 1e-9);
    near(s.brutBase, 3000, 1e-9);
  });

  test('39 h → 17,33 h supplémentaires par mois', () => {
    const s = C.splitHeures(scn({ dureeType: '39', brut: 3000 }));
    near(s.heuresSup, 4 * 52 / 12, 1e-9);
    near(s.heuresSup, 17.3333, 0.0001);
  });

  test('invariant : brut de base + brut heures sup = brut total', () => {
    for(const brut of [1500, 2300, 3000, 5000, 12000]){
      const s = C.splitHeures(scn({ dureeType: '39', brut }));
      near(s.brutBase + s.brutHS, brut, 1e-6, `brut ${brut} €`);
    }
  });

  test('les heures sup sont bien majorées de 25 %', () => {
    const s = C.splitHeures(scn({ dureeType: '39', brut: 3000 }));
    near(s.brutHS, s.tauxHoraire * s.heuresSup * 1.25, 1e-6, 'brut heures sup majoré');
    near(s.brutBase, s.tauxHoraire * C.HEURES_BASE, 1e-6, 'brut de base');
  });

  test('brut nul → aucune division par zéro', () => {
    const s = C.splitHeures(scn({ dureeType: '39', brut: 0 }));
    allFinite(s, 'splitHeures(0)');
  });
});

// ---------- compute() : cas de référence ----------

describe('compute() — cas de référence (calculés à la main)', () => {
  test('non-cadre, 3000 €, 35 h, sans TR ni mutuelle', () => {
    const r = C.compute(scn({ brut: 3000, statut: 'non-cadre', dureeType: '35' }));
    near(r.netApres, 2374.7925, 0.01, 'net à payer');       // 3000 − 625,2075
    near(r.netImposable, 2460.27, 0.01, 'net imposable');    // 3000 − 539,73
    near(r.m.exoHS, 0, 1e-9, 'pas d’exonération sans heures sup');
    near(r.tauxEffectif, 625.2075 / 3000 * 100, 0.001, 'taux de cotisation effectif');
  });

  test('cadre, 5000 €, 35 h', () => {
    const r = C.compute(scn({ brut: 5000, statut: 'cadre', dureeType: '35' }));
    near(r.netApres, 5000 - 1038.372, 0.01, 'net à payer');
    near(r.netImposable, 5000 - 895.9095, 0.01, 'net imposable');
  });

  test('mutuelle : retirée du net, part patronale réintégrée à l’imposable', () => {
    const base = C.compute(scn({ brut: 3000, mutuelle: 0, mutuellePat: 0 }));
    const avec = C.compute(scn({ brut: 3000, mutuelle: 30, mutuellePat: 45 }));
    near(avec.netApres, base.netApres - 30, 0.01, 'net diminué de la part salariale');
    near(avec.netImposable, base.netImposable - 30 + 45, 0.01,
      'imposable : −part salariale +part patronale');
  });

  test('titres restaurant conformes : part salariale déduite, cotisations inchangées', () => {
    const base = C.compute(scn({ brut: 3000, joursResto: 0 }));
    const avec = C.compute(scn({ brut: 3000, joursResto: 21, valeurResto: 8, partResto: 50 }));
    assert.equal(avec.tr.reintegre, 0);
    near(avec.netApres, base.netApres - 21 * 8 * 0.5, 0.01, 'net diminué de la part salariale');
    near(avec.m.cotisNettes, base.m.cotisNettes, 0.01, 'cotisations inchangées');
  });

  test('titres restaurant non conformes : la réintégration alourdit les cotisations', () => {
    const ok = C.compute(scn({ brut: 3000, joursResto: 21, valeurResto: 8, partResto: 50 }));
    const ko = C.compute(scn({ brut: 3000, joursResto: 21, valeurResto: 8, partResto: 55 }));
    assert.ok(ko.tr.reintegre > 0, 'part patronale à 45 % → réintégration');
    assert.equal(ko.tr.motif, 'sous50');
    assert.ok(ko.m.cotisNettes > ok.m.cotisNettes, 'cotisations plus élevées');
    assert.ok(ko.m.assiette > ok.m.assiette, 'assiette élargie');
  });
});

// ---------- compute() : heures supplémentaires ----------

describe('compute() — heures supplémentaires', () => {
  test('à brut égal, 39 h laisse plus de net que 35 h (réduction salariale)', () => {
    const h35 = C.compute(scn({ brut: 3000, dureeType: '35' }));
    const h39 = C.compute(scn({ brut: 3000, dureeType: '39' }));
    assert.ok(h39.netApres > h35.netApres,
      `39 h (${h39.netApres}) devrait dépasser 35 h (${h35.netApres})`);
    assert.ok(h39.m.reducHS > 0, 'réduction salariale appliquée');
  });

  test('la réduction est plafonnée aux cotisations retraite réellement dues', () => {
    // Taux forfaitaire très bas : la retraite due est inférieure aux 11,31 %,
    // la réduction doit suivre ce plancher et non le taux paramétré.
    const r = C.compute(scn({ brut: 3000, dureeType: '39', statut: 'custom', rate: 5 }));
    assert.ok(r.m.reducHS >= 0);
    assert.ok(r.m.reducHS <= r.brutHS * P.reducHS / 100 + 1e-9,
      'la réduction ne peut pas dépasser le taux paramétré');
    assert.ok(r.m.cotisNettes >= 0, 'les cotisations nettes ne deviennent pas négatives');
  });

  test('exonération d’IR appliquée sur les heures sup', () => {
    const r = C.compute(scn({ brut: 3000, dureeType: '39' }));
    assert.ok(r.m.exoHS > 0, 'une exonération doit être calculée');
    near(r.m.netImposable, r.m.netImposableAvantExo - r.m.exoHS, 1e-6);
    assert.ok(r.m.netImposable < r.m.netImposableAvantExo,
      'le net imposable doit baisser');
  });

  test('l’exonération d’IR ne dépasse jamais le plafond annuel', () => {
    for(const brut of [3000, 6000, 9000, 15000, 30000]){
      const r = C.compute(scn({ brut, dureeType: '39', statut: 'cadre' }));
      assert.ok(r.m.exoHS <= P.plafondExoIR / 12 + 1e-9,
        `exonération mensuelle hors plafond à ${brut} € : ${r.m.exoHS}`);
      assert.ok(r.a.exoHS <= P.plafondExoIR + 1e-9,
        `exonération annuelle hors plafond à ${brut} € : ${r.a.exoHS}`);
    }
  });

  test('le plafond mord bien sur les hauts salaires', () => {
    const bas = C.compute(scn({ brut: 3000, dureeType: '39' }));
    const haut = C.compute(scn({ brut: 30000, dureeType: '39', statut: 'cadre' }));
    assert.ok(bas.a.exoHS < P.plafondExoIR, 'à 3000 € le plafond ne mord pas');
    near(haut.a.exoHS, P.plafondExoIR, 1e-6, 'à 30 000 € le plafond sature');
  });

  test('l’exonération mensuelle est cohérente avec l’annuelle', () => {
    const r = C.compute(scn({ brut: 3000, dureeType: '39' }));
    near(r.m.exoHS * 12, r.a.exoHS, 1, 'exonération mensuelle × 12 ≈ annuelle');
  });

  test('aucune exonération à 35 h', () => {
    const r = C.compute(scn({ brut: 3000, dureeType: '35' }));
    assert.equal(r.m.exoHS, 0);
    assert.equal(r.a.exoHS, 0);
    near(r.m.netImposable, r.m.netImposableAvantExo, 1e-9);
  });
});

// ---------- compute() : annuel ----------

describe('compute() — annuel', () => {
  test('12 mensualités sans prime ≈ 12 × le mensuel', () => {
    const r = C.compute(scn({ brut: 3000, nbMois: 12, primes: 0 }));
    near(r.a.netApres, r.m.netApres * 12, 1, 'net annuel');
    near(r.a.netImposable, r.m.netImposable * 12, 1, 'imposable annuel');
  });

  test('une 13e mensualité augmente l’annuel mais pas le mensuel', () => {
    const douze = C.compute(scn({ brut: 3000, nbMois: 12 }));
    const treize = C.compute(scn({ brut: 3000, nbMois: 13 }));
    near(treize.netApres, douze.netApres, 1e-9, 'mensuel inchangé');
    assert.ok(treize.annuelNet > douze.annuelNet, 'annuel augmenté');
  });

  test('les primes n’affectent que l’annuel', () => {
    const sans = C.compute(scn({ brut: 3000, primes: 0 }));
    const avec = C.compute(scn({ brut: 3000, primes: 3000 }));
    near(avec.netApres, sans.netApres, 1e-9, 'mensuel inchangé');
    assert.ok(avec.annuelNet > sans.annuelNet, 'annuel augmenté');
  });

  test('l’annuel utilise bien les tranches annuelles (PASS)', () => {
    // Un brut juste sous le PMSS ne doit déclencher aucune tranche 2, ni mensuelle
    // ni annuelle : si l'annuel utilisait le plafond mensuel, T2 apparaîtrait.
    const r = C.compute(scn({ brut: P.pmss - 5, statut: 'cadre' }));
    near(r.a.c.rcT2, 0, 1e-6, 'pas de tranche 2 annuelle');
    near(r.a.c.cegT2, 0, 1e-6, 'pas de tranche 2 annuelle');
  });

  test('les titres restaurant annuels correspondent à 12 mois', () => {
    const r = C.compute(scn({ brut: 3000, joursResto: 21, valeurResto: 8, partResto: 50 }));
    near(r.a.netApres, r.m.netApres * 12, 1, 'TR annualisés cohérents');
  });
});

// ---------- compute() : prélèvement à la source ----------

describe('barème de l’impôt sur le revenu', () => {
  test('paramètres fiscaux 2026', () => {
    assert.deepEqual(P.ir.tranches.map(t => t[0]).slice(0, 4), [11600, 29579, 84577, 181917]);
    assert.deepEqual(P.ir.tranches.map(t => t[1]), [0, 0.11, 0.30, 0.41, 0.45]);
    assert.equal(P.ir.abattementMin, 495);
    assert.equal(P.ir.abattementMax, 14171);
    assert.equal(P.ir.plafondDemiPart, 1807);
    assert.equal(P.ir.decote.baseSeul, 897);
    assert.equal(P.ir.decote.baseCouple, 1483);
    assert.equal(P.ir.decote.taux, 45.25);
  });

  test('les seuils de décote découlent bien de la formule', () => {
    // La décote s'annule quand base − taux × impôt = 0, soit impôt = base / taux.
    near(P.ir.decote.baseSeul / (P.ir.decote.taux / 100), P.ir.decote.seuilSeul, 1, 'seuil seul');
    near(P.ir.decote.baseCouple / (P.ir.decote.taux / 100), P.ir.decote.seuilCouple, 1, 'seuil couple');
  });

  test('barème par part — calculé à la main', () => {
    near(C.baremeIR(0), 0, 1e-9);
    near(C.baremeIR(11600), 0, 1e-9, 'limite haute de la tranche à 0 %');
    near(C.baremeIR(27000), 1694, 0.01);          // (27 000 − 11 600) × 11 %
    // 17 979 × 11 % = 1 977,69 puis 15 421 × 30 % = 4 626,30
    near(C.baremeIR(45000), 6603.99, 0.01);
    // + 54 998 × 30 % = 16 499,40 puis 15 423 × 41 % = 6 323,43
    near(C.baremeIR(100000), 24800.52, 0.01);
    // + 97 340 × 41 % = 39 909,40 puis 18 083 × 45 % = 8 137,35
    near(C.baremeIR(200000), 66523.84, 0.01);
  });

  test('barème strictement croissant et jamais négatif', () => {
    let prec = -1;
    for(const r of [0, 5000, 11600, 20000, 29579, 50000, 84577, 120000, 181917, 300000]){
      const i = C.baremeIR(r);
      assert.ok(i >= 0, `impôt négatif à ${r} €`);
      assert.ok(i >= prec, `barème non croissant à ${r} €`);
      prec = i;
    }
    near(C.baremeIR(-5000), 0, 1e-9, 'revenu négatif');
  });

  test('abattement de 10 % : plancher, plafond et cas limites', () => {
    near(C.abattementFraisPro(30000), 3000, 0.01, 'cas courant');
    near(C.abattementFraisPro(200000), 14171, 0.01, 'plafond');
    near(C.abattementFraisPro(3000), 495, 0.01, 'plancher');
    near(C.abattementFraisPro(300), 300, 0.01, 'le plancher ne dépasse pas le revenu');
    near(C.abattementFraisPro(0), 0, 1e-9);
    near(C.abattementFraisPro(-100), 0, 1e-9);
  });

  test('parts de quotient familial', () => {
    assert.equal(C.partsFiscales(false, 0), 1, 'célibataire');
    assert.equal(C.partsFiscales(true, 0), 2, 'couple');
    assert.equal(C.partsFiscales(false, 1), 1.5, 'une demi-part pour le 1er enfant');
    assert.equal(C.partsFiscales(false, 2), 2, 'une demi-part pour le 2e');
    assert.equal(C.partsFiscales(false, 3), 3, 'une part entière à partir du 3e');
    assert.equal(C.partsFiscales(true, 3), 4);
    assert.equal(C.partsFiscales(true, 4), 5);
    assert.equal(C.partsFiscales(false, -2), 1, 'valeur négative ignorée');
  });

  test('impôt d’un célibataire avec décote — calculé à la main', () => {
    // Revenu 27 000 → impôt brut 1 694 ; décote = 897 − 45,25 % × 1 694 = 130,465
    near(C.impotFoyer(27000, false, 0), 1563.535, 0.01);
  });

  test('impôt d’un célibataire au-dessus du seuil de décote', () => {
    near(C.impotFoyer(45000, false, 0), 6603.99, 0.01);
  });

  test('la décote peut annuler complètement l’impôt', () => {
    // Couple, revenu 30 000 : impôt brut 748, décote 1 144,53 > impôt
    near(C.impotFoyer(30000, true, 0), 0, 1e-9);
  });

  test('plafonnement du quotient familial — calculé à la main', () => {
    // Couple + 2 enfants, revenu 108 000 : 3 parts contre 2 de base.
    // Avec QF : barème(36 000) × 3 = 11 711,97
    // Sans     : barème(54 000) × 2 = 18 607,98 → avantage 6 896,01
    // Plafond  : 1 807 × 2 demi-parts = 3 614 → écrêté
    near(C.impotFoyer(108000, true, 2), 18607.98 - 3614, 0.01);
  });

  test('le quotient familial n’est pas écrêté quand l’avantage reste sous le plafond', () => {
    // Revenu modeste : l'avantage des demi-parts est inférieur à 3 614 €
    const avecEnfants = C.impotFoyer(40000, true, 2);
    const sansEnfants = C.impotFoyer(40000, true, 0);
    assert.ok(avecEnfants < sansEnfants, 'les enfants doivent réduire l’impôt');
    assert.ok(sansEnfants - avecEnfants < P.ir.plafondDemiPart * 2 + 1e-6,
      'avantage sous le plafond, donc non écrêté');
  });

  test('revenu nul ou négatif → aucun impôt', () => {
    near(C.impotFoyer(0, false, 0), 0, 1e-9);
    near(C.impotFoyer(-10000, false, 0), 0, 1e-9);
  });

  test('l’impôt croît avec le revenu et décroît avec les parts', () => {
    let prec = -1;
    for(const r of [15000, 25000, 40000, 80000, 150000]){
      const i = C.impotFoyer(r, false, 0);
      assert.ok(i >= prec, `impôt non croissant à ${r} €`);
      prec = i;
    }
    for(const r of [40000, 80000, 150000]){
      assert.ok(C.impotFoyer(r, true, 0) <= C.impotFoyer(r, false, 0), 'couple ≤ célibataire');
      assert.ok(C.impotFoyer(r, true, 2) <= C.impotFoyer(r, true, 0), 'enfants réduisent l’impôt');
    }
  });
});

describe('compute() — impôt sur le revenu', () => {
  test('célibataire à 3000 € — chaîne complète calculée à la main', () => {
    const r = C.compute(scn({ brut: 3000 }));
    // net imposable annuel 29 523,24 → abattement 2 952,324 → revenu 26 570,916
    // impôt brut (26 570,916 − 11 600) × 11 % = 1 646,80076
    // décote 897 − 45,25 % × 1 646,80076 = 151,8226561 → impôt 1 494,9781
    near(r.impotAnnuel, 1494.9781, 0.01, 'impôt annuel');
    near(r.netApresImpot, 2374.7925 - 1494.9781 / 12, 0.01, 'net après impôt');
    near(r.netApresImpot, 2250.211, 0.01);
  });

  test('cohérence mensuel / annuel', () => {
    const r = C.compute(scn({ brut: 3000 }));
    near(r.annuelNetApresImpot, r.annuelNet - r.impotAnnuel, 0.01);
    near(r.netApresImpot, r.netApres - r.impotAnnuel / 12, 0.01);
  });

  test('le taux d’impôt affiché correspond au montant', () => {
    const r = C.compute(scn({ brut: 3000 }));
    near(r.tauxImpot, r.impotAnnuel / r.a.netImposable * 100, 0.01);
  });

  test('la progressivité est prise en compte : un salaire plus élevé est plus taxé', () => {
    const bas = C.compute(scn({ brut: 3000 }));
    const haut = C.compute(scn({ brut: 3600 }));
    assert.ok(haut.tauxImpot > bas.tauxImpot,
      `le taux doit monter avec le salaire (${bas.tauxImpot} → ${haut.tauxImpot})`);
  });

  test('le gain d’une augmentation est bien amputé par la progressivité', () => {
    // C'est le défaut qui a motivé le passage au barème : avec un taux moyen
    // unique appliqué aux deux salaires, le gain après impôt était surestimé.
    const bas = C.compute(scn({ brut: 3000 }));
    const haut = C.compute(scn({ brut: 3600 }));
    const gainReel = haut.netApresImpot - bas.netApresImpot;
    const gainNaif = (haut.netApres - bas.netApres) * (1 - bas.tauxImpot / 100);
    assert.ok(gainReel < gainNaif,
      `le gain réel (${gainReel.toFixed(2)}) doit être inférieur au calcul à taux constant (${gainNaif.toFixed(2)})`);
  });

  test('un salaire modeste n’est pas imposé (décote)', () => {
    const r = C.compute(scn({ brut: 1400 }));
    near(r.impotAnnuel, 0, 1e-9);
    near(r.netApresImpot, r.netApres, 1e-9);
  });

  test('le couple et les personnes à charge réduisent l’impôt', () => {
    const seul = C.compute(scn({ brut: 3000 }));
    const couple = C.compute(scn({ brut: 3000 }), foy({ couple:true }));
    const famille = C.compute(scn({ brut: 3000 }), foy({ couple:true, personnesCharge:2 }));
    assert.ok(couple.impotAnnuel < seul.impotAnnuel, 'couple moins imposé');
    assert.ok(famille.impotAnnuel <= couple.impotAnnuel, 'enfants à charge');
  });

  test('les autres revenus du foyer augmentent l’impôt imputé au salaire', () => {
    // Effet de tranche : à revenus du foyer plus élevés, le même salaire
    // supporte un supplément d'impôt plus lourd.
    const seulRevenu = C.compute(scn({ brut: 3000 }), foy({ couple:true }));
    const avecConjoint = C.compute(scn({ brut: 3000 }), foy({ couple:true, autresRevenus:40000 }));
    assert.ok(avecConjoint.impotAnnuel > seulRevenu.impotAnnuel,
      'le supplément d’impôt doit être plus élevé');
  });

  test('l’impôt imputé est bien un supplément, pas l’impôt du foyer entier', () => {
    const r = C.compute(scn({ brut: 3000 }), foy({ couple:true, autresRevenus:40000 }));
    const base = Math.max(0, r.a.netImposable) - C.abattementFraisPro(Math.max(0, r.a.netImposable));
    const baseAutres = 40000 - C.abattementFraisPro(40000);
    const attendu = C.impotFoyer(baseAutres + base, true, 0) - C.impotFoyer(baseAutres, true, 0);
    near(r.impotAnnuel, attendu, 0.01);
  });

  test('à 39 h, l’exonération d’heures sup allège l’impôt', () => {
    const h35 = C.compute(scn({ brut: 3000, dureeType: '35' }));
    const h39 = C.compute(scn({ brut: 3000, dureeType: '39' }));
    assert.ok(h39.impotAnnuel < h35.impotAnnuel,
      'à brut égal, les heures sup exonérées doivent réduire l’impôt');
  });

  test('le foyer fiscal ne se lit plus sur le salaire', () => {
    // Le foyer est un réglage global : des clés posées sur le scénario ne
    // doivent avoir aucun effet, sinon deux salaires comparés pourraient
    // porter des foyers différents — ce qui n'a aucun sens.
    const neutre = C.compute(scn({ brut: 3000 }), foy());
    const pollue = C.compute(
      scn({ brut: 3000, foyerCouple: true, foyerEnfants: 3, autresRevenus: 50000 }), foy());
    near(pollue.impotAnnuel, neutre.impotAnnuel, 1e-9);
  });

  test('foyer omis = célibataire sans personne à charge', () => {
    near(C.compute(scn({ brut: 3000 })).impotAnnuel,
         C.compute(scn({ brut: 3000 }), foy()).impotAnnuel, 1e-9);
  });

  test('les revenus du conjoint sont ignorés hors couple', () => {
    // Le champ disparaît de l'interface quand on repasse sur « Seul(e) » :
    // le calcul doit s'aligner, sinon une valeur invisible fausserait le résultat.
    const avec = C.compute(scn({ brut: 3000 }), foy({ couple: false, autresRevenus: 50000 }));
    const sans = C.compute(scn({ brut: 3000 }), foy({ couple: false, autresRevenus: 0 }));
    near(avec.impotAnnuel, sans.impotAnnuel, 1e-9);
  });

  test('le net après impôt reste borné', () => {
    for(const brut of [0, 1200, 3000, 12000, 40000]){
      const r = C.compute(scn({ brut }));
      assert.ok(r.netApresImpot >= 0, 'net après impôt négatif');
      assert.ok(r.netApresImpot <= r.netApres + 1e-9, 'net après impôt supérieur au net');
      assert.ok(r.annuelNetApresImpot >= 0);
      assert.ok(r.impotAnnuel >= 0, 'impôt négatif');
    }
  });
});

// ---------- compute() : absences ----------

describe('compute() — absences', () => {
  test('congés payés, durée 0 → aucun effet', () => {
    const sans = C.compute(scn({ brut: 3000 }));
    const avec = C.compute(scn({ brut: 3000, absenceType: 'conges', absenceDuree: 0 }));
    near(avec.netApres, sans.netApres, 0.01);
  });

  test('congés payés sans TR : salaire maintenu, net strictement inchangé', () => {
    const ref = C.compute(scn({ brut: 3000, joursResto: 0 })).netApres;
    for(const d of [0, 5, 15, 30]){
      const r = C.compute(scn({ brut: 3000, joursResto: 0, absenceType: 'conges', absenceDuree: d }));
      near(r.netApres, ref, 0.01, `net à ${d} jours de congés`);
    }
  });

  test('congés payés avec TR : le net remonte à proportion des titres non consommés', () => {
    // Comportement contre-intuitif mais exact : le salaire est maintenu et la
    // part salariale des titres restaurant n'est pas prélevée pendant l'absence.
    const ref = C.compute(scn({ brut: 3000, joursResto: 21, valeurResto: 8, partResto: 50 }));
    const partSalarialeMensuelle = 21 * 8 * 0.5;
    let prec = -Infinity;
    for(const d of [0, 5, 10, 20, 30]){
      const r = C.compute(scn({ brut: 3000, joursResto: 21, valeurResto: 8, partResto: 50, absenceType: 'conges', absenceDuree: d }));
      near(r.netApres, ref.netApres + (d / 30) * partSalarialeMensuelle, 0.01,
        `net à ${d} jours de congés`);
      assert.ok(r.netApres >= prec, 'progression monotone');
      prec = r.netApres;
    }
  });

  test('arrêt de travail : le net baisse quand la durée augmente', () => {
    let prec = Infinity;
    for(const d of [0, 5, 10, 20, 30]){
      const r = C.compute(scn({ brut: 3000, absenceType: 'arret', absenceDuree: d, maintienPct: 90 }));
      assert.ok(r.netApres <= prec + 1e-9, `net non décroissant à ${d} jours`);
      prec = r.netApres;
    }
  });

  test('congés payés 30 jours : salaire maintenu, mais sans titres restaurant', () => {
    const r = C.compute(scn({ brut: 3000, joursResto: 21, valeurResto: 8, partResto: 50, absenceType: 'conges', absenceDuree: 30 }));
    const ref = C.compute(scn({ brut: 3000, joursResto: 21, valeurResto: 8, partResto: 50 }));
    near(r.netApres, ref.netApres + 21 * 8 * 0.5, 0.01,
      'le net remonte de la part salariale des TR non consommés');
  });

  test('arrêt de travail : la carence pèse sur le net', () => {
    const avecCarence = C.compute(scn({ brut: 3000, absenceType: 'arret', absenceDuree: 10, maintienPct: 90, carenceCouverte: false }));
    const sansCarence = C.compute(scn({ brut: 3000, absenceType: 'arret', absenceDuree: 10, maintienPct: 90, carenceCouverte: true }));
    assert.ok(sansCarence.netApres > avecCarence.netApres,
      'la carence prise en charge doit améliorer le net');
  });

  test('arrêt de travail : un maintien plus élevé donne un net plus élevé', () => {
    const a50 = C.compute(scn({ brut: 3000, absenceType: 'arret', absenceDuree: 10, maintienPct: 50 }));
    const a90 = C.compute(scn({ brut: 3000, absenceType: 'arret', absenceDuree: 10, maintienPct: 90 }));
    assert.ok(a90.netApres > a50.netApres);
  });

  test('durée d’absence bornée à 30 jours', () => {
    const j30 = C.compute(scn({ brut: 3000, absenceType: 'conges', absenceDuree: 30 }));
    const j99 = C.compute(scn({ brut: 3000, absenceType: 'conges', absenceDuree: 99 }));
    near(j99.netApres, j30.netApres, 0.01, 'au-delà de 30 jours, plus d’effet');
  });

  test('durée négative traitée comme nulle', () => {
    const neg = C.compute(scn({ brut: 3000, absenceType: 'conges', absenceDuree: -5 }));
    const zero = C.compute(scn({ brut: 3000, absenceType: 'conges', absenceDuree: 0 }));
    near(neg.netApres, zero.netApres, 0.01);
  });

  test('l’absence se répercute sur l’annuel et l’imposable', () => {
    const sans = C.compute(scn({ brut: 3000 }));
    const avec = C.compute(scn({ brut: 3000, absenceType: 'arret', absenceDuree: 15 }));
    assert.ok(avec.annuelNet < sans.annuelNet, 'annuel réduit');
    assert.ok(avec.netImposable < sans.netImposable, 'imposable réduit');
  });
});

// ---------- Invariants généraux ----------

describe('invariants généraux', () => {
  test('le net est toujours strictement inférieur au brut', () => {
    for(const statut of ['non-cadre', 'cadre', 'fp', 'custom']){
      for(const brut of [1200, 2000, 3000, 5000, 12000, 40000]){
        for(const duree of ['35', '39']){
          const r = C.compute(scn({ brut, statut, dureeType: duree, rate: 22 }));
          assert.ok(r.netApres < brut,
            `net (${r.netApres}) ≥ brut (${brut}) — ${statut} ${duree} h`);
          assert.ok(r.netApres > 0, `net négatif — ${statut} ${brut} € ${duree} h`);
        }
      }
    }
  });

  test('aucune métrique de coût employeur n’est exposée', () => {
    // Retirée en v1.3.0 : le forfait de 42 % ignorait la réduction générale
    // dégressive, applicable jusqu'à 3 SMIC, ce qui faussait la métrique pour
    // la majorité des salaires. Ce test empêche sa réintroduction par accident.
    const r = C.compute(scn({ brut: 3000 }));
    assert.equal(r.coutEmployeur, undefined, 'compute() ne doit plus renvoyer coutEmployeur');
    assert.equal(r.m.coutEmployeur, undefined, 'periode() ne doit plus renvoyer coutEmployeur');
    assert.equal(P.patronal, undefined, 'le forfait de charges patronales doit avoir disparu');
  });

  test('le net après impôt ne dépasse jamais le net à payer', () => {
    for(const f of [{}, { couple: true }, { personnesCharge: 3 },
                    { couple: true, autresRevenus: 60000 }]){
      const r = C.compute(scn({ brut: 3000 }), foy(f));
      assert.ok(r.netApresImpot <= r.netApres + 1e-9);
    }
  });

  test('brut nul : aucune valeur aberrante', () => {
    const r = C.compute(scn({ brut: 0, joursResto: 21, valeurResto: 8 }));
    allFinite(r, 'compute(0)');
    assert.equal(r.tauxEffectif, 0, 'pas de division par zéro sur le taux effectif');
  });

  test('balayage large : aucune valeur non finie ni négative aberrante', () => {
    const statuts = ['non-cadre', 'cadre', 'fp', 'custom'];
    const bruts = [0, 800, 1801.80, 3000, 4005, 4006, 16020, 32040, 60000];
    let cas = 0;
    for(const statut of statuts){
      for(const brut of bruts){
        for(const dureeType of ['35', '39']){
          for(const joursResto of [0, 21]){
            for(const absenceType of ['none', 'conges', 'arret']){
              const r = C.compute(scn({ brut, statut, dureeType, joursResto, valeurResto: 8, partResto: 50, rate: 22, mutuelle: 30, mutuellePat: 45, absenceType, absenceDuree: absenceType === 'none' ? 0 : 12, primes: 1500, nbMois: 12 }), foy({ couple:absenceType === 'arret', personnesCharge:2, autresRevenus:18000 }));
              allFinite(r, `compute(${statut},${brut},${dureeType})`);
              assert.ok(r.netApres >= -1e-9,
                `net négatif : ${statut} ${brut} € ${dureeType} h → ${r.netApres}`);
              assert.ok(r.netImposable >= 0, 'imposable négatif');
              assert.ok(r.m.cotisNettes >= 0, 'cotisations négatives');
              assert.ok(r.netApresImpot >= 0, 'net après impôt négatif');
              cas++;
            }
          }
        }
      }
    }
    assert.ok(cas >= 400, `balayage trop étroit : ${cas} cas`);
  });

  test('monotonie : à paramètres égaux, un brut plus élevé donne un net plus élevé', () => {
    for(const statut of ['non-cadre', 'cadre', 'fp']){
      let prec = -Infinity;
      for(const brut of [1500, 2000, 2500, 3000, 4000, 4005, 4500, 6000, 10000, 20000]){
        const r = C.compute(scn({ brut, statut }));
        assert.ok(r.netApres > prec,
          `net non croissant à ${brut} € (${statut}) : ${r.netApres} ≤ ${prec}`);
        prec = r.netApres;
      }
    }
  });

  test('aucune discontinuité brutale au franchissement du PMSS', () => {
    const avant = C.compute(scn({ brut: P.pmss - 1, statut: 'cadre' }));
    const apres = C.compute(scn({ brut: P.pmss + 1, statut: 'cadre' }));
    const ecart = Math.abs(apres.netApres - avant.netApres);
    assert.ok(ecart < 20,
      `saut de ${ecart.toFixed(2)} € au passage du PMSS — vérifier les tranches`);
  });
});

// ---------- Utilitaires ----------

describe('utilitaires', () => {
  test('parseNum accepte virgules, espaces et valeurs vides', () => {
    assert.equal(C.parseNum('1 234,56'), 1234.56);
    assert.equal(C.parseNum('2500'), 2500);
    assert.equal(C.parseNum('3,5'), 3.5);
    assert.equal(C.parseNum(''), 0);
    assert.equal(C.parseNum('abc'), 0);
    assert.equal(C.parseNum(null), 0);
    assert.equal(C.parseNum(undefined), 0);
  });

  test('clamp borne des deux côtés', () => {
    assert.equal(C.clamp(5, 0, 10), 5);
    assert.equal(C.clamp(-5, 0, 10), 0);
    assert.equal(C.clamp(50, 0, 10), 10);
  });

  test('les valeurs par défaut d’un nouveau salaire sont cohérentes', () => {
    const d = C.scenarioDefaults;
    assert.equal(d.joursResto, 21, 'jours de titres restaurant par défaut');
    assert.equal(d.valeurResto, 8, 'valeur du titre par défaut');
    assert.equal(d.partResto, 50, 'part salariale par défaut');
    // La part patronale qui en découle doit rester dans les clous légaux
    const tr = C.titresResto(d.joursResto, d.valeurResto, d.partResto);
    assert.equal(tr.reintegre, 0,
      'les valeurs par défaut ne doivent jamais déclencher de réintégration');
    assert.ok(tr.parTitreEmployeur <= P.plafondTR,
      'la part patronale par défaut doit rester sous le plafond par titre');
  });
});
