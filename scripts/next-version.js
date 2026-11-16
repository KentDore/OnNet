'use strict'

function parseVersion(value) {
  if (!/^\\d+\\.\\d+\\.\\d+$/.test(value || '')) {
    throw new Error('Version attendue au format MAJOR.MINOR.PATCH : ' + value)
  }
  return value.split('.').map(Number)
}

function compareVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1
  }
  return 0
}

function nextVersion(branchVersion, baseVersion, title, body = '') {
  // Ne jamais écraser une version explicitement avancée dans la PR.
  if (compareVersions(branchVersion, baseVersion) > 0) return branchVersion

  const baseline = compareVersions(branchVersion, baseVersion) < 0
    ? baseVersion
    : branchVersion
  const [major, minor, patch] = parseVersion(baseline)
  const text = String(title || '').trim()
  const breaking = /(?:^[a-z][a-z0-9-]*(?:\\([^)]*\\))?!:)|BREAKING CHANGE|BREAKING-CHANGE/i.test(text + '\\n' + body)
  const feature = /^(?:feat|feature)(?:\\([^)]*\\))?:/i.test(text)

  if (breaking) return `${major + 1}.0.0`
  if (feature) return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

if (require.main === module) {
  const [branchVersion, baseVersion, title, ...bodyParts] = process.argv.slice(2)
  if (!branchVersion || !baseVersion || !title) {
    throw new Error('Usage: node scripts/next-version.js VERSION_BRANCHE VERSION_BASE TITRE_PR [CORPS_PR]')
  }
  process.stdout.write(nextVersion(branchVersion, baseVersion, title, bodyParts.join(' ')))
}

module.exports = { nextVersion, compareVersions }
