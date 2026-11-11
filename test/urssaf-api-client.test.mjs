'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { calculateWithUrssafApi } = await import('../src/urssaf-api-client.mjs')

function scenario(overrides = {}) {
  return {
    brut: 2300,
    dureeType: '35',
    mutuelle: 30,
    mutuellePat: 30,
    joursResto: 21,
    valeurResto: 8,
    partResto: 50,
    date: '2026-11-11',
    ...overrides
  }
}

function apiResponse(expressions, overrides = {}) {
  const nodeValues = {
    'salarié . rémunération . brut': 2300,
    'salarié . rémunération . net . à payer avant impôt': 1810,
    'salarié . rémunération . net . imposable': 1880,
    'salarié . cotisations . salarié': 490,
    'salarié . rémunération . heures supplémentaires': 0,
    'salarié . cotisations . prévoyances . santé . salarié': 30,
    'salarié . cotisations . prévoyances . santé . employeur': 30,
    'salarié . rémunération . net . payé après impôt': 1700,
    'impôt . montant': 1320,
    "impôt . taux d'imposition": 10
  }
  return {
    evaluate: expressions.map(expression => ({
      nodeValue: nodeValues[expression] ?? 0,
      missingVariables: []
    })),
    warnings: [],
    ...overrides
  }
}

function mockFetch(handler) {
  return async (url, options) => {
    assert.equal(url, 'https://mon-entreprise.urssaf.fr/api/v1/evaluate')
    assert.equal(options.method, 'POST')
    assert.equal(options.headers['content-type'], 'application/json')
    return handler(JSON.parse(options.body))
  }
}

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload
  }
}

test('envoie une situation CDI et une seule requête pour un scénario 35 h', async () => {
  let calls = 0
  let request
  const result = await calculateWithUrssafApi(scenario(), {
    fetchImpl: mockFetch(body => {
      calls += 1
      request = body
      return response(apiResponse(body.expressions))
    })
  })

  assert.equal(calls, 1)
  assert.equal(request.situation['salarié'], 'oui')
  assert.equal(request.situation['salarié . contrat'], "'CDI'")
  assert.equal(request.situation['salarié . contrat . salaire brut'], '2300.000000 €/mois')
  assert.equal(request.situation['salarié . contrat . temps de travail . temps partiel'], 'non')
  assert.equal(request.situation.date, '11/11/2026')
  assert.equal(request.expressions[0], 'salarié . rémunération . brut')
  assert.equal(result.engine, 'API REST officielle Mon-entreprise / Urssaf')
  assert.equal(result.netBeforeTax, 1810)
  assert.equal(result.taxableNet, 1880)
  assert.equal(result.missingVariables.length, 0)
})

test('prépare les paramètres de mutuelle et titres-restaurant sans inverser les parts', async () => {
  let request
  await calculateWithUrssafApi(scenario({ mutuelle: 24, mutuellePat: 36, partResto: 40 }), {
    fetchImpl: mockFetch(body => {
      request = body
      return response(apiResponse(body.expressions))
    })
  })

  assert.equal(request.situation['salarié . cotisations . prévoyances . santé . montant'], '60.000000 €/mois')
  assert.equal(request.situation['salarié . cotisations . prévoyances . santé . taux employeur'], '60.000000%')
  assert.equal(request.situation['salarié . rémunération . frais professionnels . titres-restaurant . taux employeur'], '60.000000%')
})

test('prépare un scénario 39 h avec les 4 heures supplémentaires mensuelles', async () => {
  let request
  const result = await calculateWithUrssafApi(scenario({ dureeType: '39', joursResto: 0 }), {
    fetchImpl: mockFetch(body => {
      request = body
      const values = apiResponse(body.expressions)
      const base = Number.parseFloat(body.situation['salarié . contrat . salaire brut'])
      const overtime = 4 * 52 / 12
      values.evaluate[0].nodeValue = base + (base / 151.67) * overtime * 1.25
      values.evaluate[4].nodeValue = 250
      return response(values)
    })
  })

  assert.equal(request.situation['salarié . temps de travail . heures supplémentaires'], `${4 * 52 / 12} heure/mois`)
  assert.equal(result.overtimeHours, 4 * 52 / 12)
  assert.equal(result.overtimePay, 250)
})

test('active le taux personnalisé uniquement quand le mode est demandé', async () => {
  let request
  const result = await calculateWithUrssafApi(scenario({ modeImpot: 'personnalisé', tauxPAS: 10 }), {
    fetchImpl: mockFetch(body => {
      request = body
      return response(apiResponse(body.expressions))
    })
  })

  assert.equal(request.situation['impôt . méthode de calcul'], "'taux personnalisé'")
  assert.equal(request.situation['impôt . taux personnalisé'], '10.000000%')
  assert.equal(result.netAfterTax, 1700)
  assert.equal(result.incomeTax, 1320)
  assert.equal(result.calculatedTaxRate, 10)
})

test('configure le barème avec le foyer fiscal et rejette un parent isolé incohérent', async () => {
  let request
  await calculateWithUrssafApi(scenario({
    modeImpot: 'barème',
    situationFamille: 'célibataire',
    enfantsACharge: 1,
    parentIsole: true
  }), {
    fetchImpl: mockFetch(body => {
      request = body
      return response(apiResponse(body.expressions))
    })
  })

  assert.equal(request.situation['impôt . méthode de calcul'], "'barème standard'")
  assert.equal(request.situation['impôt . foyer fiscal . situation de famille'], "'célibataire'")
  assert.equal(request.situation['impôt . foyer fiscal . enfants à charge'], '1 enfant')
  assert.equal(request.situation['impôt . foyer fiscal . parent isolé'], 'oui')

  await assert.rejects(
    calculateWithUrssafApi(scenario({
      modeImpot: 'barème',
      situationFamille: 'couple',
      enfantsACharge: 0,
      parentIsole: true
    }), { fetchImpl: mockFetch(() => response(apiResponse([]))) }),
    /parentIsole/
  )
})

test('remonte les variables par défaut et avertissements de l’API', async () => {
  const result = await calculateWithUrssafApi(scenario(), {
    fetchImpl: mockFetch(body => response(apiResponse(body.expressions, {
      evaluate: body.expressions.map(expression => ({
        nodeValue: expression === 'salarié . rémunération . brut' ? 2300 : 100,
        missingVariables: { 'salarié . contrat . statut cadre': 1 }
      })),
      warnings: [{ message: 'Une règle expérimentale a été utilisée.' }]
    })))
  })

  assert.deepEqual(result.missingVariables, ['salarié . contrat . statut cadre'])
  assert.deepEqual(result.warnings, ['Une règle expérimentale a été utilisée.'])
})

test('refuse une réponse sans valeur ou avec une erreur de situation', async () => {
  await assert.rejects(
    calculateWithUrssafApi(scenario(), {
      fetchImpl: mockFetch(body => response({ evaluate: body.expressions.map(() => ({})) }))
    }),
    /valeur numérique/
  )
  await assert.rejects(
    calculateWithUrssafApi(scenario(), {
      fetchImpl: mockFetch(() => response({ situationError: { message: 'Situation invalide' } }))
    }),
    /Situation invalide/
  )
})

test('explique la limite de débit HTTP 429 sans repli local', async () => {
  let calls = 0
  await assert.rejects(
    calculateWithUrssafApi(scenario(), {
      fetchImpl: mockFetch(() => {
        calls += 1
        return response({}, 429)
      })
    }),
    /Limite temporaire de requêtes/
  )
  assert.equal(calls, 1)
})

test('rejette les valeurs incohérentes avant tout appel réseau', async () => {
  let calls = 0
  const fetchImpl = async () => {
    calls += 1
    return response({})
  }

  await assert.rejects(calculateWithUrssafApi(scenario({ brut: -1 }), { fetchImpl }), /brut/)
  await assert.rejects(calculateWithUrssafApi(scenario({ dureeType: '37' }), { fetchImpl }), /dureeType/)
  await assert.rejects(calculateWithUrssafApi(scenario({ joursResto: 2.5 }), { fetchImpl }), /entier/)
  await assert.rejects(calculateWithUrssafApi(scenario({ modeImpot: 'personnalisé' }), { fetchImpl }), /tauxPAS/)
  assert.equal(calls, 0)
})
