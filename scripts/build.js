'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { build } = require('esbuild');
const { readAppSource, readStylesSource } = require('./source-loader');

async function buildRuntime(root){
  const app = readAppSource(root);
  const contents = [
    "import { initializeThemePreference } from './src/theme-preference.mjs';",
    "import { calculateWithUrssafApi, evaluateUrssafExpression, urssafApiExpressions } from './src/urssaf-api-client.mjs';",
    "import { scenarioDefaults, ICON, HEURES_BASE, parseNum, clamp, fmt, fmtHoraire, fmtHoraireSigned, fmtSigned, esc } from './src/ui-utils.mjs';",
    "import { METRIC_KEYS, METRIC_DEFAUT, sanitizeScenario, normalizeScenarioIds } from './src/state-normalizers.mjs';",
    "import { buildUrssafCalculationKey, unsupportedCalculationReason, buildUrssafInput, mapUrssafResultToOnNet } from './src/urssaf-calculation.mjs';",
    "import { createRateLimitedFetch } from './src/rate-limited-fetch.mjs';",
    "import { buildSmicScenario, getSmicGrossTarget } from './src/smic-reference.mjs';",
    "import { createUrssafCalculationCache } from './src/urssaf-calculation-cache.mjs';",
    "import { createUrssafSessionState } from './src/urssaf-session-state.mjs';",
    "import { deserializePersistedState, serializePersistedState } from './src/persistence-codec.mjs';",
    'window.OnNetUrssafApi = { calculateWithUrssafApi, evaluateUrssafExpression, urssafApiExpressions };',
    'initializeThemePreference({ windowRef: window, documentRef: document });',
    app
  ].join('\n\n');

  const result = await build({
    stdin: {
      contents,
      resolveDir: root,
      sourcefile: 'src/runtime-entry.mjs',
      loader: 'js'
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    treeShaking: true,
    legalComments: 'none'
  });

  if(result.outputFiles.length !== 1){
    throw new Error('Le build doit produire exactement un bundle JavaScript.');
  }
  return result.outputFiles[0].text;
}

async function main(){
  const version = process.argv[2];
  if(!version || !/^\d+\.\d+\.\d+$/.test(version)){
    throw new Error('Usage: node scripts/build.js MAJOR.MINOR.PATCH [output-path]');
  }
  const root = path.resolve(__dirname, '..');
  const template = await fs.readFile(path.join(root, 'src', 'template.html'), 'utf8');
  const styles = readStylesSource(root);
  const runtime = await buildRuntime(root);
  let html = template;
  for(const [token, value] of [
    ['@@ONNET_VERSION@@', version],
    ['@@ONNET_STYLES@@', styles],
    ['@@ONNET_RUNTIME@@', runtime]
  ]){
    if(!html.includes(token)) throw new Error('Template marker missing: ' + token);
    html = html.replace(token, value);
  }
  if(html.includes('@@ONNET_')) throw new Error('Unresolved template marker');
  const output = process.argv[3]
    ? path.resolve(process.argv[3])
    : path.join(root, 'Onnet-' + version + '.html');
  await fs.writeFile(output, html, 'utf8');
  console.log('Built ' + path.relative(root, output));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
