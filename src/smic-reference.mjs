import { HEURES_BASE } from './ui-utils.mjs';

export function getSmicGrossTarget(baseGross, weeklyHours){
  const overtimeHours = Number(weeklyHours) === 39 ? 4 * 52 / 12 : 0;
  if(!overtimeHours) return baseGross;
  // En 39 h : SMIC de base 35 h + 4 heures supplémentaires hebdomadaires à +25 %.
  return Math.round(baseGross * (1 + overtimeHours * 1.25 / HEURES_BASE) * 100) / 100;
}

export function buildSmicScenario(base, amount){
  if(!Number.isFinite(amount) || amount <= 0) return null;
  const weeklyHours = Number(base.dureeType) === 39 ? 39 : 35;
  return Object.assign({}, base, {
    id:-1,
    name:'Référence SMIC',
    brut:getSmicGrossTarget(amount, weeklyHours),
    dureeType:String(weeklyHours),
    mutuelle:0,
    mutuellePat:0,
    joursResto:0,
    valeurResto:0,
    partResto:0,
    nbMois:12,
    primes:0,
    isBenchmark:true
  });
}
