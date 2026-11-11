import modeleSocialRules from 'modele-social'
import PublicodesEngine from 'publicodes'

const situation = {
  'salarié': 'oui',
  'salarié . contrat': "'CDI'",
  'salarié . contrat . salaire brut': '2300 €/mois',
  'salarié . contrat . statut cadre': 'non',
  'salarié . contrat . temps de travail . temps partiel': 'non',
  'établissement . commune': "'Pacé'",
  'salarié . convention collective': "'droit commun'",
  'salarié . activité partielle': 'non',
  'salarié . temps de travail . heures supplémentaires': '0 heure/mois',
  'salarié . cotisations . prévoyances . santé . montant': '60 €/mois',
  'salarié . cotisations . prévoyances . santé . taux employeur': '50%',
  'salarié . rémunération . frais professionnels . titres-restaurant': 'non',
  'salarié . rémunération . frais professionnels . titres-restaurant . nombre': '0 titre-restaurant/mois',
  'salarié . rémunération . frais professionnels . titres-restaurant . montant unitaire': '0 €/titre-restaurant',
  'salarié . rémunération . frais professionnels . titres-restaurant . taux employeur': '50%',
  'impôt . méthode de calcul': "'taux personnalisé'",
  'impôt . revenu imposable': '22610 €/an',
  'impôt . taux personnalisé': '10%',
  'date': '11/11/2026'
}

const engine = new PublicodesEngine(modeleSocialRules, {
  warn: { deprecatedSyntax: false, cyclicReferences: false }
})
engine.setSituation(situation)
const names = [
  'salarié . rémunération . net . imposable',
  'impôt . méthode de calcul',
  'impôt . taux personnalisé',
  "impôt . taux d'imposition",
  'impôt . revenu imposable',
  'impôt . montant',
  'salarié . rémunération . net . à payer avant impôt',
  'salarié . rémunération . net . payé après impôt'
]
const results = {}
for (const name of names) {
  try {
    const evaluation = engine.evaluate(name)
    results[name] = { value: evaluation.nodeValue, unit: evaluation.unit?.numerators?.[0]?.numerator ?? null }
  } catch (error) {
    results[name] = { error: error.message }
  }
}
console.log(JSON.stringify(results, null, 2))
