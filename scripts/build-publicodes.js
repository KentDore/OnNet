'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')
const esbuild = require('esbuild')

async function main() {
  const root = path.resolve(__dirname, '..')
  const outputDir = path.join(root, 'dist')
  await fs.mkdir(outputDir, { recursive: true })

  const bundle = await esbuild.build({
    entryPoints: [path.join(root, 'src', 'publicodes-adapter.mjs')],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'OnNetUrssaf',
    platform: 'browser',
    target: ['es2020'],
    minify: true,
    legalComments: 'none'
  })

  const templatePath = path.join(root, 'prototype', 'publicodes.html')
  const template = await fs.readFile(templatePath, 'utf8')
  const marker = '<!-- PUBLICODES_BUNDLE -->'
  if (!template.includes(marker)) {
    throw new Error('Marqueur de bundle Publicodes introuvable dans le prototype.')
  }

  const html = template.replace(
    marker,
    `<script>\n${bundle.outputFiles[0].text}\n</script>`
  )
  if (html.includes(marker) || html.includes('@@')) {
    throw new Error('Le HTML généré contient encore un marqueur non résolu.')
  }

  const outputPath = path.join(outputDir, 'Onnet-publicodes-prototype.html')
  await fs.writeFile(outputPath, html, 'utf8')
  console.log(`Prototype autonome généré : ${path.relative(root, outputPath)}`)
}

main().catch(error => {
  console.error(error.stack || error.message)
  process.exitCode = 1
})
