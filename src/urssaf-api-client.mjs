const DEFAULT_ENDPOINT = 'https://mon-entreprise.urssaf.fr/api/v1/evaluate'
const DEFAULT_TIMEOUT_MS = 15000
const MONTHLY_BASE_HOURS = 151.67
const MONTHLY_OVERTIME_HOURS_39H = 4 * 52 / 12
const MAX_GROSS_CALIBRATION_ATTEMPTS = 3

const EXPRESSIONS = Object.freeze({
  gross: 'salarié . rémunération . brut',
  netBeforeTax: 'salarié . rémunération . net . à payer avant impôt',
  employeeContributions: 'salarié . cotisations . salarié',
  overtimePay: 'salarié . rémunération . heures supplémentaires',
  employeeHealth: 'salarié . cotisations . prévoyances . santé . salarié',
  employerHealth: 'salarié . cotisations . prévoyances . santé . employeur',
  mealTicketAmount: 'salarié . rémunération . frais professionnels . titres-restaurant . montant',
  mealTicketEmployer: 'salarié . rémunération . frais professionnels . titres-restaurant . employeur',
  mealTicketNonDeductible: 'salarié . rémunération . frais professionnels . non déductible',
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

function formatDate(value) {
  if (value === undefined || value === null || value === '') {
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
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== String(value)) {
    throw new TypeError('date doit être une date calendaire valide au format AAAA-MM-JJ.')
  }

  return `${match[3]}/${match[2]}/${match[1]}`
}

function publicodesString(value, name, fallback) {
  const text = String(value ?? fallback ?? '').trim().replace(/\s+/g, ' ')
  if (!text || text.length > 80 || /[\r\n\u0000-\u001f]/.test(text)) {
    throw new TypeError(`${name} doit être renseignée sur 1 à 80 caractères.`)
  }
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

function buildSituation(input, baseGross, overtimeHours) {
  const employeeHealth = numberInRange(input.mutuelle ?? 0, 'mutuelle', 0, 100000)
  const employerHealth = numberInRange(input.mutuellePat ?? input.mutuelle ?? 0, 'mutuellePat', 0, 100000)
  const totalHealth = employeeHealth + employerHealth
  const employerHealthRate = totalHealth > 0 ? employerHealth / totalHealth * 100 : 0
  if (totalHealth > 0 && employerHealthRate < 50) {
    throw new TypeError('La part employeur de la complémentaire santé obligatoire doit être d’au moins 50 %.')
  }

  const mealTicketDays = integerInRange(input.joursResto ?? 0, 'joursResto', 0, 31)
  const mealTicketValue = numberInRange(input.valeurResto ?? 0, 'valeurResto', 0, 500)
  const employeeMealTicketRate = mealTicketDays > 0
    ? numberInRange(input.partResto ?? 50, 'partResto', 40, 50)
    : 50
  const employerMealTicketRate = 100 - employeeMealTicketRate

  const situation = {
    'salarié': 'oui',
    'salarié . contrat': "'CDI'",
    'salarié . contrat . salaire brut': money(baseGross),
    'salarié . contrat . statut cadre': 'non',
    'salarié . contrat . temps de travail . temps partiel': 'non',
    'établissement . commune': publicodesString(input.commune, 'commune', 'Pacé'),
    'établissement . commune . département': publicodesString(input.departement, 'département', (!input.commune || input.commune === 'Pacé') ? 'Ille-et-Vilaine' : ''),
    'salarié . convention collective': "'droit commun'",
    'salarié . activité partielle': 'non',
    'dirigeant . indépendant': 'non',
    'salarié . rémunération . avantages en nature': 'non',
    'salarié . rémunération . primes . activité . base': '0 €/mois',
    "salarié . rémunération . primes . fin d'année": 'non',
    'salarié . régimes spécifiques . taux réduits': 'non',
    'salarié . régimes spécifiques . DFS': 'non',
    'salarié . régimes spécifiques . impatriés': 'non',
    "situation personnelle . domiciliation fiscale à l'étranger": 'non',
    'salarié . temps de travail . heures supplémentaires': `${overtimeHours} heure/mois`,
    'salarié . cotisations . prévoyances . santé . montant': money(totalHealth),
    'salarié . cotisations . prévoyances . santé . taux employeur': percent(employerHealthRate),
    'salarié . rémunération . frais professionnels . titres-restaurant': mealTicketDays > 0 ? 'oui' : 'non',
    'salarié . rémunération . frais professionnels . titres-restaurant . nombre': `${mealTicketDays} titres-restaurant/mois`,
    'salarié . rémunération . frais professionnels . titres-restaurant . montant unitaire': `${mealTicketValue.toFixed(2)} €/titres-restaurant`,
    'salarié . rémunération . frais professionnels . titres-restaurant . taux employeur': percent(employerMealTicketRate),
    'date': formatDate(input.date)
  }



  return situation
}

function normalizeMissingVariables(value) {
  if (Array.isArray(value)) {
    return value.filter(item => typeof item === 'string')
  }
  if (value && typeof value === 'object') {
    return Object.keys(value)
  }
  return []
}

function normalizeWarnings(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(item => {
    if (typeof item === 'string') return item
    if (item && typeof item.message === 'string') return item.message
    return 'Avertissement non détaillé du moteur Urssaf.'
  }))]
}

function describeApiFailure(status) {
  if (status === 400) return 'L’API Urssaf a rejeté la situation transmise (HTTP 400). Vérifier les paramètres du scénario.'
  if (status === 429) return 'Limite temporaire de requêtes de l’API Urssaf atteinte (HTTP 429). Attendre puis réessayer.'
  if (status >= 500) return `Le service de calcul Urssaf est temporairement indisponible (HTTP ${status}).`
  return `L’API Urssaf a répondu avec une erreur HTTP ${status}.`
}

async function evaluateRequest(fetchImpl, endpoint, timeoutMs, situation, expressions) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    let response
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json'
        },
        body: JSON.stringify({ situation, expressions }),
        signal: controller.signal
      })
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error(`Délai dépassé : l’API Urssaf n’a pas répondu en ${timeoutMs / 1000} secondes.`)
      }
      throw new Error('Impossible de joindre l’API Urssaf. Vérifier la connexion Internet puis réessayer.')
    }

    if (!response || typeof response.ok !== 'boolean') {
      throw new Error('Réponse HTTP invalide reçue de l’API Urssaf.')
    }
    if (!response.ok) {
      throw new Error(describeApiFailure(response.status))
    }

    let payload
    try {
      payload = await response.json()
    } catch {
      throw new Error('L’API Urssaf a renvoyé une réponse JSON illisible.')
    }

    if (payload?.error || payload?.situationError) {
      const message = payload.error?.message ?? payload.situationError?.message
      throw new Error(typeof message === 'string' && message.trim()
        ? `Calcul refusé par l’API Urssaf : ${message}`
        : 'L’API Urssaf n’a pas pu évaluer cette situation.')
    }
    if (!Array.isArray(payload?.evaluate) || payload.evaluate.length !== expressions.length) {
      throw new Error('Réponse incomplète de l’API Urssaf : les expressions demandées ne sont pas toutes présentes.')
    }

    const noMealTickets = situation['salarié . rémunération . frais professionnels . titres-restaurant'] === 'non'
    const zeroWhenNoMealTickets = new Set([
      EXPRESSIONS.mealTicketAmount,
      EXPRESSIONS.mealTicketEmployer,
      EXPRESSIONS.mealTicketNonDeductible
    ])
    const values = payload.evaluate.map((item, index) => {
      if (!item) {
        throw new Error(`L’API Urssaf n’a pas fourni de résultat pour « ${expressions[index]} ».`)
      }
      if (!Number.isFinite(item.nodeValue)) {
        // Sans titres-restaurant déclarés, ces règles ne sont pas applicables :
        // l'API peut renvoyer null. Le zéro découle alors explicitement de la saisie,
        // et ne constitue pas un résultat de calcul de remplacement.
        if (noMealTickets && item.nodeValue === null && zeroWhenNoMealTickets.has(expressions[index])) {
          return 0
        }
        throw new Error(`L’API Urssaf n’a pas fourni de valeur numérique pour « ${expressions[index]} ».`)
      }
      return item.nodeValue
    })

    const missingVariables = [...new Set(payload.evaluate.flatMap(item => normalizeMissingVariables(item.missingVariables)))]
    const warnings = normalizeWarnings(payload.warnings)
    const engineErrors = warnings.filter(warning => /\[\s*EngineError\s*\]/i.test(warning))
    if (engineErrors.length) {
      throw new Error(`Le moteur Urssaf a signalé une erreur de calcul : ${engineErrors.map(warning => warning.replace(/\s+/g, ' ').trim()).join(' | ')}`)
    }
    return {
      values,
      missingVariables,
      warnings
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Évalue une règle Publicodes sans calcul salarial local.
 * Une date ISO éventuelle est convertie au format attendu par le modèle.
 */
export async function evaluateUrssafExpression(expression, situation = {}, options = {}) {
  if (typeof expression !== 'string' || !expression.trim() || expression.length > 200) {
    throw new TypeError('Une règle Urssaf valide est requise.')
  }
  if (!situation || typeof situation !== 'object' || Array.isArray(situation)) {
    throw new TypeError('La situation de la règle doit être un objet.')
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    throw new Error('La fonction fetch n’est pas disponible dans cet environnement.')
  }

  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT
  const timeoutMs = numberInRange(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'timeoutMs', 1000, 60000)
  const normalizedSituation = { ...situation }
  if (typeof normalizedSituation.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(normalizedSituation.date)) {
    normalizedSituation.date = formatDate(normalizedSituation.date)
  }

  const evaluation = await evaluateRequest(fetchImpl, endpoint, timeoutMs, normalizedSituation, [expression])
  return Object.freeze({
    expression,
    value: evaluation.values[0],
    missingVariables: evaluation.missingVariables,
    warnings: evaluation.warnings,
    endpoint,
    checkedAt: new Date().toISOString()
  })
}

/**
 * Calcule un scénario via l'API REST officielle Mon-entreprise / Urssaf.
 * Aucun calcul de cotisations n'est effectué localement.
 * Il n'y a volontairement aucun repli vers un modèle local en cas d'échec.
 */
export async function calculateWithUrssafApi(input = {}, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Un scénario de calcul est requis.')
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    throw new Error('La fonction fetch n’est pas disponible dans cet environnement.')
  }

  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT
  const timeoutMs = numberInRange(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'timeoutMs', 1000, 60000)
  const grossTarget = numberInRange(input.brut, 'brut', 0, 1000000)
  if (grossTarget === 0) throw new TypeError('brut doit être strictement supérieur à 0 €.')
  const durationType = input.dureeType === undefined ? '35' : String(input.dureeType)
  if (!['35', '39'].includes(durationType)) {
    throw new TypeError('dureeType doit être égal à 35 ou 39.')
  }

  const overtimeHours = durationType === '39' ? MONTHLY_OVERTIME_HOURS_39H : 0
  let baseGross = durationType === '39'
    // Estimation initiale neutre : le taux réel est calculé par l’API Urssaf.
    ? grossTarget * MONTHLY_BASE_HOURS / (MONTHLY_BASE_HOURS + overtimeHours)
    : grossTarget

  const benchmarkOnly = input.benchmarkOnly === true
  // Les règles de titres-restaurant ne sont pas applicables lorsqu'aucun titre
  // n'est déclaré : l'API peut omettre leur nodeValue. Ne demander ces règles
  // que lorsque le scénario active réellement cet avantage.
  const hasMealTickets = !benchmarkOnly && numberInRange(input.joursResto ?? 0, 'joursResto', 0, 31) > 0
  const socialExpressions = benchmarkOnly
    ? [EXPRESSIONS.gross, EXPRESSIONS.netBeforeTax]
    : [
        EXPRESSIONS.gross,
        EXPRESSIONS.netBeforeTax,
        EXPRESSIONS.employeeContributions,
        EXPRESSIONS.overtimePay,
        EXPRESSIONS.employeeHealth,
        EXPRESSIONS.employerHealth,
        ...(hasMealTickets ? [
          EXPRESSIONS.mealTicketAmount,
          EXPRESSIONS.mealTicketEmployer,
          EXPRESSIONS.mealTicketNonDeductible,
        ] : []),
      ]

  let finalEvaluation
  let finalSituation
  let grossCalculated = NaN

  for (let attempt = 0; attempt < (durationType === '39' ? MAX_GROSS_CALIBRATION_ATTEMPTS : 1); attempt += 1) {
    finalSituation = buildSituation(input, baseGross, overtimeHours)
    const evaluation = await evaluateRequest(fetchImpl, endpoint, timeoutMs, finalSituation, socialExpressions)
    grossCalculated = evaluation.values[0]
    finalEvaluation = evaluation

    if (Math.abs(grossCalculated - grossTarget) <= 0.005) break
    if (grossTarget === 0 || grossCalculated <= 0 || !Number.isFinite(grossCalculated)) {
      throw new Error('Impossible de reconstituer le brut demandé à partir des heures supplémentaires avec le modèle Urssaf.')
    }
    if (attempt === MAX_GROSS_CALIBRATION_ATTEMPTS - 1) {
      throw new Error(`Le brut calculé par l’API (${grossCalculated.toFixed(2)} €) ne correspond pas au brut demandé (${grossTarget.toFixed(2)} €).`)
    }
    baseGross *= grossTarget / grossCalculated
  }



  const values = finalEvaluation.values
  if (benchmarkOnly) {
    return Object.freeze({
      engine: 'API REST officielle Mon-entreprise / Urssaf',
      endpoint,
      date: formatDate(input.date),
      grossTarget,
      grossCalculated,
      grossDifference: grossCalculated - grossTarget,
      baseGross,
      overtimeHours,
      netBeforeTax: values[1],
      benchmarkOnly: true,
      missingVariables: finalEvaluation.missingVariables,
      warnings: finalEvaluation.warnings,
      checkedAt: new Date().toISOString()
    })
  }

  const result = {
    engine: 'API REST officielle Mon-entreprise / Urssaf',
    endpoint,
    date: formatDate(input.date),
    grossTarget,
    grossCalculated,
    grossDifference: grossCalculated - grossTarget,
    baseGross,
    overtimeHours,
    netBeforeTax: values[1],
    employeeContributions: values[3],
    overtimePay: values[4],
    employeeHealth: values[5],
    employerHealth: values[6],
    taxMode,
    mealTicketAmount: hasMealTickets ? values[7] : 0,
    mealTicketEmployee: hasMealTickets ? values[7] - values[8] : 0,
    mealTicketEmployer: hasMealTickets ? values[8] : 0,
    mealTicketNonDeductible: hasMealTickets ? values[9] : 0,
    missingVariables: finalEvaluation.missingVariables,
    warnings: finalEvaluation.warnings,
    checkedAt: new Date().toISOString()
  }

  return Object.freeze(result)
}

export const urssafApiExpressions = EXPRESSIONS
