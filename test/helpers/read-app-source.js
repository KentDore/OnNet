'use strict';

const fs = require('node:fs');
const path = require('node:path');

function readAppSource(root = path.resolve(__dirname, '../..')){
  const appDirectory = path.join(root, 'src', 'app');
  const manifestPath = path.join(appDirectory, 'manifest.json');
  const files = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  if(!Array.isArray(files) || files.length === 0 || new Set(files).size !== files.length){
    throw new Error('Le manifeste des sources applicatives est invalide.');
  }

  for(const file of files){
    if(typeof file !== 'string' || !file.endsWith('.js') || file.includes('/') || file.includes('..')){
      throw new Error('Le manifeste contient un nom de fichier applicatif invalide.');
    }
  }

  return files.map(file => fs.readFileSync(path.join(appDirectory, file), 'utf8')).join('');
}

module.exports = { readAppSource };
