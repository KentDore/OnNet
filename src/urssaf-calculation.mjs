import { HEURES_BASE } from './ui-utils.mjs';

// Adaptateurs purs entre l'état OnNet et le contrat de l'API Mon-entreprise.

export function buildUrssafCalculationKey(s, f, date){
  const calculationDate = date ?? f;
  return JSON.stringify({
    brut:Number(s.brut),
    dureeType:String(s.dureeType),
    mutuelle:Number(s.mutuelle) || 0,
    mutuellePat:Number(s.mutuellePat) || 0,
    joursResto:Number(s.joursResto) || 0,
    valeurResto:Number(s.valeurResto) || 0,
    partResto:Number(s.partResto) || 0,
    nbMois:Number(s.nbMois || 12),
    primes:Number(s.primes || 0),
    commune:String(s.commune || 'Pacé').trim(),
    codePostal:String(s.codePostal || ''),
    departement:String(s.departement || ''),
    date:calculationDate
  });
}



export function unsupportedCalculationReason(s){
  if(!Number.isFinite(Number(s.brut)) || Number(s.brut) <= 0){
    return 'Le salaire brut doit être strictement supérieur à 0 € pour effectuer une simulation.';
  }
  if(Number(s.nbMois || 12) !== 12){
    return 'Ce scénario utilise un nombre de mensualités différent de 12. Le traitement du 13ᵉ/14ᵉ mois n’est pas encore raccordé à l’API Urssaf.';
  }
  if(Number(s.primes || 0) > 0){
    return 'Ce scénario comporte des primes annuelles libres qui ne sont pas encore raccordées à l’API Urssaf.';
  }
  if(!String(s.codePostal || '').trim() || !String(s.departement || '').trim()){
    return 'Sélectionnez une commune dans les suggestions pour renseigner son code postal et son département avant le calcul.';
  }
  return null;
}

export function buildUrssafInput(s, f, date){
  const calculationDate = date ?? f;
  const reason = unsupportedCalculationReason(s);
  if(reason) throw new Error(reason);
  return {
    brut:Number(s.brut),
    dureeType:String(s.dureeType),
    mutuelle:Number(s.mutuelle) || 0,
    mutuellePat:Number(s.mutuellePat) || 0,
    joursResto:Number(s.joursResto) || 0,
    valeurResto:Number(s.valeurResto) || 0,
    partResto:Number(s.partResto),
    commune:String(s.commune || 'Pacé').trim(),
    codePostal:String(s.codePostal || ''),
    departement:String(s.departement || ''),
    date:calculationDate,
    benchmarkOnly:Boolean(s.isBenchmark)
  };
}

export function mapUrssafResultToOnNet(result){
  if(result.benchmarkOnly){
    return {
      engine:result.engine,
      checkedAt:result.checkedAt,
      missingVariables:result.missingVariables,
      warnings:result.warnings,
      netApres:result.netBeforeTax
    };
  }
  const gross = result.grossCalculated;
  const overtimeHours = result.overtimeHours;
  // Le dénominateur doit refléter exactement la durée contractuelle annualisée : 35 h ou 39 h par semaine.
  const monthlyHours = (overtimeHours > 0 ? 39 : 35) * 52 / 12;
  // Le total des cotisations salarié inclut déjà la part salariale de mutuelle.
  // On isole cette ligne pour conserver la décomposition visuelle sans la compter deux fois.
  const otherEmployeeContributions = Math.max(0, result.employeeContributions - result.employeeHealth);
  const monthly = {
    brutTotal:gross,
    netApres:result.netBeforeTax,
    cotisNettes:otherEmployeeContributions,
    mutuelle:result.employeeHealth,
    netSocial:result.netBeforeTax + result.mealTicketEmployee
  };
  const annual = {
    brutTotal:gross * 12,
    netApres:result.netBeforeTax * 12,
  };
  const tr = {
    totalSalarie:result.mealTicketEmployee,
    totalEmployeur:result.mealTicketEmployer,
    reintegre:result.mealTicketNonDeductible,
    motif:result.mealTicketNonDeductible > 0.005 ? 'api' : null
  };
  return {
    engine:result.engine,
    checkedAt:result.checkedAt,
    missingVariables:result.missingVariables,
    warnings:result.warnings,
    hasHS:overtimeHours > 0,
    heuresSup:overtimeHours,
    brutHS:result.overtimePay,
    tr,
    m:monthly,
    a:annual,
    netApres:monthly.netApres,
    annuelNet:annual.netApres,
    brutHoraire:result.baseGross / HEURES_BASE,
    netHoraire:monthlyHours > 0 ? (monthly.netApres + monthly.mutuelle) / monthlyHours : 0,
    tauxEffectif:gross > 0 ? result.employeeContributions / gross * 100 : 0
  };
}

