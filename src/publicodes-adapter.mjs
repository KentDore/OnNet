import modeleSocialRules from 'modele-social'
import PublicodesEngine from 'publicodes'

const HEURES_BASE_MENSUELLES = 151.67
const HEURES_SUP_39H_MENSUELLES = 4 * 52 / 12
const MAJORATION_HEURES_SUP_DEFAUT = 25

const RULES = Object.freeze({
  gross: 'salarié . rémunération . brut',
  netBeforeTax: 'salarié . rémunération . net . à payer avant impôt',
  taxableNet: 'salarié . rémunération . net . imposable',
  netAfterTax: 'salarié . rémunération . net . payé après impôt',
  incomeTax: 'impôt . montant',
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

function integerInRange(value, name, min, max) {
  const number = numberInRange(value, name, min, max)
  if (!Number.isInteger(number)) {
    throw new TypeError(`${name} doit être un nombre entier.`)
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
    // Utiliser la date locale : UTC peut déjà être au lendemain (ou la veille)
    // selon le fuseau du serveur au moment de l'appel.
    const now = new Date()
    return [
      String(now.getDate()).padStart(2, '0'),
      String(now.getMonth() + 1).padStart(2, '0'),
      now.getFullYear()
    ].join('/')
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value))
  if (!match) {
    throw new TypeError('date doit respecter le format AAAA-MM-JJ.')
  }

  const parsed = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`)
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== String(value)
  ) {
    throw new TypeError('date doit être une date calendaire valide au format AAAA-MM-JJ.')
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
 * - 39 h = 35 h de base + 4 × 52 / 12 heures supplémentaires/mois, majorées à 25 % ;
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
  let baseGross = durationType === '39'
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
  const employerHealthRate = totalHealth > 0 ? employerHealth / totalHealth * 100 : 0

  const mealTicketDays = integerInRange(input.joursResto ?? 0, 'joursResto', 0, 31)
  const mealTicketValue = numberInRange(input.valeurResto ?? 0, 'valeurResto', 0, 500)
  const employeeMealTicketRate = numberInRange(input.partResto ?? 50, 'partResto', 0, 100)
  const employerMealTicketRate = 100 - employeeMealTicketRate

  const taxMode = input.modeImpot === undefined ? 'barème' : String(input.modeImpot)
  if (!['barème', 'neutre', 'personnalisé'].includes(taxMode)) {
    throw new TypeError('modeImpot doit être « barème », « neutre » ou « personnalisé ».')
  }
  const taxRate = numberInRange(input.tauxPAS ?? 0, 'tauxPAS', 0, 100)
  if (taxMode === 'personnalisé' && input.tauxPAS === undefined) {
    throw new TypeError('tauxPAS est requis lorsque le mode d’impôt est personnalisé.')
  }
  const family = input.situationFamille === undefined ? 'célibataire' : String(input.situationFamille)
  if (!['célibataire', 'couple', 'veuf'].includes(family)) {
    throw new TypeError('situationFamille doit être célibataire, couple ou veuf.')
  }
  const children = integerInRange(input.enfantsCharge ?? 0, 'enfantsCharge', 0, 20)
  const isolatedParent = input.parentIsole === true
  if (isolatedParent && (family !== 'célibataire' || children === 0)) {
    throw new TypeError('parentIsole nécessite une situation célibataire avec au moins un enfant à charge.')
  }
  const otherTaxableIncome = numberInRange(input.autresRevenusImposables ?? 0, 'autresRevenusImposables', 0, 100000000)

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
    'impôt . méthode de calcul': taxMode === 'barème' ? "'barème standard'" : taxMode === 'neutre' ? "'taux neutre'" : "'taux personnalisé'",
    'impôt . taux personnalisé': percent(taxRate),
    'impôt . foyer fiscal . situation de famille': "'" + family + "'",
    'impôt . foyer fiscal . enfants à charge': `${children} enfant`,
    'impôt . foyer fiscal . parent isolé': isolatedParent ? 'oui' : 'non',
    'impôt . foyer fiscal . autres revenus imposables': `${otherTaxableIncome.toFixed(2)} €/an`,
    'date': dateForPublicodes(input.date)
  }

  const engine = new PublicodesEngine(modeleSocialRules, {
    warn: {
      deprecatedSyntax: false,
      cyclicReferences: false
    }
  })

  // Le modèle peut différer de quelques centimes de l'inversion théorique
  // (heures mensuelles et arrondis internes). On corrige la base par itérations
  // à partir du brut réellement évalué, sans remplacer la formule du modèle.
  let grossCalculated = 0
  if (durationType === '39') {
    for (let iteration = 0; iteration < 4; iteration += 1) {
      situation['salarié . contrat . salaire brut'] = money(baseGross)
      engine.setSituation(situation)
      grossCalculated = evaluateNumber(engine, RULES.gross)
      if (Math.abs(grossCalculated - brut) < 0.000001) break
      if (grossCalculated <= 0) {
        throw new Error('Impossible de recalibrer le brut de base avec le modèle Publicodes.')
      }
      baseGross *= brut / grossCalculated
    }
    situation['salarié . contrat . salaire brut'] = money(baseGross)
  }

  engine.setSituation(situation)
  grossCalculated = evaluateNumber(engine, RULES.gross)
  if (Math.abs(grossCalculated - brut) > 0.005) {
    throw new Error(`Le brut reconstitué (${grossCalculated.toFixed(2)} €) diffère du brut demandé (${brut.toFixed(2)} €) de plus de 0,005 €.`)
  }
  const netBeforeTax = evaluateNumber(engine, RULES.netBeforeTax)
  const taxableNet = evaluateNumber(engine, RULES.taxableNet)
  const netAfterTax = evaluateNumber(engine, RULES.netAfterTax)
  const incomeTax = evaluateNumber(engine, RULES.incomeTax)
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
    netAfterTax,
    incomeTax,
    taxMode,
    employeeContributions,
    employeeHealth: employeeHealthCalculated,
    employerHealth: employerHealthCalculated
  })
}
