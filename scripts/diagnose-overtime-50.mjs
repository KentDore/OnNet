import modeleSocialRules from 'modele-social'
import PublicodesEngine from 'publicodes'

const date = '11/11/2026'
const baseGross = 3000
// 10 heures supplémentaires hebdomadaires ≈ 43,33 h/mois.
// Le seuil légal standard est de 8 h/semaine : le reliquat doit être majoré à 50 %.
const overtimeHours = 43.33
const situation = {
  'salarié': 'oui',
  'salarié . contrat': "'CDI'",
  'salarié . contrat . salaire brut': `${baseGross.toFixed(6)} €/mois`,
  'salarié . contrat . statut cadre': 'non',
  'salarié . contrat . temps de travail . temps partiel': 'non',
  'établissement . commune': "'Pacé'",
  'salarié . convention collective': "'droit commun'",
  'salarié . activité partielle': 'non',
  'salarié . temps de travail . heures supplémentaires': `${overtimeHours} heure/mois`,
  'date': date
}
const expressions = [
  'salarié . rémunération . brut',
  'salarié . rémunération . heures supplémentaires'
]
const engine = new PublicodesEngine(modeleSocialRules, {
  warn: { deprecatedSyntax: false, cyclicReferences: false }
})
engine.setSituation(situation)
const local = expressions.map(expression => engine.evaluate(expression).nodeValue)
if (!local.every(Number.isFinite)) throw new Error('Le moteur local n’a pas produit de valeurs numériques.')

const response = await fetch('https://mon-entreprise.urssaf.fr/api/v1/evaluate', {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json' },
  body: JSON.stringify({ situation, expressions })
})
if (!response.ok) throw new Error(`API Urssaf : HTTP ${response.status} — ${(await response.text()).slice(0, 1000)}`)
const payload = await response.json()
if (payload.error || payload.situationError || !Array.isArray(payload.evaluate)) {
  throw new Error(`Réponse API Urssaf inexploitable : ${JSON.stringify(payload).slice(0, 2000)}`)
}
const remote = payload.evaluate.map(item => item?.nodeValue)
if (!remote.every(Number.isFinite)) throw new Error('L’API officielle n’a pas produit les valeurs attendues.')

const results = expressions.map((expression, index) => ({
  expression,
  local: Number(local[index].toFixed(2)),
  urssaf: Number(remote[index].toFixed(2)),
  difference: Number((local[index] - remote[index]).toFixed(4))
}))
const straight25 = baseGross / 151.67 * overtimeHours * 1.25
const straight50 = baseGross / 151.67 * overtimeHours * 1.5
if (Math.abs(local[1] - remote[1]) > 0.03) {
  throw new Error(`Écart supérieur à 3 centimes avec l’API : ${JSON.stringify(results)}`)
}
if (!(local[1] > straight25 && local[1] < straight50)) {
  throw new Error(`La rémunération ne semble pas combiner les majorations 25 % et 50 % : ${local[1]} ; bornes ${straight25}–${straight50}`)
}
console.log(JSON.stringify({
  scenario: '10 heures supplémentaires hebdomadaires environ (43,33 h/mois)',
  overtimePay: local[1],
  allAt25Percent: straight25,
  allAt50Percent: straight50,
  comparisons: results,
  warningCount: Array.isArray(payload.warnings) ? payload.warnings.length : 0
}, null, 2))
