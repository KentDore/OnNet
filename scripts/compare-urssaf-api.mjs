import { calculatePublicodes } from '../src/publicodes-adapter.mjs'
import { calculateWithUrssafApi, evaluateUrssafExpression } from '../src/urssaf-api-client.mjs'

// Les scénarios sont exécutés en série, mais le client peut effectuer plusieurs
// requêtes par scénario (notamment pour calibrer les 39 h puis calculer le PAS).
// On espace donc tous les appels pour limiter le risque de HTTP 429 lors d'une
// campagne de diagnostic manuelle. Aucun retry automatique n'est effectué.
const REQUEST_INTERVAL_MS = 350
let lastRequestAt = 0
let requestQueue = Promise.resolve()
function throttledFetch(url, options) {
  const request = requestQueue.then(async () => {
    const delay = Math.max(0, REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt))
    if (delay) await new Promise(resolve => setTimeout(resolve, delay))
    lastRequestAt = Date.now()
    return fetch(url, options)
  })
  requestQueue = request.catch(() => {})
  return request
}

function currentDateInParis() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Paris',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date()).map(part => [part.type, part.value])
  )
  return `${parts.year}-${parts.month}-${parts.day}`
}

const REFERENCE_DATE = currentDateInParis()
const smicReference = await evaluateUrssafExpression('SMIC', { date: REFERENCE_DATE }, { fetchImpl: throttledFetch })
const pmssReference = await evaluateUrssafExpression('plafond sécurité sociale', { date: REFERENCE_DATE }, { fetchImpl: throttledFetch })
if (!Number.isFinite(smicReference.value) || smicReference.value <= 0) throw new Error('La règle SMIC renvoyée par l’API Urssaf est absente ou invalide.')
if (!Number.isFinite(pmssReference.value) || pmssReference.value <= 0) throw new Error('La règle plafond sécurité sociale renvoyée par l’API Urssaf est absente ou invalide.')
const pmssValue = pmssReference.value
const smicValue = smicReference.value
const pmssMinus15 = Number((pmssValue - 15).toFixed(2))
const pmssPlus15 = Number((pmssValue + 15).toFixed(2))
const pmssUnder = Number((pmssValue - 0.01).toFixed(2))
const pmssExact = Number(pmssValue.toFixed(2))
const pmssAbove = Number((pmssValue + 0.01).toFixed(2))
const euroLabel = value => value.toLocaleString('fr-FR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})

const scenarios = [
  { name: '2300 € brut, 39 h, mutuelle 30/30, sans titres', input: { brut: 2300, dureeType: '39', mutuelle: 30, mutuellePat: 30, joursResto: 0, valeurResto: 0, date: REFERENCE_DATE } },
  { name: '2300 € brut, 35 h, mutuelle 30/30, sans titres', input: { brut: 2300, dureeType: '35', mutuelle: 30, mutuellePat: 30, joursResto: 0, valeurResto: 0, date: REFERENCE_DATE } },
  { name: '2300 € brut, 39 h, sans mutuelle ni titres', input: { brut: 2300, dureeType: '39', mutuelle: 0, mutuellePat: 0, joursResto: 0, valeurResto: 0, date: REFERENCE_DATE } },
  { name: '2300 € brut, 39 h, mutuelle 30/30, 21 titres de 8 €', input: { brut: 2300, dureeType: '39', mutuelle: 30, mutuellePat: 30, joursResto: 21, valeurResto: 8, partResto: 50, date: REFERENCE_DATE } },
  { name: '1800 € brut, 35 h, bas de grille', input: { brut: 1800, dureeType: '35', mutuelle: 0, mutuellePat: 0, joursResto: 0, valeurResto: 0, date: REFERENCE_DATE } },
  { name: '1900 € brut, 35 h, proche du SMIC mensuel de référence', input: { brut: 1900, dureeType: '35', mutuelle: 0, mutuellePat: 0, joursResto: 0, valeurResto: 0, date: REFERENCE_DATE } },
  { name: `${euroLabel(pmssMinus15)} € brut, 35 h, sous le PMSS officiel`, input: { brut: pmssMinus15, dureeType: '35', mutuelle: 0, mutuellePat: 0, joursResto: 0, valeurResto: 0, date: REFERENCE_DATE } },
  { name: `${euroLabel(pmssPlus15)} € brut, 35 h, au-dessus du PMSS officiel`, input: { brut: pmssPlus15, dureeType: '35', mutuelle: 0, mutuellePat: 0, joursResto: 0, valeurResto: 0, date: REFERENCE_DATE } },
  { name: '8000 € brut, 35 h, tranche 2 retraite complémentaire', input: { brut: 8000, dureeType: '35', mutuelle: 0, mutuellePat: 0, joursResto: 0, valeurResto: 0, date: REFERENCE_DATE } },
  { name: '500 € brut, 35 h, très faible salaire positif', input: { brut: 500, dureeType: '35', mutuelle: 0, mutuellePat: 0, joursResto: 0, valeurResto: 0, date: REFERENCE_DATE } },
  { name: '1000 € brut, 35 h, salaire faible positif', input: { brut: 1000, dureeType: '35', mutuelle: 0, mutuellePat: 0, joursResto: 0, valeurResto: 0, date: REFERENCE_DATE } },
  { name: `${euroLabel(smicValue)} € brut, SMIC officiel, 35 h`, input: { brut: smicValue, dureeType: '35', mutuelle: 0, mutuellePat: 0, joursResto: 0, valeurResto: 0, date: REFERENCE_DATE } },
  { name: `${euroLabel(pmssUnder)} € brut, juste sous le PMSS officiel`, input: { brut: pmssUnder, dureeType: '35', mutuelle: 0, mutuellePat: 0, joursResto: 0, valeurResto: 0, date: REFERENCE_DATE } },
  { name: `${euroLabel(pmssExact)} € brut, exactement au PMSS officiel`, input: { brut: pmssExact, dureeType: '35', mutuelle: 0, mutuellePat: 0, joursResto: 0, valeurResto: 0, date: REFERENCE_DATE } },
  { name: `${euroLabel(pmssAbove)} € brut, juste au-dessus du PMSS officiel`, input: { brut: pmssAbove, dureeType: '35', mutuelle: 0, mutuellePat: 0, joursResto: 0, valeurResto: 0, date: REFERENCE_DATE } },
  { name: '20000 € brut, salaire élevé', input: { brut: 20000, dureeType: '35', mutuelle: 0, mutuellePat: 0, joursResto: 0, valeurResto: 0, date: REFERENCE_DATE } },
  { name: '100000 € brut, salaire très élevé', input: { brut: 100000, dureeType: '35', mutuelle: 0, mutuellePat: 0, joursResto: 0, valeurResto: 0, date: REFERENCE_DATE } }
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
const diagnosticErrors = []

function shouldStopDiagnostic(error) {
  return /HTTP 429|HTTP 5\\d\\d|Impossible de joindre l’API Urssaf|Délai dépassé/i.test(error?.message || '')
}

for (const scenario of scenarios) {
  console.error(`[social] ${scenario.name}`)
  const entry = { scenario: scenario.name, comparisons: [] }
  let remote

  try {
    remote = await calculateWithUrssafApi(scenario.input, { fetchImpl: throttledFetch })
    entry.api = Object.fromEntries(comparisons.map(([label, key]) => [label, Number.isFinite(remote[key]) ? round(remote[key]) : null]))
    entry.missingVariables = remote.missingVariables
    entry.warnings = remote.warnings
  } catch (error) {
    entry.apiError = error.message
    diagnosticErrors.push({ scenario: scenario.name, source: 'API', error: error.message })
    results.push(entry)
    if (shouldStopDiagnostic(error)) throw error
    continue
  }

  try {
    const local = calculatePublicodes(scenario.input)
    entry.comparisons = comparisons.map(([label, key]) => {
      const localValue = local[key]
      const urssafValue = remote[key]
      if (!Number.isFinite(localValue) || !Number.isFinite(urssafValue)) {
        throw new Error(`Valeur locale ou API absente pour ${label}.`)
      }
      return {
        name: label,
        local: round(localValue),
        urssaf: round(urssafValue),
        difference: Number((localValue - urssafValue).toFixed(4))
      }
    })
  } catch (error) {
    entry.localError = error.message
    diagnosticErrors.push({ scenario: scenario.name, source: 'modèle npm local', error: error.message })
  }

  results.push(entry)
}

const fiscalScenarios = [
  { name: 'taux personnalisé 10 %', input: { brut: 2300, dureeType: '35', date: REFERENCE_DATE, modeImpot: 'personnalisé', tauxPAS: 10 } },
  { name: 'taux neutre', input: { brut: 2300, dureeType: '35', date: REFERENCE_DATE, modeImpot: 'neutre' } },
  { name: 'barème standard, célibataire sans enfant', input: { brut: 2300, dureeType: '35', date: REFERENCE_DATE, modeImpot: 'barème', situationFamille: 'célibataire', enfantsACharge: 0 } },
  { name: 'barème standard, couple avec 24 000 € autres revenus imposables', input: { brut: 2300, dureeType: '35', date: REFERENCE_DATE, modeImpot: 'barème', situationFamille: 'couple', enfantsACharge: 0, autresRevenusImposables: 24000 } }
]

const fiscalResults = []
for (const scenario of fiscalScenarios) {
  console.error(`[fiscal] ${scenario.name}`)
  try {
    const result = await calculateWithUrssafApi(scenario.input, { fetchImpl: throttledFetch })
    for (const [name, value] of [
      ['net après impôt', result.netAfterTax],
      ['impôt', result.incomeTax],
      ['taux appliqué', result.calculatedTaxRate]
    ]) {
      if (!Number.isFinite(value)) {
        throw new Error(`Résultat fiscal API absent ou non numérique (${name}).`)
      }
    }
    if (result.incomeTax <= 0 || result.netAfterTax >= result.netBeforeTax) {
      throw new Error(`Le scénario fiscal ne produit aucun prélèvement positif : ${JSON.stringify({
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
  } catch (error) {
    fiscalResults.push({ scenario: scenario.name, error: error.message })
    diagnosticErrors.push({ scenario: scenario.name, source: 'fiscalité API', error: error.message })
    if (shouldStopDiagnostic(error)) throw error
  }
}

console.log(JSON.stringify({ references: { date: REFERENCE_DATE, smic: { value: smicValue, missingVariables: smicReference.missingVariables, warnings: smicReference.warnings }, pmss: { value: pmssValue, missingVariables: pmssReference.missingVariables, warnings: pmssReference.warnings } }, social: results, fiscal: fiscalResults }, null, 2))

const mismatches = results.flatMap(result =>
  result.comparisons
    .filter(item => Math.abs(item.difference) > 0.03)
    .map(item => ({ scenario: result.scenario, ...item }))
)
if (mismatches.length || diagnosticErrors.length) {
  throw new Error(`Diagnostic incomplet ou écarts détectés : ${JSON.stringify({
    mismatches,
    errors: diagnosticErrors
  })}`)
}
