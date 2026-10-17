
"use strict";

// ---------- Paramètres légaux (valeurs 2026, à revoir chaque année) ----------
/* ONNET_CALC_START — bloc auto-suffisant, extrait et testé par test/calc.test.js */
const P = {
  // PMSS 2026 : 4 005 € (PASS 48 060 €). Plafond d'exonération par titre restaurant : 7,32 €.
  pmss: 4005, plafondTR: 7.32,
  // CSG 9,20 % (6,80 déductible + 2,40 non déductible) et CRDS 0,50 %,
  // sur 98,25 % du brut dans la limite de 4 PASS, sans abattement au-delà.
  csgDed: 6.80, csgNonDed: 2.40, crds: 0.50,
  vieillessePlaf: 6.90, vieillesseDeplaf: 0.40,
  rcT1: 3.15, cegT1: 0.86, rcT2: 8.64, cegT2: 1.08, cet: 0.14,
  majoration: 25, reducHS: 11.31,
  // Exonération d'impôt sur le revenu des heures supplémentaires :
  // 7 500 € de net imposable par an et par salarié.
  plafondExoIR: 7500,
  // Impôt sur le revenu 2026. Les tranches sont exprimées par part de quotient
  // familial : [plafond de la tranche, taux].
  ir: {
    tranches: [[11600, 0], [29579, 0.11], [84577, 0.30], [181917, 0.41], [Infinity, 0.45]],
    // Abattement forfaitaire de 10 % pour frais professionnels, encadré.
    abattementPct: 10, abattementMin: 495, abattementMax: 14171,
    // Plafonnement des effets du quotient familial, par demi-part additionnelle.
    plafondDemiPart: 1807,
    // Décote sur les impôts modestes : base − taux × impôt brut, sous le seuil.
    decote: { seuilSeul: 1982, seuilCouple: 3277,
              baseSeul: 897, baseCouple: 1483, taux: 45.25 }
  }
};

let scenarioDefaults = {
  mutuelle: 30, joursResto: 21, valeurResto: 8,
  partResto: 50, nbMois: 12
};

const ICON = {
  info: '<svg aria-hidden="true" class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>',
  warn: '<svg aria-hidden="true" class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
  plus: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>'
};

const HEURES_BASE = 151.67;

// ---------- Fonctions utilitaires ----------
function parseNum(v){
  if(v === null || v === undefined) return 0;
  const s = String(v).replace(/\s/g,'').replace(',', '.');
  // Refuse les suffixes et formats partiels : parseFloat("3000abc") renvoie
  // 3000, ce qui peut transformer une saisie invalide en salaire plausible.
  if(!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
function clamp(n, min, max){
  if(typeof min === 'number' && n < min) return min;
  if(typeof max === 'number' && n > max) return max;
  return n;
}
function fmt(n){ return Math.round(n).toLocaleString('fr-FR') + ' €'; }
function fmtHoraire(n){ return n.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2}) + ' €/h'; }
function fmtHoraireSigned(n){
  const s = Math.abs(n).toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2});
  return (n > 0 ? '+' : (n < 0 ? '−' : '')) + s + ' €/h';
}
function fmtSigned(n){
  const s = Math.round(Math.abs(n)).toLocaleString('fr-FR');
  return (n > 0 ? '+' : (n < 0 ? '−' : '')) + s + ' €';
}
function esc(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ---------- Moteur de calcul des cotisations ----------
// Cotisations salariales non-cadre. Seul statut modélisé — voir le disclaimer
// et le README pour la justification (cadre/fonction publique/taux forfaitaire
// retirés pour ne pas disperser la précision du moteur sur plusieurs régimes
// approximés séparément).
function cotisations(assiette, plafond){
  const l = { csgDed:0, csgNonDed:0, crds:0, vieillessePlaf:0, vieillesseDeplaf:0,
              rcT1:0, cegT1:0, rcT2:0, cegT2:0, cet:0,
              retraite:0, total:0, deductible:0, nonDeductible:0 };
  if(assiette <= 0) return l;

  const T1 = Math.min(assiette, plafond);
  const T2 = Math.max(0, Math.min(assiette, 8*plafond) - plafond);
  const baseCSG = Math.min(assiette, 4*plafond) * 0.9825 + Math.max(0, assiette - 4*plafond);

  l.csgDed = baseCSG * P.csgDed/100;
  l.csgNonDed = baseCSG * P.csgNonDed/100;
  l.crds = baseCSG * P.crds/100;
  l.vieillessePlaf = T1 * P.vieillessePlaf/100;
  l.vieillesseDeplaf = assiette * P.vieillesseDeplaf/100;
  l.rcT1 = T1 * P.rcT1/100;
  l.cegT1 = T1 * P.cegT1/100;
  l.rcT2 = T2 * P.rcT2/100;
  l.cegT2 = T2 * P.cegT2/100;
  l.cet = assiette > plafond ? Math.min(assiette, 8*plafond) * P.cet/100 : 0;

  l.retraite = l.vieillessePlaf + l.vieillesseDeplaf + l.rcT1 + l.cegT1 + l.rcT2 + l.cegT2 + l.cet;
  l.total = l.retraite + l.csgDed + l.csgNonDed + l.crds;
  l.nonDeductible = l.csgNonDed + l.crds;
  l.deductible = l.retraite + l.csgDed;
  return l;
}

function titresResto(jours, valeur, partSalariePct){
  const partEmployeurPct = 100 - partSalariePct;
  const parTitreEmployeur = valeur * partEmployeurPct/100;
  const totalEmployeur = jours * parTitreEmployeur;
  const totalSalarie = jours * valeur * partSalariePct/100;

  let reintegre = 0, motif = null;
  if(partEmployeurPct < 50){
    reintegre = totalEmployeur;
    motif = 'sous50';
  } else {
    let exces = 0;
    if(partEmployeurPct > 60){
      exces = Math.max(exces, jours * valeur * (partEmployeurPct - 60)/100);
      motif = 'sur60';
    }
    if(parTitreEmployeur > P.plafondTR){
      const excesPlafond = jours * (parTitreEmployeur - P.plafondTR);
      if(excesPlafond > exces){ exces = excesPlafond; motif = 'plafond'; }
    }
    reintegre = exces;
  }
  return { partEmployeurPct, parTitreEmployeur, totalEmployeur, totalSalarie, reintegre, motif };
}

// ---------- Impôt sur le revenu ----------

// Barème progressif appliqué à un revenu ramené à UNE part de quotient familial.
function baremeIR(revenuParPart){
  if(revenuParPart <= 0) return 0;
  let impot = 0, bas = 0;
  for(const [haut, taux] of P.ir.tranches){
    if(revenuParPart > bas) impot += (Math.min(revenuParPart, haut) - bas) * taux;
    bas = haut;
  }
  return impot;
}

// Abattement de 10 % pour frais professionnels : plancher et plafond légaux,
// le plancher ne pouvant évidemment pas dépasser le revenu lui-même.
function abattementFraisPro(salaireAnnuel){
  if(salaireAnnuel <= 0) return 0;
  const brut = salaireAnnuel * P.ir.abattementPct/100;
  const plancher = Math.min(P.ir.abattementMin, salaireAnnuel);
  return Math.min(Math.max(brut, plancher), P.ir.abattementMax);
}

// Parts de quotient familial : 1 (ou 2 en couple), une demi-part pour chacune
// des deux premières personnes à charge, une part entière à partir de la troisième.
function partsFiscales(couple, personnesCharge){
  const n = Math.max(0, Math.floor(personnesCharge || 0));
  return (couple ? 2 : 1) + Math.min(n, 2) * 0.5 + Math.max(0, n - 2);
}

// Impôt d'un foyer, à partir de son revenu imposable global (déjà abattu).
function impotFoyer(revenuImposable, couple, personnesCharge){
  if(revenuImposable <= 0) return 0;
  const parts = partsFiscales(couple, personnesCharge);
  const partsBase = couple ? 2 : 1;
  let impot = baremeIR(revenuImposable / parts) * parts;

  // Plafonnement des effets du quotient familial : l'avantage tiré des
  // demi-parts au-delà du foyer de base est limité.
  if(parts > partsBase){
    const sansCharges = baremeIR(revenuImposable / partsBase) * partsBase;
    const plafond = P.ir.plafondDemiPart * (parts - partsBase) * 2;
    if(sansCharges - impot > plafond) impot = sansCharges - plafond;
  }

  // Décote : atténue l'impôt des foyers modestes, jusqu'à l'annuler.
  const d = P.ir.decote;
  if(impot < (couple ? d.seuilCouple : d.seuilSeul)){
    const decote = (couple ? d.baseCouple : d.baseSeul) - impot * d.taux/100;
    impot -= Math.max(0, decote);
  }
  return Math.max(0, impot);
}

function splitHeures(s){
  const heuresSemaine = s.dureeType === '39' ? 39 : 35;
  const heuresSup = Math.max(0, heuresSemaine - 35) * 52 / 12;
  const totalEquiv = HEURES_BASE + heuresSup * (1 + P.majoration/100);
  const tauxHoraire = totalEquiv > 0 ? s.brut / totalEquiv : 0;
  const brutBase = tauxHoraire * HEURES_BASE;
  return { heuresSup, brutBase, brutHS: Math.max(0, s.brut - brutBase), tauxHoraire };
}

function periode(brutBase, brutHS, s, plafond, mutSal, mutPat, tr, plafondExoHS){
  // Pas de rémunération = pas de bulletin de paie : ni cotisations, ni retenue
  // mutuelle, ni titres restaurant. Sans ce garde-fou, un brut à 0 afficherait
  // un net négatif égal aux seules retenues.
  if(brutBase + brutHS <= 0){
    return { c: cotisations(0, plafond), assiette: 0, reducHS: 0,
             cotisNettes: 0, brutTotal: 0, netApres: 0, netSocial: 0,
             netImposable: 0, netImposableAvantExo: 0, exoHS: 0,
             pouvoirAchat: 0 };
  }

  const assiette = brutBase + brutHS + tr.reintegre;
  const c = cotisations(assiette, plafond);

  const tauxMoyenRetraite = assiette > 0 ? (c.retraite / assiette) * 100 : 0;
  const tauxReduc = Math.min(P.reducHS, tauxMoyenRetraite);
  const reducHS = brutHS * tauxReduc/100;

  const cotisNettes = Math.max(0, c.total - reducHS);
  const brutTotal = brutBase + brutHS;

  const netApres = brutTotal - cotisNettes - mutSal - tr.totalSalarie;
  const netSocial = brutTotal - cotisNettes - mutSal;

  const deductibleNet = Math.max(0, c.deductible - reducHS);
  const netImposableAvantExo = Math.max(0, brutTotal + tr.reintegre - deductibleNet - mutSal + mutPat);

  // Heures supplémentaires : exonérées d'impôt sur le revenu dans la limite d'un
  // plafond annuel de net imposable. La part de net imposable qui leur est
  // attribuable est estimée au prorata du brut — approximation assumée, les
  // cotisations déductibles n'étant pas ventilables exactement entre heures
  // normales et heures supplémentaires (tranches, plafonds, réduction salariale).
  const partImposableHS = brutTotal > 0 ? brutHS * (1 - deductibleNet / brutTotal) : 0;
  const exoHS = Math.min(Math.max(0, partImposableHS), Math.max(0, plafondExoHS || 0));
  const netImposable = Math.max(0, netImposableAvantExo - exoHS);

  const pouvoirAchat = netApres + tr.totalEmployeur;

  return { c, assiette, reducHS, cotisNettes, brutTotal, netApres, netSocial,
           netImposable, netImposableAvantExo, exoHS, pouvoirAchat };
}

// Le foyer fiscal ({ couple, personnesCharge, autresRevenus }) est global : il
// décrit la personne, pas le salaire. Deux offres comparées ne changent pas le
// nombre de parts ni les revenus du conjoint.
function compute(s, foyer){
  const f = foyer || {};
  const hasHS = s.dureeType === '39';
  const split = hasHS ? splitHeures(s) : { heuresSup:0, brutBase:s.brut, brutHS:0, tauxHoraire: s.brut / HEURES_BASE };
  const tr = titresResto(s.joursResto, s.valeurResto, s.partResto);

  // Part patronale de mutuelle : réintégrée dans le net imposable. Faute d'un
  // champ dédié, on retient le partage 50/50 — le minimum légal — plutôt qu'un
  // forfait figé, qui gonflait l'imposable même sans mutuelle déclarée.
  const mutuellePat = Math.max(0, s.mutuelle || 0);
  const m = periode(split.brutBase, split.brutHS, s, P.pmss, s.mutuelle, mutuellePat, tr, P.plafondExoIR/12);

  // Salaire horaire : taux de base (hors majoration heures sup) et net rapporté
  // aux heures réellement travaillées dans le mois. Calculé avant tout ajustement
  // d'absence, pour rester le taux "normal" du contrat.
  const heuresReelles = HEURES_BASE + split.heuresSup;
  const brutHoraire = split.tauxHoraire;
  const netHoraire = heuresReelles > 0 ? m.netApres / heuresReelles : 0;

  const nbMois = s.nbMois || 12;
  const trAnnuel = titresResto(s.joursResto * 12, s.valeurResto, s.partResto);
  const aBase = split.brutBase * nbMois + (s.primes || 0);
  const aHS = split.brutHS * 12;
  const a = periode(aBase, aHS, s, P.pmss * 12, s.mutuelle * 12, mutuellePat * 12, trAnnuel, P.plafondExoIR);

  // Absence (congés payés / arrêt de travail) : mélange une portion travaillée
  // normalement et une portion d'absence, sur un mois de référence de 30 jours.
  // Estimation simplifiée — voir le disclaimer du panneau, pas un vrai calcul d'IJSS.
  if(s.absenceType === 'conges' || s.absenceType === 'arret'){
    const duree = Math.max(0, Math.min(30, s.absenceDuree || 0));
    const netSansTR = m.netApres + tr.totalSalarie; // on retire la déduction des titres restaurant
    const netTravaille = ((30 - duree) / 30) * m.netApres;

    let netAbsence, joursPayes;
    if(s.absenceType === 'conges'){
      netAbsence = (duree / 30) * netSansTR; // salaire de base maintenu, sans titres restaurant
      joursPayes = duree;                    // intégralement rémunérés
    } else {
      const joursCarence = s.carenceCouverte ? 0 : Math.min(3, duree);
      const joursIndemnises = Math.max(0, duree - joursCarence);
      const pct = (s.maintienPct || 0) / 100;
      netAbsence = (joursIndemnises / 30) * netSansTR * pct;
      joursPayes = joursIndemnises * pct;    // équivalent en jours pleins
    }

    const perteNet = m.netApres - (netTravaille + netAbsence);
    // L'assiette imposable ne suit que la rémunération réellement versée : les
    // titres restaurant n'en font pas partie, ne pas consommer les siens pendant
    // des congés augmente le net encaissé sans toucher à l'imposable.
    const ratioSalaire = ((30 - duree) + joursPayes) / 30;
    const imposableAvant = m.netImposable;

    m.netApres -= perteNet;
    m.netImposable = imposableAvant * ratioSalaire;
    // L'absence porte sur UN mois : l'annuel ne perd que ce mois-là. Le mettre
    // à l'échelle du même ratio reviendrait à répéter l'absence douze fois.
    a.netApres = Math.max(0, a.netApres - perteNet);
    a.netImposable = Math.max(0, a.netImposable - (imposableAvant - m.netImposable));
  }

  // Impôt sur le revenu. Deux modes :
  // - 'taux' : le taux de prélèvement à la source réel, saisi par l'utilisateur,
  //   s'applique tel quel au net imposable annuel — exact pour SA situation
  //   actuelle, mais un taux constant ne rend pas compte de la progressivité :
  //   comparé à un autre salaire, l'écart affiché est optimiste.
  // - 'bareme' (par défaut) : l'impôt imputé à CE salaire est l'écart entre
  //   l'impôt du foyer avec et sans lui — ce que le salaire coûte réellement en
  //   impôt, à la différence d'un taux moyen qui sous-estimerait toujours
  //   l'effet d'une augmentation (le taux réel monte avec le revenu).
  let impotAnnuel, tauxImpot;
  if(f.mode === 'taux'){
    tauxImpot = clamp(f.pasRate || 0, 0, 100);
    impotAnnuel = Math.max(0, a.netImposable) * tauxImpot/100;
  } else {
    const couple = !!f.couple;
    const charges = Math.max(0, f.personnesCharge || 0);
    const autresRevenus = couple ? Math.max(0, f.autresRevenus || 0) : 0;
    const baseAutres = autresRevenus - abattementFraisPro(autresRevenus);
    const baseSalaire = Math.max(0, a.netImposable) - abattementFraisPro(Math.max(0, a.netImposable));
    impotAnnuel = Math.max(0,
      impotFoyer(baseAutres + baseSalaire, couple, charges) - impotFoyer(baseAutres, couple, charges));
    tauxImpot = a.netImposable > 0 ? impotAnnuel / a.netImposable * 100 : 0;
  }
  const netApresImpot = Math.max(0, m.netApres - impotAnnuel/12);
  const annuelNetApresImpot = Math.max(0, a.netApres - impotAnnuel);

  return {
    hasHS, heuresSup: split.heuresSup, brutHS: split.brutHS,
    tr, m, a,
    netApres: m.netApres, netImposable: m.netImposable,
    annuelNet: a.netApres,
    netApresImpot, annuelNetApresImpot, impotAnnuel, tauxImpot,
    brutHoraire, netHoraire,
    tauxEffectif: s.brut > 0 ? (m.cotisNettes / s.brut) * 100 : 0
  };
}
/* ONNET_CALC_END */