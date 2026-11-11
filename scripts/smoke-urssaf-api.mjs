import { calculateWithUrssafApi, evaluateUrssafExpression } from '../src/urssaf-api-client.mjs'

// Smoke test de production : valide la cohérence interne des réponses API.
// Ne compare volontairement pas les montants à Publicodes, qui reste un outil
// de diagnostic et n'est pas la référence de calcul en production.
const INTERVAL_MS = 500
let lastRequestAt = 0
let queue = Promise.resolve()

function throttledFetch(url, options) {
  const request = queue.then(async () => {
    const delay = Math.max(0, INTERVAL_MS - (Date.now() - lastRequestAt))
    if (delay) await new Promise(resolve => setTimeout(resolve, delay))
    lastRequestAt = Date.now()
    return fetch(url, options)
  })
  queue = request.catch(() => {})
  return request
}

function parisDate() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date()).map(part => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

const date = parisDate()
const checks = []
const failures = []
const round = value => Number(value.toFixed(2))

function assertFinite(label, value) {
  if (!Number.isFinite(value)) throw new Error(`${label} absent ou non numérique.`)
}

async function runSocial(name, input) {
  console.error(`[social] ${name}`)
  try {
    const result = await calculateWithUrssafApi({ commune: 'Pacé', codePostal:'35740', departement:'Ille-et-Vilaine', ...input, date }, { fetchImpl: throttledFetch })
    for (const [label, value] of [
      ['brut calculé', result.grossCalculated],
      ['net avant impôt', result.netBeforeTax],
      ['net imposable', result.taxableNet],
      ['cotisations salariales', result.employeeContributions]
    ]) assertFinite(label, value)
    if (Math.abs(result.grossCalculated - input.brut) > 0.01) {
      throw new Error(`Brut retourné (${result.grossCalculated}) différent du brut demandé (${input.brut}).`)
    }
    if (result.netBeforeTax <= 0 || result.netBeforeTax > result.grossCalculated) {
      throw new Error(`Net avant impôt incohérent : ${result.netBeforeTax} €.`)
    }
    if (input.joursResto > 0) {
      for (const [label, value] of [
        ['montant des titres', result.mealTicketAmount],
        ['part salarié', result.mealTicketEmployee],
        ['part employeur', result.mealTicketEmployer],
        ['part non déductible', result.mealTicketNonDeductible]
      ]) assertFinite(label, value)
    }
    checks.push({
      scenario: name,
      brut: round(result.grossCalculated),
      netAvantImpot: round(result.netBeforeTax),
      netImposable: round(result.taxableNet),
      cotisationsSalariales: round(result.employeeContributions),
      heuresSupplementaires: round(result.overtimePay),
      mutuelleSalariale: round(result.employeeHealth),
      mutuelleEmployeur: round(result.employerHealth),
      titresSalarie: round(result.mealTicketEmployee),
      titresEmployeur: round(result.mealTicketEmployer),
      variablesParDefaut: result.missingVariables,
      avertissements: result.warnings
    })
    return result
  } catch (error) {
    failures.push({ scenario: name, error: error.message })
    return null
  }
}

async function runTax(name, input) {
  console.error(`[fiscal] ${name}`)
  try {
    const result = await calculateWithUrssafApi({ commune:'Pacé', codePostal:'35740', departement:'Ille-et-Vilaine', ...input, date }, { fetchImpl: throttledFetch })
    for (const [label, value] of [
      ['net avant impôt', result.netBeforeTax],
      ['net après impôt', result.netAfterTax],
      ['montant du prélèvement', result.incomeTax],
      ['taux appliqué', result.calculatedTaxRate]
    ]) assertFinite(label, value)
    if (result.calculatedTaxRate < 0 || result.calculatedTaxRate > 100) {
      throw new Error(`Taux d'imposition hors plage : ${result.calculatedTaxRate} %.`)
    }
    if (result.netAfterTax > result.netBeforeTax + 0.01 || result.incomeTax < 0) {
      throw new Error('Relation net après impôt / prélèvement incohérente.')
    }
    // Le modèle renvoie le montant annuel d'impôt ; le net après PAS est mensuel.
    // Vérifier leur cohérence évite de valider deux champs numériques mais discordants.
    const monthlyTax = result.incomeTax / 12
    if (Math.abs((result.netBeforeTax - result.netAfterTax) - monthlyTax) > 0.03) {
      throw new Error(`Net après impôt incohérent avec l'impôt annuel : écart mensuel ${(result.netBeforeTax - result.netAfterTax).toFixed(2)} €, impôt annualisé / 12 ${monthlyTax.toFixed(2)} €.`)
    }
    checks.push({
      scenario: name,
      netAvantImpot: round(result.netBeforeTax),
      netApresImpot: round(result.netAfterTax),
      impot: round(result.incomeTax),
      tauxApplique: round(result.calculatedTaxRate),
      variablesParDefaut: result.missingVariables,
      avertissements: result.warnings
    })
  } catch (error) {
    failures.push({ scenario: name, error: error.message })
  }
}

const references = {}
for (const rule of ['SMIC', 'plafond sécurité sociale']) {
  const result = await evaluateUrssafExpression(rule, { date }, { fetchImpl: throttledFetch })
  assertFinite(rule, result.value)
  if (result.value <= 0) throw new Error(`Valeur invalide pour la règle ${rule}.`)
  references[rule] = {
    value: round(result.value),
    variablesParDefaut: result.missingVariables,
    avertissements: result.warnings
  }
}

const social39NoTickets = await runSocial('2300 € brut, 39 h, mutuelle 30/30, sans titres', {
  brut: 2300, dureeType: '39', mutuelle: 30, mutuellePat: 30, joursResto: 0, valeurResto: 0
})
await runSocial('2300 € brut, 35 h, mutuelle 30/30, sans titres', {
  brut: 2300, dureeType: '35', mutuelle: 30, mutuellePat: 30, joursResto: 0, valeurResto: 0
})
const social39WithTickets = await runSocial('2300 € brut, 39 h, mutuelle 30/30, 21 titres de 8 €', {
  brut: 2300, dureeType: '39', mutuelle: 30, mutuellePat: 30,
  joursResto: 21, valeurResto: 8, partResto: 50
})
if (social39NoTickets && social39WithTickets) {
  // Le net versé doit déjà déduire la part salariale des titres, exactement une fois.
  const netDifference = social39NoTickets.netBeforeTax - social39WithTickets.netBeforeTax
  const ticketEmployeeShare = social39WithTickets.mealTicketEmployee
  if (Math.abs(netDifference - ticketEmployeeShare) > 0.03) {
    failures.push({
      scenario: 'cohérence du net bancaire avec les titres-restaurant',
      error: `Le net avant impôt ne reflète pas exactement la part salariale des titres : différence ${netDifference.toFixed(2)} €, part salarié ${ticketEmployeeShare.toFixed(2)} €.`
    })
  }
}

await runTax('taux personnalisé 10 %', {
  brut: 2300, dureeType: '35', modeImpot: 'personnalisé', tauxPAS: 10
})
await runTax('taux neutre', {
  brut: 2300, dureeType: '35', modeImpot: 'neutre'
})
await runTax('barème standard, célibataire sans enfant', {
  brut: 2300, dureeType: '35', modeImpot: 'barème',
  situationFamille: 'célibataire', enfantsACharge: 0
})
await runTax('barème standard, couple avec 24 000 € autres revenus', {
  brut: 2300, dureeType: '35', modeImpot: 'barème',
  situationFamille: 'couple', enfantsACharge: 0, autresRevenusImposables: 24000
})

console.log(JSON.stringify({ date, references, checks, failures }, null, 2))
if (failures.length) {
  throw new Error(`Validation API incomplète : ${JSON.stringify(failures)}`)
}
