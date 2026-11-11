import { calculatePublicodes } from '../src/publicodes-adapter.mjs'

const input = {
  brut: 2300,
  dureeType: '39',
  mutuelle: 30,
  mutuellePat: 30,
  joursResto: 0,
  valeurResto: 0,
  date: '2026-11-11'
}
const local = calculatePublicodes(input)

const euro = value => `${value.toFixed(6)} €/mois`
const percent = value => `${value.toFixed(6)}%`
const totalHealth = input.mutuelle + input.mutuellePat
const employerHealthRate = totalHealth > 0 ? input.mutuellePat / totalHealth * 100 : 50

const situation = {
  'salarié': 'oui',
  'salarié . contrat': "'CDI'",
  'salarié . contrat . salaire brut': euro(local.baseGross),
  'salarié . contrat . statut cadre': 'non',
  'salarié . contrat . temps de travail . temps partiel': 'non',
  'établissement . commune': "'Pacé'",
  'salarié . convention collective': "'droit commun'",
  'salarié . activité partielle': 'non',
  'salarié . temps de travail . heures supplémentaires': `${local.overtimeHours} heure/mois`,
  'salarié . cotisations . prévoyances . santé . montant': euro(totalHealth),
  'salarié . cotisations . prévoyances . santé . taux employeur': percent(employerHealthRate),
  'date': '11/11/2026'
}
const expressions = [
  'salarié . rémunération . brut',
  'salarié . rémunération . net . à payer avant impôt',
  'salarié . rémunération . net imposable',
  'salarié . cotisations . salarié',
  'salarié . rémunération . heures supplémentaires',
  'salarié . cotisations . prévoyances . santé . salarié',
  'salarié . cotisations . prévoyances . santé . employeur'
]

const response = await fetch('https://mon-entreprise.urssaf.fr/api/v1/evaluate', {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json' },
  body: JSON.stringify({ situation, expressions })
})
if (!response.ok) {
  throw new Error(`API Urssaf : HTTP ${response.status} — ${(await response.text()).slice(0, 1000)}`)
}
const payload = await response.json()
if (payload.error || payload.situationError || !Array.isArray(payload.evaluate)) {
  throw new Error(`Réponse API Urssaf inexploitable : ${JSON.stringify(payload).slice(0, 2000)}`)
}

const names = [
  ['brut', local.grossCalculated],
  ['netBeforeTax', local.netBeforeTax],
  ['taxableNet', local.taxableNet],
  ['employeeContributions', local.employeeContributions],
  ['overtimePay', local.overtimePay],
  ['employeeHealth', local.employeeHealth],
  ['employerHealth', local.employerHealth]
]
const comparisons = names.map(([name, localValue], index) => {
  const remoteValue = payload.evaluate[index]?.nodeValue
  if (!Number.isFinite(remoteValue)) {
    throw new Error(`Valeur Urssaf absente ou non numérique pour ${name}: ${JSON.stringify(payload.evaluate[index])}`)
  }
  return {
    name,
    local: Number(localValue.toFixed(2)),
    urssaf: Number(remoteValue.toFixed(2)),
    difference: Number((localValue - remoteValue).toFixed(4))
  }
})
console.log(JSON.stringify({
  scenario: '2300 € brut, CDI non-cadre, 39 h, mutuelle 30/30, Pacé, sans titres-restaurant',
  date: input.date,
  comparisons,
  warningCount: Array.isArray(payload.warnings) ? payload.warnings.length : 0,
  warnings: (payload.warnings ?? []).slice(0, 8).map(w => w.message)
}, null, 2))

const mismatches = comparisons.filter(item => Math.abs(item.difference) > 0.03)
if (mismatches.length) {
  throw new Error(`Écart supérieur à 3 centimes avec l'API officielle : ${JSON.stringify(mismatches)}`)
}
