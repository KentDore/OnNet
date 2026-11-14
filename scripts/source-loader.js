'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FONT_ASSETS = [
  { marker:'@@ONNET_FONT_FRAUNCES_VARIABLE@@', file:'fraunces-variable.b64' },
  { marker:'@@ONNET_FONT_INTER_VARIABLE@@', file:'inter-variable.b64' },
  { marker:'@@ONNET_FONT_IBM_PLEX_MONO_400@@', file:'ibm-plex-mono-400.b64' },
  { marker:'@@ONNET_FONT_IBM_PLEX_MONO_500@@', file:'ibm-plex-mono-500.b64' },
  { marker:'@@ONNET_FONT_IBM_PLEX_MONO_600@@', file:'ibm-plex-mono-600.b64' }
];

function readManifestFiles(root, directory, manifestFile, extension, label){
  const sourceDirectory = path.join(root, 'src', directory);
  const manifestPath = path.join(sourceDirectory, manifestFile);
  const files = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  if(!Array.isArray(files) || files.length === 0 || new Set(files).size !== files.length){
    throw new Error(`Le manifeste ${label} est invalide.`);
  }

  for(const file of files){
    if(typeof file !== 'string' || !file.endsWith(extension) ||
       /[\\\\/]/.test(file) || file.includes('..')){
      throw new Error(`Le manifeste ${label} contient un nom de fichier invalide.`);
    }
  }

  return files.map(file => fs.readFileSync(path.join(sourceDirectory, file), 'utf8')).join('');
}

function readAppSource(root = path.resolve(__dirname, '..')){
  return readManifestFiles(root, 'app', 'manifest.json', '.js', 'applicatif');
}

function readStylesSource(root = path.resolve(__dirname, '..')){
  let styles = readManifestFiles(root, 'styles', 'manifest.json', '.css', 'CSS');
  const fontsDirectory = path.join(root, 'src', 'fonts');

  for(const font of FONT_ASSETS){
    const occurrences = styles.split(font.marker).length - 1;
    if(occurrences !== 1){
      throw new Error(`Le marqueur de police ${font.marker} doit apparaître exactement une fois.`);
    }

    const payload = fs.readFileSync(path.join(fontsDirectory, font.file), 'utf8').trim();
    if(!/^[A-Za-z0-9+/]+={0,2}$/.test(payload)){
      throw new Error(`Le fichier de police ${font.file} contient un encodage Base64 invalide.`);
    }

    styles = styles.replace(font.marker, payload);
  }

  if(styles.includes('@@ONNET_FONT_')){
    throw new Error('Un marqueur de police reste non résolu dans les styles.');
  }

  return styles;
}

module.exports = { readAppSource, readStylesSource };
