import { chromium } from 'playwright'

const params = new URLSearchParams({
  'salaire-brut': '2300€/mois',
  unite: '€/mois',
  'salarié . convention collective': "'droit commun'",
  'impôt . méthode de calcul': "'taux personnalisé'",
  'impôt . taux personnalisé': '10%'
})
const url = `https://mon-entreprise.urssaf.fr/simulateurs/salaire-brut-net?${params.toString()}`
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ locale: 'fr-FR' })
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(3000)
  const closeDialog = page.getByRole('button', { name: /fermer/i })
  if (await closeDialog.count()) {
    await closeDialog.first().click()
    await page.waitForTimeout(1000)
  }
  const collective = page.locator('input[type="radio"][value="droit commun"]')
  if (await collective.count()) {
    await collective.check({ force: true })
    const nextQuestion = page.getByRole('button', { name: /suivant, passer à la question suivante/i })
    if (await nextQuestion.count()) await nextQuestion.first().click()
    await page.waitForTimeout(1000)
  }
  const controls = await page.locator('input, button, select, [role="combobox"]').evaluateAll(elements =>
    elements.slice(0, 100).map(element => ({
      tag: element.tagName,
      type: element.getAttribute('type'),
      id: element.id || null,
      name: element.getAttribute('name'),
      placeholder: element.getAttribute('placeholder'),
      ariaLabel: element.getAttribute('aria-label'),
      role: element.getAttribute('role'),
      value: 'value' in element ? element.value : null,
      text: (element.innerText || element.textContent || '').trim().slice(0, 100)
    }))
  )
  const grossInput = page.locator('[id="salarié___contrat___salaire_brut-input"]')
  await grossInput.fill('2300')
  await grossInput.press('Tab')
  try {
    await page.waitForFunction(() => {
      const net = document.querySelector('[id="salarié___rémunération___net___à_payer_avant_impôt-input"]')
      return net && net.value.trim() !== '€' && net.value.trim() !== ''
    }, null, { timeout: 15000 })
  } catch {
    // Le contenu complet sera consigné pour diagnostiquer un changement du simulateur.
  }
  await page.waitForTimeout(3000)
  const fieldValues = await page.locator('input[type="text"]').evaluateAll(elements =>
    elements.map(element => ({ id: element.id, value: element.value }))
  )
  let shareDialog = null
  let shareValues = []
  const shareButton = page.getByRole('button', { name: /générer un lien de partage/i })
  if (await shareButton.count()) {
    await shareButton.first().click()
    await page.waitForTimeout(500)
    shareDialog = await page.locator('[role="dialog"]').first().innerText().catch(() => null)
    shareValues = await page.locator('input, textarea').evaluateAll(elements =>
      elements.map(element => ({ id: element.id || null, value: 'value' in element ? element.value : '' }))
        .filter(element => element.value.includes('simulateurs/salaire-brut-net'))
    )
  }
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  let payslipLines = []
  const payslipButton = page.getByRole('button', { name: /afficher la fiche de paie/i })
  if (await payslipButton.count()) {
    await payslipButton.first().click()
    await page.waitForTimeout(1000)
  }
  const body = await page.locator('body').innerText({ timeout: 15000 })
  const bodyLines = body.split('\n').map(line => line.trim()).filter(Boolean)
  payslipLines = bodyLines
    .filter(line => /mutuelle|santé|prévoyance|CSG|CRDS|cotisations|contribution|net imposable|net à payer|retraite|retenue/i.test(line))
    .slice(0, 80)
  const healthIndex = bodyLines.findIndex(line => /complémentaire garanties frais de santé obligatoire/i.test(line))
  const payslipContext = {
    health: healthIndex < 0 ? null : bodyLines.slice(Math.max(0, healthIndex - 5), healthIndex + 10),
    csg: (() => {
      const index = bodyLines.findIndex(line => /CSG déductible de l'impôt sur le revenu/i.test(line))
      return index < 0 ? null : bodyLines.slice(Math.max(0, index - 4), index + 8)
    })()
  }
  const labels = [
    'Salaire brut',
    'Salaire net',
    'Salaire net après impôt',
    'Montant net à payer avant impôt sur le revenu',
    'Montant net à payer'
  ]
  const excerpts = Object.fromEntries(labels.map(label => {
    const index = body.indexOf(label)
    return [label, index < 0 ? null : body.slice(Math.max(0, index - 100), Math.min(body.length, index + 300))]
  }))
  console.log(JSON.stringify({
    status: response?.status() ?? null,
    title: await page.title(),
    url,
    excerpts,
    controls,
    fieldValues,
    shareDialog,
    shareValues,
    payslipLines,
    payslipContext,
    diagnostics: body.split('\n').filter(line => /pas pu être appliqués|erreur|indisponible|pas encore défini|salaire net après impôt/i.test(line)).slice(0, 20)
  }, null, 2))
} finally {
  await browser.close()
}
