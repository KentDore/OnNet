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
             cotisations, titresResto, splitHeures, periode, compute };`);
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
    mutuelle: 0, mutuellePat: 0, pasRate: 0,
    joursResto: 0, valeurResto: 0, partResto: 50,
    dureeType: '35', nbMois: 12, primes: 0,
    maintienPct: 90, carenceCouverte: false,
    absenceType: 'none', absenceDuree: 0
  }, over || {});
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
    near(r.coutEmployeur, 4260, 0.01, 'coût employeur');     // 3000 × 1,42
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

describe('compute() — prélèvement à la source', () => {
  test('taux nul → net après impôt = net à payer', () => {
    const r = C.compute(scn({ brut: 3000, pasRate: 0 }));
    near(r.netApresImpot, r.netApres, 1e-9);
  });

  test('le taux s’applique au net imposable', () => {
    const r = C.compute(scn({ brut: 3000, pasRate: 10 }));
    near(r.netApresImpot, r.netApres - r.netImposable * 0.10, 0.01);
  });

  test('taux hors bornes ramené dans [0 ; 100]', () => {
    const negatif = C.compute(scn({ brut: 3000, pasRate: -50 }));
    near(negatif.netApresImpot, negatif.netApres, 1e-9, 'taux négatif ignoré');
    const excessif = C.compute(scn({ brut: 3000, pasRate: 250 }));
    const cent = C.compute(scn({ brut: 3000, pasRate: 100 }));
    near(excessif.netApresImpot, cent.netApresImpot, 1e-9, 'taux > 100 ramené à 100');
  });

  test('le net après impôt ne devient jamais négatif', () => {
    const r = C.compute(scn({ brut: 3000, pasRate: 100 }));
    assert.ok(r.netApresImpot >= 0);
    assert.ok(r.annuelNetApresImpot >= 0);
  });

  test('à 39 h, l’exonération d’IR réduit l’impôt estimé', () => {
    const s = scn({ brut: 3000, dureeType: '39', pasRate: 10 });
    const r = C.compute(s);
    // impôt = netImposable × 10 %, avec netImposable déjà exonéré
    const impot = r.netApres - r.netApresImpot;
    const impotSansExo = r.m.netImposableAvantExo * 0.10;
    assert.ok(impot < impotSansExo, 'l’impôt estimé doit être plus faible');
    near(impot, r.m.netImposable * 0.10, 0.01);
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
      const r = C.compute(scn({ brut: 3000, joursResto: 0,
                                absenceType: 'conges', absenceDuree: d }));
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
      const r = C.compute(scn({ brut: 3000, joursResto: 21, valeurResto: 8, partResto: 50,
                                absenceType: 'conges', absenceDuree: d }));
      near(r.netApres, ref.netApres + (d / 30) * partSalarialeMensuelle, 0.01,
        `net à ${d} jours de congés`);
      assert.ok(r.netApres >= prec, 'progression monotone');
      prec = r.netApres;
    }
  });

  test('arrêt de travail : le net baisse quand la durée augmente', () => {
    let prec = Infinity;
    for(const d of [0, 5, 10, 20, 30]){
      const r = C.compute(scn({ brut: 3000, absenceType: 'arret',
                                absenceDuree: d, maintienPct: 90 }));
      assert.ok(r.netApres <= prec + 1e-9, `net non décroissant à ${d} jours`);
      prec = r.netApres;
    }
  });

  test('congés payés 30 jours : salaire maintenu, mais sans titres restaurant', () => {
    const r = C.compute(scn({ brut: 3000, joursResto: 21, valeurResto: 8, partResto: 50,
                              absenceType: 'conges', absenceDuree: 30 }));
    const ref = C.compute(scn({ brut: 3000, joursResto: 21, valeurResto: 8, partResto: 50 }));
    near(r.netApres, ref.netApres + 21 * 8 * 0.5, 0.01,
      'le net remonte de la part salariale des TR non consommés');
  });

  test('arrêt de travail : la carence pèse sur le net', () => {
    const avecCarence = C.compute(scn({ brut: 3000, absenceType: 'arret',
                                        absenceDuree: 10, maintienPct: 90,
                                        carenceCouverte: false }));
    const sansCarence = C.compute(scn({ brut: 3000, absenceType: 'arret',
                                        absenceDuree: 10, maintienPct: 90,
                                        carenceCouverte: true }));
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

  test('l’absence se répercute sur l’annuel et le coût employeur', () => {
    const sans = C.compute(scn({ brut: 3000 }));
    const avec = C.compute(scn({ brut: 3000, absenceType: 'arret', absenceDuree: 15 }));
    assert.ok(avec.annuelNet < sans.annuelNet, 'annuel réduit');
    assert.ok(avec.coutEmployeur < sans.coutEmployeur, 'coût employeur réduit');
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

  test('le coût employeur est toujours supérieur au brut', () => {
    for(const brut of [1500, 3000, 8000]){
      const r = C.compute(scn({ brut }));
      assert.ok(r.coutEmployeur > brut);
    }
  });

  test('le net après impôt ne dépasse jamais le net à payer', () => {
    for(const pas of [0, 3, 11, 30, 45]){
      const r = C.compute(scn({ brut: 3000, pasRate: pas }));
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
              const r = C.compute(scn({
                brut, statut, dureeType, joursResto,
                valeurResto: 8, partResto: 50, rate: 22,
                mutuelle: 30, mutuellePat: 45, pasRate: 7.5,
                absenceType, absenceDuree: absenceType === 'none' ? 0 : 12,
                primes: 1500, nbMois: 12
              }));
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
