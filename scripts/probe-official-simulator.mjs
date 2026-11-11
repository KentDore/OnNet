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
  await page.waitForTimeout(5000)
  const body = await page.locator('body').innerText({ timeout: 15000 })
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
    diagnostics: body.split('\n').filter(line => /pas pu être appliqués|erreur|indisponible|pas encore défini|salaire net après impôt/i.test(line)).slice(0, 20)
  }, null, 2))
} finally {
  await browser.close()
}
