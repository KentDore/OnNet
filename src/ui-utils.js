"use strict";

// Utilitaires d'interface uniquement. Aucun calcul de cotisations, de net ou d'impôt.
// Les montants de paie proviennent exclusivement de l'API officielle Mon-entreprise / Urssaf.
let scenarioDefaults = {
  mutuelle: 30, joursResto: 0, valeurResto: 0,
  partResto: 50, nbMois: 12
};

const ICON = {
  info: '<svg aria-hidden="true" class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>',
  warn: '<svg aria-hidden="true" class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
  plus: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>'
};

const HEURES_BASE = 151.67;

function parseNum(v){
  if(v === null || v === undefined) return 0;
  const s = String(v).replace(/\s/g,'').replace(',', '.');
  if(!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
function clamp(n, min, max){
  if(typeof min === 'number' && n < min) return min;
  if(typeof max === 'number' && n > max) return max;
  return n;
}
function fmt(n){
  return Number.isFinite(Number(n)) ? Math.round(Number(n)).toLocaleString('fr-FR') + ' €' : '—';
}
function fmtHoraire(n){
  return Number.isFinite(Number(n))
    ? Number(n).toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2}) + ' €/h'
    : '—';
}
function fmtHoraireSigned(n){
  if(!Number.isFinite(Number(n))) return '—';
  const value = Number(n);
  const s = Math.abs(value).toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2});
  return (value > 0 ? '+' : (value < 0 ? '−' : '')) + s + ' €/h';
}
function fmtSigned(n){
  if(!Number.isFinite(Number(n))) return '—';
  const value = Number(n);
  const s = Math.round(Math.abs(value)).toLocaleString('fr-FR');
  return (value > 0 ? '+' : (value < 0 ? '−' : '')) + s + ' €';
}
function esc(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
