const gross = 2300
const baseGross = gross * 151.67 / (151.67 + 17.33 * 1.25)
const euro = value => `${value.toFixed(6)} €/mois`
const situation = {
  'salarié': 'oui',
  'salarié . contrat': "'CDI'",
  'salarié . contrat . salaire brut': euro(baseGross),
  'salarié . contrat . statut cadre': 'non',
  'salarié . contrat . temps de travail . temps partiel': 'non',
  'établissement . commune': "'Pacé'",
  'salarié . convention collective': "'droit commun'",
  'salarié . activité partielle': 'non',
  'salarié . temps de travail . heures supplémentaires': '17.33 heure/mois',
  'salarié . cotisations . prévoyances . santé . montant': '60 €/mois',
  'salarié . cotisations . prévoyances . santé . taux employeur': '50%',
  'salarié . rémunération . frais professionnels . titres-restaurant': 'oui',
  'salarié . rémunération . frais professionnels . titres-restaurant . nombre': '21 titre-restaurant/mois',
  'salarié . rémunération . frais professionnels . titres-restaurant . montant unitaire': '8 €/titre-restaurant',
  'salarié . rémunération . frais professionnels . titres-restaurant . taux employeur': '50%',
  'date': '11/11/2026'
}
const response = await fetch('https://mon-entreprise.urssaf.fr/api/v1/evaluate', {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json' },
  body: JSON.stringify({
    situation,
    expressions: [
      'salarié . rémunération . brut',
      'salarié . rémunération . net . à payer avant impôt',
      'salarié . rémunération . net . imposable'
    ]
  })
})
if (!response.ok) throw new Error(`API Urssaf : HTTP ${response.status}`)
const payload = await response.json()
const output = payload.evaluate ?? payload
const supported = Array.isArray(output) && output.every(item => Number.isFinite(item?.nodeValue))
console.log(JSON.stringify({
  diagnostic: 'Titres-restaurant via API officielle',
  supported,
  values: supported ? output.map(item => item.nodeValue) : output,
  warnings: (payload.warnings ?? []).slice(0, 5).map(item => item.message),
  warningCount: (payload.warnings ?? []).length
}, null, 2))
