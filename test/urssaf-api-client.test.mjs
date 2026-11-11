'use strict'

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { calculateWithUrssafApi, evaluateUrssafExpression } from '../src/urssaf-api-client.mjs'

function scenario(overrides = {}) {
  return {
    brut: 2300,
    commune: 'Pacé',
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
    'salarié . rémunération . frais professionnels . titres-restaurant . montant': 168,
    'salarié . rémunération . frais professionnels . titres-restaurant . employeur': 84,
    'salarié . rémunération . frais professionnels . non déductible': 0,
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


test('évalue la règle SMIC officielle avec une date de situation et conserve les diagnostics', async () => {
  let request
  const result = await evaluateUrssafExpression('SMIC', { date:'2026-11-11' }, {
    fetchImpl: mockFetch(body => {
      request = body
      return response({
        evaluate: [{ nodeValue: 1867.02, missingVariables: { 'Département': 1 } }],
        warnings: ['Règle expérimentale signalée']
      })
    })
  })

  assert.deepEqual(request.expressions, ['SMIC'])
  assert.deepEqual(request.situation, { date:'11/11/2026' })
  assert.equal(result.value, 1867.02)
  assert.deepEqual(result.missingVariables, ['Département'])
  assert.deepEqual(result.warnings, ['Règle expérimentale signalée'])
  assert.equal(result.endpoint, 'https://mon-entreprise.urssaf.fr/api/v1/evaluate')
  assert.ok(result.checkedAt)
})

test('refuse une réponse SMIC non numérique et ne substitue pas de valeur locale', async () => {
  await assert.rejects(evaluateUrssafExpression('SMIC', {}, {
    fetchImpl: mockFetch(() => response({
      evaluate: [{ nodeValue: null, missingVariables: [] }],
      warnings: []
    }))
  }), /valeur numérique/)
})

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
  assert.equal(request.situation['établissement . commune'], "'Pacé'")
  assert.equal(request.situation.date, '11/11/2026')
  assert.equal(request.expressions[0], 'salarié . rémunération . brut')
  assert.equal(result.engine, 'API REST officielle Mon-entreprise / Urssaf')
  assert.equal(result.endpoint, 'https://mon-entreprise.urssaf.fr/api/v1/evaluate')
  assert.equal(result.netBeforeTax, 1810)
  assert.equal(result.taxableNet, 1880)
  assert.equal(result.mealTicketAmount, 168)
  assert.equal(result.mealTicketEmployee, 84)
  assert.equal(result.mealTicketEmployer, 84)
  assert.equal(result.mealTicketNonDeductible, 0)
  assert.equal(result.missingVariables.length, 0)
})

test('transmet la commune de l’établissement et échappe les apostrophes', async () => {
  let request
  await calculateWithUrssafApi(scenario({ commune: "L'Haÿ-les-Roses" }), {
    fetchImpl: mockFetch(body => {
      request = body
      return response(apiResponse(body.expressions))
    })
  })
  assert.equal(request.situation['établissement . commune'], "'L\\'Haÿ-les-Roses'")
  await assert.rejects(calculateWithUrssafApi(scenario({ commune: '   ' }), {
    fetchImpl: mockFetch(body => response(apiResponse(body.expressions)))
  }), /commune doit être renseignée/)
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

test('reconstitue le brut total 39 h sans supposer localement un taux de majoration', async () => {
  const requests = []
  const result = await calculateWithUrssafApi(scenario({ dureeType: '39', joursResto: 0 }), {
    fetchImpl: mockFetch(body => {
      requests.push(body)
      const values = apiResponse(body.expressions)
      const base = Number.parseFloat(body.situation['salarié . contrat . salaire brut'])
      const overtime = 4 * 52 / 12
      // Taux fictif de 10 % pour vérifier que le client s'appuie sur le brut retourné par l'API.
      values.evaluate[0].nodeValue = base + (base / 151.67) * overtime * 1.10
      values.evaluate[4].nodeValue = 250
      return response(values)
    })
  })

  assert.equal(requests[0].situation['salarié . temps de travail . heures supplémentaires'], `${4 * 52 / 12} heure/mois`)
  assert.equal(result.overtimeHours, 4 * 52 / 12)
  assert.equal(result.grossCalculated, 2300)
  assert.ok(result.baseGross < 2300, 'Le salaire de base 35 h doit être inférieur au brut total 39 h')
  assert.equal(result.overtimePay, 250)
  assert.equal(requests.length, 2, 'Le calibrage doit converger sans connaître le taux de majoration')
})

test('active le taux personnalisé après annualisation du net imposable', async () => {
  const requests = []
  const result = await calculateWithUrssafApi(scenario({ modeImpot: 'personnalisé', tauxPAS: 10 }), {
    fetchImpl: mockFetch(body => {
      requests.push(body)
      return response(apiResponse(body.expressions))
    })
  })

  assert.equal(requests.length, 2)
  const request = requests[1]
  assert.equal(request.situation['impôt . méthode de calcul'], "'taux personnalisé'")
  assert.equal(request.situation['impôt . taux personnalisé'], '10.000000%')
  assert.equal(request.situation['impôt . revenu imposable'], '22560.00 €/an')
  assert.equal(result.netAfterTax, 1700)
  assert.equal(result.incomeTax, 1320)
  assert.equal(result.calculatedTaxRate, 10)
  assert.equal(result.mealTicketEmployee, 84)
  assert.equal(result.mealTicketAmount, 168)
})

test('alimente l’assiette annuelle officielle du taux neutre', async () => {
  const requests = []
  await calculateWithUrssafApi(scenario({ modeImpot: 'neutre' }), {
    fetchImpl: mockFetch(body => {
      requests.push(body)
      return response(apiResponse(body.expressions))
    })
  })

  assert.equal(requests.length, 2)
  assert.equal(requests[1].situation['impôt . revenu imposable'], '22560.00 €/an')
  assert.equal(requests[1].situation['paramètres . impôt . revenu imposable'], '22560.00 €/an')
})

test('configure le barème officiel avec revenu annuel et foyer fiscal', async () => {
  const requests = []
  await calculateWithUrssafApi(scenario({
    modeImpot: 'barème',
    situationFamille: 'célibataire',
    enfantsACharge: 1,
    parentIsole: true
  }), {
    fetchImpl: mockFetch(body => {
      requests.push(body)
      return response(apiResponse(body.expressions))
    })
  })

  assert.equal(requests.length, 2)
  const request = requests[1]
  assert.equal(request.situation['impôt . méthode de calcul'], "'barème standard'")
  assert.equal(request.situation['impôt . revenu imposable'], '22560.00 €/an')
  assert.equal(request.situation["paramètres . impôt . revenu d'activité"], '22560.00 €/an')
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
  await assert.rejects(
    calculateWithUrssafApi(scenario({ modeImpot: 'barème' }), {
      fetchImpl: mockFetch(() => response(apiResponse([])))
    }),
    /situationFamille doit être renseignée/
  )
})

test('transmet les autres revenus imposables du foyer en couple et exige une valeur explicite', async () => {
  let request
  await calculateWithUrssafApi(scenario({
    modeImpot: 'barème',
    situationFamille: 'couple',
    enfantsACharge: 1,
    autresRevenusImposables: 24000
  }), {
    fetchImpl: mockFetch(body => {
      request = body
      return response(apiResponse(body.expressions))
    })
  })

  assert.equal(
    request.situation['impôt . foyer fiscal . revenu imposable . autres revenus imposables'],
    '24000.00 €/an'
  )
  assert.equal(request.situation["paramètres . impôt . revenu d'activité"], '22560.00 €/an')

  await assert.rejects(
    calculateWithUrssafApi(scenario({
      modeImpot: 'barème',
      situationFamille: 'couple',
      enfantsACharge: 0
    }), {
      fetchImpl: mockFetch(() => response(apiResponse([])))
    }),
    /autresRevenusImposables doit être renseigné/
  )

  await calculateWithUrssafApi(scenario({
    modeImpot: 'barème',
    situationFamille: 'couple',
    enfantsACharge: 0,
    autresRevenusImposables: 0
  }), {
    fetchImpl: mockFetch(body => {
      assert.equal(
        body.situation['impôt . foyer fiscal . revenu imposable . autres revenus imposables'],
        '0.00 €/an'
      )
      return response(apiResponse(body.expressions))
    })
  })
})

test('remonte les variables par défaut et avertissements de l’API', async () => {
  const result = await calculateWithUrssafApi(scenario(), {
    fetchImpl: mockFetch(body => response(apiResponse(body.expressions, {
      evaluate: body.expressions.map(expression => ({
        nodeValue: expression === 'salarié . rémunération . brut' ? 2300 : 100,
        missingVariables: { 'salarié . contrat . statut cadre': 1 }
      })),
      warnings: [
        { message: 'Une règle expérimentale a été utilisée.' },
        { message: 'Une règle expérimentale a été utilisée.' }
      ]
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

  await assert.rejects(calculateWithUrssafApi(scenario({ brut: -1 }), { fetchImpl }), /brut/)\n  await assert.rejects(calculateWithUrssafApi(scenario({ brut: 0 }), { fetchImpl }), /brut/)
  await assert.rejects(calculateWithUrssafApi(scenario({ dureeType: '37' }), { fetchImpl }), /dureeType/)
  await assert.rejects(calculateWithUrssafApi(scenario({ joursResto: 2.5 }), { fetchImpl }), /entier/)
  await assert.rejects(calculateWithUrssafApi(scenario({ modeImpot: 'personnalisé' }), { fetchImpl }), /tauxPAS/)
  await assert.rejects(calculateWithUrssafApi(scenario({ date: '2026-02-31' }), { fetchImpl }), /date calendaire valide/)
  assert.equal(calls, 0)
})
