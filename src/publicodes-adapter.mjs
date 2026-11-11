import modeleSocialRules from 'modele-social'
import PublicodesEngine from 'publicodes'

const HEURES_BASE_MENSUELLES = 151.67
const HEURES_SUP_39H_MENSUELLES = 17.33
const MAJORATION_HEURES_SUP_DEFAUT = 25

const RULES = Object.freeze({
  gross: 'salarié . rémunération . brut',
  netBeforeTax: 'salarié . rémunération . net . à payer avant impôt',
  taxableNet: 'salarié . rémunération . net . imposable',
  employeeContributions: 'salarié . cotisations . salarié',
  overtimePay: 'salarié . rémunération . heures supplémentaires',
  employeeHealth: 'salarié . cotisations . prévoyances . santé . salarié',
  employerHealth: 'salarié . cotisations . prévoyances . santé . employeur'
})

function numberInRange(value, name, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new TypeError(`${name} doit être compris entre ${min} et ${max}.`)
  }
  return number
}

function money(value) {
  return `${value.toFixed(6)} €/mois`
}

function percent(value) {
  return `${value.toFixed(6)}%`
}

function dateForPublicodes(value) {
  if (value === undefined || value === null || value === '') {
    const now = new Date()
    return [
      String(now.getUTCDate()).padStart(2, '0'),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
      now.getUTCFullYear()
    ].join('/')
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value))
  if (!match) {
    throw new TypeError('date doit respecter le format AAAA-MM-JJ.')
  }

  return `${match[3]}/${match[2]}/${match[1]}`
}

function evaluateNumber(engine, dottedName) {
  const evaluation = engine.evaluate(dottedName)
  const value = evaluation?.nodeValue
  if (!Number.isFinite(value)) {
    throw new Error(`Publicodes n'a pas produit de valeur numérique pour « ${dottedName} ».`)
  }
  return value
}

/**
 * Calcule une paie mensuelle avec le modèle officiel modele-social.
 *
 * Contrat de l'adaptateur :
 * - brut OnNet = brut mensuel total, heures supplémentaires comprises ;
 * - 35 h = salaire de base seul ;
 * - 39 h = 35 h de base + 17,33 h supplémentaires/mois, majorées à 25 % ;
 * - mutuelle saisie séparément salarié/employeur, convertie en montant total
 *   et taux employeur, comme attendu par modele-social ;
 * - partResto représente la part salariale OnNet, alors que Publicodes attend
 *   le taux employeur.
 *
 * Ce prototype traite uniquement un CDI privé non-cadre, en droit commun,
 * hors activité partielle. Il ne remplace pas un bulletin de paie.
 */
export function calculatePublicodes(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Un scénario de calcul est requis.')
  }

  const brut = numberInRange(input.brut, 'brut', 0, 1000000)
  const durationType = input.dureeType === undefined ? '35' : String(input.dureeType)
  if (!['35', '39'].includes(durationType)) {
    throw new TypeError('dureeType doit être égal à 35 ou 39.')
  }

  const overtimeHours = durationType === '39' ? HEURES_SUP_39H_MENSUELLES : 0
  const overtimeFactor = 1 + MAJORATION_HEURES_SUP_DEFAUT / 100

  // OnNet conserve un brut global ; le modèle officiel attend la base 35 h
  // hors heures supplémentaires. On inverse la décomposition à 25 % d'OnNet.
  const baseGross = durationType === '39'
    ? brut * HEURES_BASE_MENSUELLES /
      (HEURES_BASE_MENSUELLES + overtimeHours * overtimeFactor)
    : brut

  const employeeHealth = numberInRange(input.mutuelle ?? 0, 'mutuelle', 0, 100000)
  const employerHealth = numberInRange(
    input.mutuellePat ?? input.mutuelle ?? 0,
    'mutuellePat',
    0,
    100000
  )
  const totalHealth = employeeHealth + employerHealth
  const employerHealthRate = totalHealth > 0 ? employerHealth / totalHealth * 100 : 50

  const mealTicketDays = numberInRange(input.joursResto ?? 0, 'joursResto', 0, 31)
  const mealTicketValue = numberInRange(input.valeurResto ?? 0, 'valeurResto', 0, 500)
  const employeeMealTicketRate = numberInRange(input.partResto ?? 50, 'partResto', 0, 100)
  const employerMealTicketRate = 100 - employeeMealTicketRate

  const situation = {
    'salarié': 'oui',
    'salarié . contrat': "'CDI'",
    'salarié . contrat . salaire brut': money(baseGross),
    'salarié . contrat . statut cadre': 'non',
    'salarié . contrat . temps de travail . temps partiel': 'non',
    'établissement . commune': "'Pacé'",
    'salarié . convention collective': "'droit commun'",
    'salarié . activité partielle': 'non',
    'salarié . temps de travail . heures supplémentaires': `${overtimeHours} heure/mois`,
    'salarié . cotisations . prévoyances . santé . montant': money(totalHealth),
    'salarié . cotisations . prévoyances . santé . taux employeur': percent(employerHealthRate),
    'salarié . rémunération . frais professionnels . titres-restaurant': mealTicketDays > 0 ? 'oui' : 'non',
    'salarié . rémunération . frais professionnels . titres-restaurant . nombre': `${mealTicketDays} titre-restaurant/mois`,
    'salarié . rémunération . frais professionnels . titres-restaurant . montant unitaire': `${mealTicketValue.toFixed(2)} €/titre-restaurant`,
    'salarié . rémunération . frais professionnels . titres-restaurant . taux employeur': percent(employerMealTicketRate),
    'date': dateForPublicodes(input.date)
  }

  const engine = new PublicodesEngine(modeleSocialRules)
  engine.setSituation(situation)

  const grossCalculated = evaluateNumber(engine, RULES.gross)
  const netBeforeTax = evaluateNumber(engine, RULES.netBeforeTax)
  const taxableNet = evaluateNumber(engine, RULES.taxableNet)
  const employeeContributions = evaluateNumber(engine, RULES.employeeContributions)
  const overtimePay = evaluateNumber(engine, RULES.overtimePay)
  const employeeHealthCalculated = evaluateNumber(engine, RULES.employeeHealth)
  const employerHealthCalculated = evaluateNumber(engine, RULES.employerHealth)

  return Object.freeze({
    engine: 'modele-social / Publicodes',
    modelVersion: '11.1.0',
    publicodesVersion: '1.10.4',
    date: situation.date,
    grossTarget: brut,
    grossCalculated,
    grossDifference: grossCalculated - brut,
    baseGross,
    overtimeHours,
    overtimePay,
    netBeforeTax,
    taxableNet,
    employeeContributions,
    employeeHealth: employeeHealthCalculated,
    employerHealth: employerHealthCalculated
  })
}
