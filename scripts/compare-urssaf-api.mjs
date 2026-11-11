import { calculatePublicodes } from '../src/publicodes-adapter.mjs'
import { calculateWithUrssafApi } from '../src/urssaf-api-client.mjs'

const scenarios = [
  { name: '2300 € brut, 39 h, mutuelle 30/30, sans titres', input: { brut: 2300, dureeType: '39', mutuelle: 30, mutuellePat: 30, joursResto: 0, valeurResto: 0, date: '2026-11-11' } },
  { name: '2300 € brut, 35 h, mutuelle 30/30, sans titres', input: { brut: 2300, dureeType: '35', mutuelle: 30, mutuellePat: 30, joursResto: 0, valeurResto: 0, date: '2026-11-11' } },
  { name: '2300 € brut, 39 h, sans mutuelle ni titres', input: { brut: 2300, dureeType: '39', mutuelle: 0, mutuellePat: 0, joursResto: 0, valeurResto: 0, date: '2026-11-11' } },
  { name: '2300 € brut, 39 h, mutuelle 30/30, 21 titres de 8 €', input: { brut: 2300, dureeType: '39', mutuelle: 30, mutuellePat: 30, joursResto: 21, valeurResto: 8, partResto: 50, date: '2026-11-11' } },
  { name: '1800 € brut, 35 h, bas de grille', input: { brut: 1800, dureeType: '35', mutuelle: 0, mutuellePat: 0, joursResto: 0, valeurResto: 0, date: '2026-11-11' } },
  { name: '1900 € brut, 35 h, proche du SMIC mensuel de référence', input: { brut: 1900, dureeType: '35', mutuelle: 0, mutuellePat: 0, joursResto: 0, valeurResto: 0, date: '2026-11-11' } },
  { name: '3990 € brut, 35 h, juste sous le PMSS 2026', input: { brut: 3990, dureeType: '35', mutuelle: 0, mutuellePat: 0, joursResto: 0, valeurResto: 0, date: '2026-11-11' } },
  { name: '4020 € brut, 35 h, juste au-dessus du PMSS 2026', input: { brut: 4020, dureeType: '35', mutuelle: 0, mutuellePat: 0, joursResto: 0, valeurResto: 0, date: '2026-11-11' } },
  { name: '8000 € brut, 35 h, tranche 2 retraite complémentaire', input: { brut: 8000, dureeType: '35', mutuelle: 0, mutuellePat: 0, joursResto: 0, valeurResto: 0, date: '2026-11-11' } },
  { name: '500 € brut, 35 h, très faible salaire positif', input: { brut: 500, dureeType: '35', mutuelle: 0, mutuellePat: 0, joursResto: 0, valeurResto: 0, date: '2026-11-11' } },
  { name: '1000 € brut, 35 h, salaire faible positif', input: { brut: 1000, dureeType: '35', mutuelle: 0, mutuellePat: 0, joursResto: 0, valeurResto: 0, date: '2026-11-11' } },
  { name: 'SMIC mensuel 2026, 35 h', input: { brut: 1867.02, dureeType: '35', mutuelle: 0, mutuellePat: 0, joursResto: 0, valeurResto: 0, date: '2026-11-11' } },
  { name: '4004,99 € brut, juste sous le PMSS 2026', input: { brut: 4004.99, dureeType: '35', mutuelle: 0, mutuellePat: 0, joursResto: 0, valeurResto: 0, date: '2026-11-11' } },
  { name: '4005 € brut, exactement au PMSS 2026', input: { brut: 4005, dureeType: '35', mutuelle: 0, mutuellePat: 0, joursResto: 0, valeurResto: 0, date: '2026-11-11' } },
  { name: '4005,01 € brut, juste au-dessus du PMSS 2026', input: { brut: 4005.01, dureeType: '35', mutuelle: 0, mutuellePat: 0, joursResto: 0, valeurResto: 0, date: '2026-11-11' } },
  { name: '20000 € brut, salaire élevé', input: { brut: 20000, dureeType: '35', mutuelle: 0, mutuellePat: 0, joursResto: 0, valeurResto: 0, date: '2026-11-11' } },
  { name: '100000 € brut, salaire très élevé', input: { brut: 100000, dureeType: '35', mutuelle: 0, mutuellePat: 0, joursResto: 0, valeurResto: 0, date: '2026-11-11' } }
]

const comparisons = [
  ['brut', 'grossCalculated'],
  ['net avant impôt', 'netBeforeTax'],
  ['net imposable', 'taxableNet'],
  ['cotisations salariales', 'employeeContributions'],
  ['heures supplémentaires', 'overtimePay'],
  ['mutuelle salariale', 'employeeHealth'],
  ['mutuelle patronale', 'employerHealth']
]

const round = value => Number(value.toFixed(2))
const results = []

for (const scenario of scenarios) {
  const local = calculatePublicodes(scenario.input)
  const remote = await calculateWithUrssafApi(scenario.input)
  const values = comparisons.map(([label, key]) => {
    const localValue = local[key]
    const urssafValue = remote[key]
    if (!Number.isFinite(urssafValue)) {
      throw new Error(`Valeur API absente ou non numérique pour ${label} dans « ${scenario.name} ».`)
    }
    return {
      name: label,
      local: round(localValue),
      urssaf: round(urssafValue),
      difference: Number((localValue - urssafValue).toFixed(4))
    }
  })

  results.push({
    scenario: scenario.name,
    comparisons: values,
    missingVariables: remote.missingVariables,
    warnings: remote.warnings
  })
}

const fiscalScenarios = [
  { name: 'taux personnalisé 10 %', input: { brut: 2300, dureeType: '35', date: '2026-11-11', modeImpot: 'personnalisé', tauxPAS: 10 } },
  { name: 'taux neutre', input: { brut: 2300, dureeType: '35', date: '2026-11-11', modeImpot: 'neutre' } },
  { name: 'barème standard, célibataire sans enfant', input: { brut: 2300, dureeType: '35', date: '2026-11-11', modeImpot: 'barème', situationFamille: 'célibataire', enfantsACharge: 0 } },
  { name: 'barème standard, couple avec 24 000 € autres revenus imposables', input: { brut: 2300, dureeType: '35', date: '2026-11-11', modeImpot: 'barème', situationFamille: 'couple', enfantsACharge: 0, autresRevenusImposables: 24000 } }
]

const fiscalResults = []
for (const scenario of fiscalScenarios) {
  const result = await calculateWithUrssafApi(scenario.input)
  for (const [name, value] of [
    ['net après impôt', result.netAfterTax],
    ['impôt', result.incomeTax],
    ['taux appliqué', result.calculatedTaxRate]
  ]) {
    if (!Number.isFinite(value)) {
      throw new Error(`Résultat fiscal API absent ou non numérique (${name}) pour ${scenario.name}.`)
    }
  }
  if (result.incomeTax <= 0 || result.netAfterTax >= result.netBeforeTax) {
    throw new Error(`Le scénario fiscal « ${scenario.name} » ne produit aucun prélèvement positif : ${JSON.stringify({
      netBeforeTax: result.netBeforeTax,
      netAfterTax: result.netAfterTax,
      incomeTax: result.incomeTax,
      calculatedTaxRate: result.calculatedTaxRate,
      missingVariables: result.missingVariables
    })}`)
  }
  fiscalResults.push({
    scenario: scenario.name,
    netAfterTax: round(result.netAfterTax),
    incomeTax: round(result.incomeTax),
    calculatedTaxRate: round(result.calculatedTaxRate),
    missingVariables: result.missingVariables,
    warnings: result.warnings
  })
}

console.log(JSON.stringify({ social: results, fiscal: fiscalResults }, null, 2))

const mismatches = results.flatMap(result =>
  result.comparisons
    .filter(item => Math.abs(item.difference) > 0.03)
    .map(item => ({ scenario: result.scenario, ...item }))
)
if (mismatches.length) {
  throw new Error(`Écart supérieur à 3 centimes entre le modèle npm local et l'API officielle : ${JSON.stringify(mismatches)}`)
}
