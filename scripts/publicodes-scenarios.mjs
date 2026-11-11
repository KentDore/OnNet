import { calculatePublicodes } from '../src/publicodes-adapter.mjs'

const scenarios = [
  {
    name: '2300 € brut, 39 h, mutuelle 30/30, sans titres-restaurant',
    input: { brut: 2300, dureeType: '39', mutuelle: 30, mutuellePat: 30, joursResto: 0, valeurResto: 0, date: '2026-11-11' }
  },
  {
    name: '2300 € brut, 35 h, mutuelle 30/30, sans titres-restaurant',
    input: { brut: 2300, dureeType: '35', mutuelle: 30, mutuellePat: 30, joursResto: 0, valeurResto: 0, date: '2026-11-11' }
  },
  {
    name: '2300 € brut, 39 h, sans mutuelle ni titres-restaurant',
    input: { brut: 2300, dureeType: '39', mutuelle: 0, mutuellePat: 0, joursResto: 0, valeurResto: 0, date: '2026-11-11' }
  }
]

for (const scenario of scenarios) {
  const result = calculatePublicodes(scenario.input)
  console.log(JSON.stringify({
    scenario: scenario.name,
    gross: Number(result.grossCalculated.toFixed(2)),
    baseGross: Number(result.baseGross.toFixed(2)),
    overtimeGross: Number(result.overtimePay.toFixed(2)),
    netBeforeTax: Number(result.netBeforeTax.toFixed(2)),
    taxableNet: Number(result.taxableNet.toFixed(2)),
    employeeHealth: Number(result.employeeHealth.toFixed(2)),
    employerHealth: Number(result.employerHealth.toFixed(2))
  }))
}
