"use strict";

import { scenarioDefaults } from './ui-utils.mjs';

// Métriques de la section « D'autres chiffres utiles ». Le net mensuel n'y
// figure pas : c'est déjà ce que montre le graphique juste au-dessus.
// Une métrique inconnue (état sauvegardé ou lien partagé antérieur, par exemple
// l'ancien « Coût employeur » ou l'ancien « Net ») retombe sur METRIC_DEFAUT.
export const METRIC_KEYS = ['annuelNet','netHoraire','brutHoraire'];
export const METRIC_DEFAUT = 'netHoraire';

export function sanitizeScenario(raw){
  if(!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const clean = Object.assign({}, raw);
  const limits = {
    brut:[0,1000000], mutuelle:[0,100000], mutuellePat:[0,100000], joursResto:[0,31],
    valeurResto:[0,500], partResto:[0,100], nbMois:[1,24],
    primes:[0,100000000], salaireSaisi:[0,1200000]
  };
  for(const [key, range] of Object.entries(limits)){
    if(clean[key] === undefined) continue;
    const n = Number(clean[key]);
    if(!Number.isFinite(n) || n < range[0] || n > range[1]) return null;
    clean[key] = n;
  }
  if(clean.brut === undefined || !Number.isFinite(Number(clean.brut)) || Number(clean.brut) < 0) return null;
  if(clean.salaireSaisi !== undefined || clean.salaireSaisiPeriode !== undefined){
    const enteredAmount = Number(clean.salaireSaisi);
    if(!Number.isFinite(enteredAmount) || enteredAmount <= 0 || !['mois','an'].includes(clean.salaireSaisiPeriode)){
      delete clean.salaireSaisi;
      delete clean.salaireSaisiPeriode;
    } else {
      clean.salaireSaisi = enteredAmount;
    }
  }
  // Compatibilité avec les états antérieurs : l'ancien modèle supposait une
  // part employeur égale à la part salarié.
  if(clean.mutuellePat === undefined){
    clean.mutuellePat = clean.mutuelle === undefined ? scenarioDefaults.mutuelle : clean.mutuelle;
  }
  clean.commune = typeof clean.commune === 'string' && clean.commune.trim()
    ? clean.commune.trim().replace(/\s+/g, ' ').slice(0, 80)
    : 'Pacé';
  if(clean.commune === 'Pacé' && !clean.codePostal && !clean.departement){
    clean.codePostal = '35740';
    clean.departement = 'Ille-et-Vilaine';
  }
  clean.codePostal = typeof clean.codePostal === 'string' && /^\d{5}$/.test(clean.codePostal) ? clean.codePostal : '';
  clean.departement = typeof clean.departement === 'string' ? clean.departement.trim().slice(0, 80) : '';
  if(!['base','ensemble'].includes(clean.treiziemeMoisBase)) clean.treiziemeMoisBase = 'base';
  if(typeof clean.name !== 'string' || !clean.name.trim()) clean.name = 'Salaire';
  clean.name = clean.name.trim().slice(0, 80);
  delete clean.statut;
  delete clean.rate;
  if(clean.dureeType !== '35' && clean.dureeType !== '39') clean.dureeType = '35';
  // Les scénarios d'absence historiques sont supprimés et ne sont plus calculés.
  delete clean.absenceType;
  delete clean.absenceDuree;
  delete clean.maintienPct;
  delete clean.carenceCouverte;
  if(!Number.isSafeInteger(clean.id) || clean.id < 0) delete clean.id;
  return clean;
}



export function normalizeScenarioIds(scenarios, refId, openCardIds){
  // Les identifiants restaurés ne sont jamais conservés : une suite compacte
  // évite les dépassements de précision et garantit un prochain id exploitable.
  const oldToIndex = new Map();
  const normalized = scenarios.map((scenario, index) => {
    if(Number.isSafeInteger(scenario.id) && scenario.id >= 0 && !oldToIndex.has(scenario.id)){
      oldToIndex.set(scenario.id, index);
    }
    return Object.assign({}, scenario, { id: index });
  });
  const refIndex = Number.isSafeInteger(refId) ? oldToIndex.get(refId) : undefined;
  const normalizedRefId = refIndex === undefined
    ? (normalized.length ? normalized[0].id : null)
    : normalized[refIndex].id;
  const normalizedOpenCardIds = Array.isArray(openCardIds)
    ? [...new Set(openCardIds
        .filter(id => Number.isSafeInteger(id) && oldToIndex.has(id))
        .map(id => normalized[oldToIndex.get(id)].id))]
    : [];
  return { scenarios: normalized, refId: normalizedRefId, openCardIds: normalizedOpenCardIds };
}
