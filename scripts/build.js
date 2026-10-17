'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

async function main(){
  const version = process.argv[2];
  if(!version || !/^\d+\.\d+\.\d+$/.test(version)){
    throw new Error('Usage: node scripts/build.js MAJOR.MINOR.PATCH [output-path]');
  }
  const root = path.resolve(__dirname, '..');
  const template = await fs.readFile(path.join(root, 'src', 'template.html'), 'utf8');
  const styles = await fs.readFile(path.join(root, 'src', 'styles.css'), 'utf8');
  const calc = await fs.readFile(path.join(root, 'src', 'calc.js'), 'utf8');
  const app = await fs.readFile(path.join(root, 'src', 'app.js'), 'utf8');
  let html = template;
  for(const [token, value] of [
    ['@@ONNET_VERSION@@', version],
    ['@@ONNET_STYLES@@', styles],
    ['@@ONNET_CALC@@', calc],
    ['@@ONNET_APP@@', app]
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
