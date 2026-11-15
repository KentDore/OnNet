import { writeFile } from 'node:fs/promises'
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

function assertNoEngineErrors(name, warnings = []) {
  const errors = warnings.filter(warning => /\[\s*EngineError\s*\]/i.test(String(warning)))
  if (errors.length) {
    throw new Error(`${errors.length} erreur(s) du moteur Publicodes dans les avertissements API : ${errors.map(error => String(error).replace(/\s+/g, ' ').slice(0, 500)).join(' | ')}`)
  }
}

function assertLocationResolved(result) {
  const missing = (result.missingVariables || []).filter(name => String(name).startsWith('établissement . commune . département'))
  if (missing.length) throw new Error('Le département de l’établissement reste non résolu par le modèle Urssaf : ' + missing.join(', '))
}

async function runSocial(name, input) {
  console.error(`[social] ${name}`)
  try {
    const result = await calculateWithUrssafApi({ commune: 'Pacé', codePostal:'35740', departement:'Ille-et-Vilaine', ...input, date }, { fetchImpl: throttledFetch })
    assertLocationResolved(result)
    assertNoEngineErrors(name, result.warnings)
    for (const [label, value] of [
      ['brut calculé', result.grossCalculated],
      ['net calculé', result.netBeforeTax],
      ['cotisations salariales', result.employeeContributions]
    ]) assertFinite(label, value)
    const expectedGross = input.allowGrossReintegration
      ? input.brut + result.mealTicketNonDeductible
      : input.brut
    if (Math.abs(result.grossCalculated - expectedGross) > 0.01) {
      throw new Error(`Brut retourné (${result.grossCalculated}) différent du brut attendu (${expectedGross}).`)
    }
    if (result.netBeforeTax <= 0 || result.netBeforeTax > result.grossCalculated) {
      throw new Error(`Net calculé incohérent : ${result.netBeforeTax} €.`)
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
      netCalcule: round(result.netBeforeTax),
      cotisationsSalariales: round(result.employeeContributions),
      heuresSupplementaires: round(result.overtimePay),
      mutuelleSalariale: round(result.employeeHealth),
      mutuelleEmployeur: round(result.employerHealth),
      titresSalarie: round(result.mealTicketEmployee),
      titresEmployeur: round(result.mealTicketEmployer),
      titresNonDeductible: round(result.mealTicketNonDeductible),
      variablesParDefaut: result.missingVariables,
      avertissements: result.warnings
    })
    return result
  } catch (error) {
    failures.push({ scenario: name, error: error.message })
    return null
  }
}

const references = {}
for (const rule of ['SMIC', 'plafond sécurité sociale']) {
  const result = await evaluateUrssafExpression(rule, {
    date,
    'établissement . commune': "'Pacé'",
    'établissement . commune . département': "'Ille-et-Vilaine'"
  }, { fetchImpl: throttledFetch })
  assertLocationResolved(result)
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
const highValueTickets = await runSocial('21 titres de 15 €, part employeur 60 % (contrôle du plafond)', {
  brut: 2300, dureeType: '35', mutuelle: 30, mutuellePat: 30,
  joursResto: 21, valeurResto: 15, partResto: 40, allowGrossReintegration: true
})
if (highValueTickets && Math.abs(highValueTickets.mealTicketNonDeductible - 35.28) > 0.03) {
  failures.push({
    scenario: 'contrôle du plafond titres-restaurant',
    error: 'La part employeur excédant le plafond devrait être de 35,28 €/mois pour 21 titres de 15 € financés à 60 %, valeur API : ' + highValueTickets.mealTicketNonDeductible.toFixed(2) + ' €.'
  })
}

if (social39NoTickets && social39WithTickets) {
  // Le net versé doit déjà déduire la part salariale des titres, exactement une fois.
  const netDifference = social39NoTickets.netBeforeTax - social39WithTickets.netBeforeTax
  const ticketEmployeeShare = social39WithTickets.mealTicketEmployee
  if (Math.abs(netDifference - ticketEmployeeShare) > 0.03) {
    failures.push({
      scenario: 'cohérence du net bancaire avec les titres-restaurant',
      error: `Le net calculé ne reflète pas exactement la part salariale des titres : différence ${netDifference.toFixed(2)} €, part salarié ${ticketEmployeeShare.toFixed(2)} €.`
    })
  }
}


const report = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  date,
  source: 'API Mon-entreprise / Urssaf',
  purpose: 'Contrôles de cohérence interne ; ne constitue pas une validation indépendante des montants.',
  references,
  checks,
  failures
}
await writeFile('urssaf-smoke-results.json', `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(report, null, 2))
if (failures.length) {
  throw new Error(`Validation API incomplète : ${JSON.stringify(failures)}`)
}
