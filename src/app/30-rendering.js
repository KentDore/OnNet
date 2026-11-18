// ---------- Rendu des cartes ----------
function num(id, key, uid, value, opts){
  const o = opts || {};
  return `<input type="text" inputmode="decimal" id="${id}" value="${String(value).replace('.', ',')}"
    data-id="${uid}" data-key="${key}"
    ${o.min !== undefined ? `data-min="${o.min}"` : ''}
    ${o.max !== undefined ? `data-max="${o.max}"` : ''}>`;
}

function renderCard(s, r, showRemove){
  const uid = s.id;
  const isRef = s.id === refId;
  const trWarn = !!(r && r.tr && r.tr.reintegre > 0.005);
  const calculationError = getCalculationError(s);
  const trMotifs = {
    sous50: 'Part patronale sous 50 % : vérifiez la valeur reconnue par le moteur Urssaf.',
    sur60: 'Part patronale au-delà de 60 % : vérifiez la valeur reconnue par le moteur Urssaf.',
    plafond: 'Le moteur Urssaf identifie une fraction de titres-restaurant non déductible.',
    api: 'Le moteur Urssaf identifie une part non déductible des frais professionnels transmis.'
  };
  const resultState = r ? 'ready' : (calculationError ? 'error' : 'pending');
  const resultText = r
    ? 'Calculé via l’API officielle Mon-entreprise (Urssaf).'
    : (calculationError || 'Calcul en attente de validation par l’API Urssaf.');
  return `
  <div class="card ${isRef ? 'is-ref' : ''} ${s.id === justAddedId ? 'card-enter' : ''}" data-card="${uid}" data-result-state="${resultState}">
    <div class="card-top">
      <button type="button" class="drag-handle" draggable="true" data-drag-handle="${uid}" aria-label="Déplacer la tuile ${esc(s.name)}. Utilisez les flèches gauche et droite pour la réordonner au clavier." aria-keyshortcuts="ArrowLeft ArrowRight" title="Cliquer et glisser pour réorganiser">⠿</button>
      <label class="sr-only" for="f-name-${uid}">Nom du salaire</label>
      <input class="name-input" id="f-name-${uid}" value="${esc(s.name)}" data-id="${uid}" data-key="name">
      ${isRef ? '<span class="ref-badge">référence</span>' : ''}
      ${showRemove ? `<button class="remove-btn" data-remove="${uid}" aria-label="Supprimer le salaire ${esc(s.name)}">✕</button>` : ''}
    </div>

    <div class="hero">
      <div class="hero-value" id="c-hero-${uid}" aria-live="polite">${r && heroValue(r) !== null ? fmt(heroValue(r)) : '—'}</div>
      <div class="hero-label" id="c-herolabel-${uid}">${heroLabel()}</div>
      <div class="result-source ${calculationError ? 'result-error' : ''}" id="c-result-state-${uid}" role="status" ${r ? 'hidden' : ''}>${esc(resultText)}</div>
      <div class="result-source" id="c-result-warnings-${uid}" ${r && r.warnings && r.warnings.length ? '' : 'hidden'}>${r && r.warnings && r.warnings.length ? `<details><summary>Voir les messages (${r.warnings.length})</summary><ul>${r.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></details>` : ''}</div>
    </div>

    <div class="scenario-edit-hint">
      Les paramètres du contrat se modifient depuis le bouton « Modifier cette offre ».
      ${r ? `Taux effectif : <strong>${r.tauxEffectif.toFixed(1)} %</strong> du brut` : 'Taux effectif : —'}
    </div>

    <details class="more">
      <summary>Détails avancés</summary>
      <div class="more-body">
        <div class="section-tag">Lieu de travail</div>
    <div class="field-row">
      <label for="f-commune-${uid}">Commune de l’établissement</label>
      <input type="text" id="f-commune-${uid}" value="${esc(communeLabel(s))}" data-id="${uid}" data-key="commune" maxlength="120" autocomplete="off" aria-autocomplete="list" aria-controls="commune-suggestions-${uid}">
      <div class="commune-suggestions" id="commune-suggestions-${uid}" role="listbox" hidden></div>
      <div class="sub-hint" id="commune-hint-${uid}">${s.codePostal && s.departement ? `Lieu identifié : ${esc(s.codePostal)} — ${esc(s.departement)}. Le nom de la commune et son département sont transmis à l’API Urssaf.` : 'Choisissez une suggestion pour confirmer le code postal et le département.'}</div>
    </div>
    <div class="section-tag">Mutuelle</div>
        <div class="two-col">
          <div class="field-row">
            <label for="f-mutuelle-${uid}">Part salarié (€ / mois)</label>
            ${num(`f-mutuelle-${uid}`,'mutuelle',uid,s.mutuelle,{min:0})}
          </div>
          <div class="field-row">
            <label for="f-mutuelle-pat-${uid}">Part employeur (€ / mois)</label>
            ${num(`f-mutuelle-pat-${uid}`,'mutuellePat',uid,s.mutuellePat,{min:0})}
          </div>
        </div>
        <div class="sub-hint">Les deux parts sont transmises séparément au moteur Urssaf.</div>
        <div class="section-tag">Titres restaurant</div>
        <div class="three-col">
          <div class="field-row"><label for="f-jours-${uid}">Jours/mois</label>${num(`f-jours-${uid}`,'joursResto',uid,s.joursResto,{min:0,max:31})}</div>
          <div class="field-row"><label for="f-valeur-${uid}">Valeur (€)</label>${num(`f-valeur-${uid}`,'valeurResto',uid,s.valeurResto,{min:0,max:500})}</div>
          <div class="field-row"><label for="f-part-${uid}">Part salarié (%)</label>${num(`f-part-${uid}`,'partResto',uid,s.partResto,{min:40,max:50})}</div>
        </div>
        <div class="alert alert-warn" id="c-trwarn-${uid}" style="${trWarn ? '' : 'display:none;'}">
          <span>${ICON.warn}</span><span id="c-trwarn-text-${uid}">${trWarn ? (trMotifs[r.tr.motif] || trMotifs.api) : ''}</span>
        </div>
        <div class="section-tag">Mensualités &amp; primes</div>
        <div class="two-col">
          <div class="field-row">
            <label for="f-nbmois-${uid}">Mensualités / an</label>
            ${num(`f-nbmois-${uid}`,'nbMois',uid,s.nbMois,{min:1,max:24})}
          </div>
          <div class="field-row">
            <label for="f-primes-${uid}">Primes annuelles (€)</label>
            ${num(`f-primes-${uid}`,'primes',uid,s.primes,{min:0})}
          </div>
        </div>
        <div class="sub-hint">La version actuelle calcule 12 mensualités sans prime libre. Un scénario avec 13ᵉ/14ᵉ mois ou prime reste indisponible tant que cette donnée n'est pas raccordée à l'API Urssaf.</div>
      </div>
    </details>
  </div>`;
}

// ---------- Carte fantôme d'ajout de salaire ----------
function renderAddCard(){
  return `
  <button type="button" class="card card-add" id="addScenario" aria-label="Ajouter un salaire">
    <span class="card-add-icon">${ICON.plus}</span>
    <span class="card-add-label">Ajouter un salaire</span>
  </button>`;
}

// ---------- Graphique empilé de répartition ----------
const STACK_COLORS = { cotis:'var(--stack-cotis)', mutuelle:'var(--gold)', tr:'var(--stack-tr)', net:'var(--accent)' };

function getMealTicketTotal(scenario, result){
  const employee = result?.tr?.totalSalarie;
  const employer = result?.tr?.totalEmployeur;
  const hasEmployee = employee !== null && employee !== undefined && Number.isFinite(Number(employee));
  const hasEmployer = employer !== null && employer !== undefined && Number.isFinite(Number(employer));
  if(hasEmployee && hasEmployer){
    return Math.max(0, Number(employee)) + Math.max(0, Number(employer));
  }
  // Repli d'affichage lorsque l'un des deux montants est absent de la réponse :
  // nombre de titres déclarés × valeur faciale saisie.
  return Math.max(0, Number(scenario?.joursResto) || 0) * Math.max(0, Number(scenario?.valeurResto) || 0);
}

function renderSalaryNetSummary(netSansTR, trTotal, netAvecTR){
  const rows = trTotal > 0.5
    ? [
      { label:'Net sans TR', value:netSansTR },
      { label:'TR — total des deux parts', value:trTotal },
      { label:'Net avec TR', value:netAvecTR, final:true }
    ]
    : [{ label:'Net', value:netAvecTR, final:true }];
  return `<div class="salary-net-summary" aria-label="Récapitulatif du net et des titres-restaurant">${rows.map(row =>
    `<div class="salary-net-summary-row${row.final ? ' is-final' : ''}"><span>${row.label}</span><strong>${fmt(row.value)}</strong></div>`
  ).join('')}</div>`;
}

function renderStack(computed){
  const sorted = [...computed].sort((a,b) => b.r.m.netApres - a.r.m.netApres);
  const maxBrut = Math.max(...computed.map(x => x.r.m.brutTotal), 1);
  const maxPx = 240;
  const ref = computed.find(x => x.s.id === refId) || computed[0];
  return sorted.map(({s, r}) => {
    const m = r.m;
    const cotis = m.cotisNettes, mutuelle = m.mutuelle, tr = r.tr.totalSalarie;
    const trTotal = getMealTicketTotal(s, r);
    const net = m.netApres, netSansTR = m.netSocial, brut = m.brutTotal;
    const scale = maxPx / maxBrut, delta = net - ref.r.m.netApres;
    const cls = delta > 0 ? 'pos' : (delta < 0 ? 'neg' : '');
    const pxCotis = Math.max(0, Math.round(cotis * scale)), pxMutuelle = Math.max(0, Math.round(mutuelle * scale));
    const pxTr = Math.max(0, Math.round(tr * scale)), pxNet = Math.max(0, Math.round(net * scale));
    const barHtml = `
      <div class="stack-bar-stage">
        <div class="stack-bar">
          <div class="stack-seg stack-seg-cotis" style="height:${pxCotis}px" title="Cotisations sociales : ${fmt(cotis)}" role="img" aria-label="Cotisations sociales : ${fmt(cotis)}"></div>
          <div class="stack-seg stack-seg-mutuelle" style="height:${pxMutuelle}px" title="Mutuelle : ${fmt(mutuelle)}" role="img" aria-label="Mutuelle : ${fmt(mutuelle)}"></div>
          <div class="stack-seg stack-seg-tr" style="height:${pxTr}px" title="Titres restaurant (part salariale) : ${fmt(tr)}" role="img" aria-label="Titres restaurant, part salariale : ${fmt(tr)}"></div>
          <div class="stack-seg stack-seg-net" style="height:${pxNet}px" title="Net bancaire : ${fmt(net)}" role="img" aria-label="Net bancaire : ${fmt(net)}"><span class="stack-net-tag">net</span></div>
        </div>
      </div>`;
    return `
    <div class="stack-col ${s.id === refId ? 'is-ref' : ''} ${s.id === justAddedId ? 'card-enter' : ''}" ${s.id !== refId ? `data-setref="${s.id}" role="button" tabindex="0" aria-label="Définir ${esc(s.name)} comme salaire de référence"` : 'aria-current="true"'}>
      <div class="stack-brut">brut ${fmt(brut)}</div>${barHtml}
      <div class="stack-ref-row"><span class="stack-ref-dot ${s.id === refId ? 'is-ref' : ''}" aria-hidden="true"></span><span class="stack-name" title="${esc(s.name)}">${esc(s.name)}</span></div>
      ${renderSalaryNetSummary(netSansTR, trTotal, net + trTotal)}
      <div class="stack-delta ${cls}">${fmtSigned(delta)}</div>
    </div>`;
  }).join('');
}

function renderStackLegend(){
  return `
  <div class="legend-item"><span class="legend-swatch" style="background:${STACK_COLORS.net}"></span>Net</div>
  <div class="legend-item"><span class="legend-swatch" style="background:${STACK_COLORS.tr}"></span>Titres restaurant</div>
  <div class="legend-item"><span class="legend-swatch" style="background:${STACK_COLORS.mutuelle}"></span>Mutuelle</div>
  <div class="legend-item"><span class="legend-swatch" style="background:${STACK_COLORS.cotis}"></span>Cotisations sociales</div>`;
}

function renderWaterfall(computed){
  const { s, r } = computed[0];
  const m = r.m;
  const brut = Math.max(0, m.brutTotal);
  const net = Math.max(0, m.netApres);
  const deductions = Math.max(0, brut - net);
  const ratio = brut > 0 ? Math.max(0, Math.min(100, net / brut * 100)) : 0;
  const netSansTR = Math.max(0, m.netSocial);
  const trTotal = getMealTicketTotal(s, r);
  return `
  <div class="waterfall">
    ${renderSalaryNetSummary(netSansTR, trTotal, net + trTotal)}
    <div class="wf-stack" role="img" aria-label="Salaire brut : ${fmt(brut)} ; net bancaire : ${fmt(net)} ; retenues sur le brut : ${fmt(deductions)}">
      <span class="wf-stack-net" style="width:${ratio.toFixed(3)}%"></span>
      <span class="wf-stack-deductions" style="width:${(100-ratio).toFixed(3)}%"></span>
    </div>
    <div class="wf-bar-legend" aria-hidden="true">
      <span class="wf-bar-legend-item"><span class="wf-key wf-key-net"></span>Net bancaire</span>
      <span class="wf-bar-legend-item"><span class="wf-key wf-key-deductions"></span>Retenues sur le brut</span>
    </div>
  </div>`;
}

const HOURLY_METRICS = new Set(['netHoraire', 'brutHoraire']);

function getComparisonPeriodConfig(){
  if(maquetteComparisonPeriod==='hour') return {
    key:'hour', label:'Net horaire', unit:'h',
    factor:weekly=>1, format:fmtHoraire, formatSigned:fmtHoraireSigned
  };
  if(maquetteComparisonPeriod==='year') return {
    key:'year', label:'Net annuel', unit:'an',
    factor:weekly=>weekly*52, format:fmt, formatSigned:fmtSigned
  };
  return {
    key:'month', label:'Net mensuel', unit:'mois',
    factor:weekly=>weekly*52/12, format:fmt, formatSigned:fmtSigned
  };
}

function getComparisonNetValue(item, config){
  if(!item?.r) return null;
  const weekly=Number(item.s?.dureeType);
  const hourly=Number(item.r.netHoraire);
  if(!Number.isFinite(weekly)||weekly<=0||!Number.isFinite(hourly)) return null;
  return hourly*config.factor(weekly);
}

function renderInsight(computed){
  if(computed.length<2) return '';
  const config=getComparisonPeriodConfig();
  const reference=computed.find(x=>x.s.id===refId)||computed[0];
  const referenceValue=getComparisonNetValue(reference,config);
  if(referenceValue===null) return '';
  const candidates=computed
    .map(item=>({item,value:getComparisonNetValue(item,config)}))
    .filter(entry=>entry.value!==null);
  if(candidates.length<2) return '';
  const best=candidates.reduce((a,b)=>b.value>a.value?b:a);
  const delta=best.value-referenceValue;
  if(Math.abs(delta)<(config.key==='hour'?0.01:1)){
    return '<div class="insight neutral">Les offres affichent un net estimé très proche sur cette période.</div>';
  }
  if(best.item.s.id===reference.s.id){
    return '<div class="insight neutral">L’offre de référence présente le net estimé le plus élevé.</div>';
  }
  const deltaText=config.formatSigned(delta)+(config.key==='hour'?'':' / '+config.unit);
  return '<div class="insight"><span class="insight-caption">ÉCART AVEC LA RÉFÉRENCE</span><strong>'+esc(best.item.s.name)+'</strong><span> apporte </span><strong>'+deltaText+'</strong><span> par rapport à '+esc(reference.s.name)+'.</span></div>';
}

function renderComparisonCards(computed){
  const config=getComparisonPeriodConfig();
  const reference=computed.find(x=>x.s.id===refId)||computed[0];
  const referenceValue=getComparisonNetValue(reference,config);
  return computed.map(({s,r},index)=>{
    const item={s,r};
    const value=getComparisonNetValue(item,config);
    const weekly=Number(s.dureeType);
    const delta=value===null||referenceValue===null?null:value-referenceValue;
    const deltaClass=delta===null?'':delta>0.01?'is-positive':delta< -0.01?'is-negative':'is-neutral';
    const deltaHtml=s.id===refId
      ? '<span class="comparison-reference-note">Offre de référence</span>'
      : delta===null
        ? '<span class="comparison-reference-note">Écart indisponible</span>'
        : '<div class="comparison-offer-delta '+deltaClass+'"><strong>'+config.formatSigned(delta)+'</strong><span>'+(config.key==='hour'?'vs ':'/ '+config.unit+' vs ')+esc(reference.s.name)+'</span></div>';
    const trTotal=getMealTicketTotal(s,r);
    const details=trTotal>0.5
      ? '<details class="offer-net-details"><summary>Détail des titres-restaurant</summary>'+renderSalaryNetSummary(r.m.netSocial,trTotal,r.netApres+trTotal)+'</details>'
      : '';
    const referenceAction=s.id===refId
      ? '<span class="offer-reference-label">Référence</span>'
      : '<button type="button" class="offer-reference-select" data-set-offer-reference="'+s.id+'" aria-label="Choisir cette offre comme référence">Choisir réf.</button>';
    return '<article class="comparison-offer-card '+(s.id===refId?'is-reference':'')+'" data-comparison-offer="'+s.id+'">'+
      '<header class="comparison-offer-head"><div><span class="comparison-offer-index">OFFRE '+(index+1)+'</span><h3>'+esc(s.name)+'</h3></div>'+referenceAction+'</header>'+
      '<div class="comparison-offer-value-label">'+config.label+' · avant impôt</div>'+
      '<div class="comparison-offer-value">'+(value===null?'—':config.format(value))+(value===null||config.key==='hour'?'':'<small>/ '+config.unit+'</small>')+'</div>'+
      '<div class="comparison-offer-meta"><span>Brut : '+fmt(s.brut)+' / mois</span><span>'+weekly.toLocaleString('fr-FR')+' h / semaine</span></div>'+
      deltaHtml+
      details+
      '</article>';
  }).join('');
}

function renderBars(computed){
  const ref = computed.find(x => x.s.id === refId) || computed[0];
  const isHourly = HOURLY_METRICS.has(metric);
  const fmtV = isHourly ? fmtHoraire : fmt;
  const fmtD = isHourly ? fmtHoraireSigned : fmtSigned;
  const vals = computed.map(x => x.r[metric]);
  const maxVal = Math.max(...vals.map(v => Math.abs(v)), 1);
  return computed.map(({s, r}) => {
    const v = r[metric];
    const pct = Math.max(3, Math.round((Math.abs(v)/maxVal)*100));
    const delta = v - ref.r[metric];
    const cls = delta > 0 ? 'pos' : (delta < 0 ? 'neg' : '');
    return `
    <div class="bar-row">
      <div class="bar-top">
        <span class="bar-name" title="${esc(s.name)}">${esc(s.name)}${s.id===refId ? ' · réf.' : ''}</span>
        <span class="bar-value"><span>${fmtV(v)}</span><span class="bar-delta ${cls}">${fmtD(delta)}</span></span>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');
}

function renderAlerts(computed){
  const out = [];
  const nbMoisSet = new Set(computed.map(x => x.s.nbMois));
  // Le graphique affiche toujours du net mensuel : l'écart est trompeur dès que
  // les salaires comparés n'ont pas le même nombre de mensualités.
  if(nbMoisSet.size > 1){
    out.push(`<div class="alert alert-info"><span>${ICON.info}</span><span>Ces salaires n'ont pas le même nombre de mois de paie. Comparez le <strong>net annuel</strong> pour un écart représentatif.</span></div>`);
  }
  return out.join('');
}


function benchmarkDelta(value, reference){
  const delta = value - reference;
  const pct = reference > 0 ? delta / reference * 100 : 0;
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
  return { amount: sign + fmt(Math.abs(delta)), pct: (delta > 0 ? '+' : '') + pct.toLocaleString('fr-FR',{maximumFractionDigits:1,minimumFractionDigits:1}) + ' %', positive: delta >= 0 };
}
function renderBenchmarks(computed){
  const smicState = urssafSessionState.getOfficialSmicState();
  const item=computed.find(x=>x.s.id===refId);
  if(!item) return '';
  const {s,r}=item;
  const weeklyHours=Number(s.dureeType), userMonthlyHours=weeklyHours*52/12;
  const medianNetBeforeTax=2238, medianNetHourly=medianNetBeforeTax/HEURES_BASE;
  const factor=maquetteComparisonPeriod==='hour'?1:maquetteComparisonPeriod==='year'?userMonthlyHours*12:userMonthlyHours;
  const unit=maquetteComparisonPeriod==='hour'?'heure':maquetteComparisonPeriod==='year'?'an':'mois';
  const format=maquetteComparisonPeriod==='hour'?fmtHoraire:fmt;
  const medianValue=medianNetHourly*factor;
  const smicResult=getCachedSmicResult();
  const smicGross=getSmicGross();
  const smicGrossTarget=smicGross===null?null:getSmicGrossTarget(smicGross,weeklyHours);
  const smicHourlyGross=smicGross/HEURES_BASE;
  const userNetBeforeTax=r?Math.max(0,r.netApres):null;
  const userNetHourly=userNetBeforeTax===null?null:(userMonthlyHours>0?userNetBeforeTax/userMonthlyHours:0);
  const userValue=userNetHourly===null?null:userNetHourly*factor;
  const gapText=value=>(value>=0?'+':'−')+format(Math.abs(value))+(maquetteComparisonPeriod==='hour'?'':' / '+unit);
  const gapClass=value=>value>=0?'benchmark-positive':'benchmark-negative';
  const durationLabel=weeklyHours.toLocaleString('fr-FR')+' h';
  const smicNetHourly=smicResult?Math.max(0,smicResult.netApres)/userMonthlyHours:null;
  const smicValue=smicNetHourly===null?null:smicNetHourly*factor;
  const smicGap=userValue===null||smicValue===null?null:userValue-smicValue;
  const medianGap=userValue===null?null:userValue-medianValue;
  const smicStatus=smicState.status==='error'
    ? 'Repère SMIC indisponible via l’API officielle. Réessayez le calcul.'
    : 'Le repère net sera récupéré auprès de l’Urssaf après votre autorisation.';
  const smicCard=`
      <article class="benchmark-item">
        <div class="benchmark-label">SMIC net</div>
        <div class="benchmark-value">${smicValue===null?'À calculer':format(smicValue)}</div>
        <div class="benchmark-meta">${smicValue===null?esc(smicStatus):'Par '+unit+' · repère '+durationLabel}</div>
        ${smicGap===null?'<div class="benchmark-result">Écart disponible après calcul</div>':'<div class="benchmark-result '+gapClass(smicGap)+'">'+gapText(smicGap)+'</div>'}
        ${smicResult?`<details class="benchmark-details"><summary>Comment est calculé l’écart ?</summary>
          <p>Le SMIC net est estimé par l’API officielle Mon-entreprise / Urssaf sur une base de ${durationLabel}${weeklyHours===39?' : 35 h au SMIC + 4 h supplémentaires hebdomadaires majorées à 25 %':''}. Pour les périodes mensuelle et annuelle, le repère est calculé sur cette même durée. Il est calculé sans mutuelle ni titres-restaurant.</p>
          <p>${weeklyHours===39?`Brut mensuel de référence à 35 h : ${fmt(smicGross)}. Brut total estimé à 39 h : ${fmt(smicGrossTarget)}, avec 4 h supplémentaires hebdomadaires majorées à 25 %.`:`Brut mensuel de référence : ${fmt(smicGross)}.`} Taux horaire brut de base : ${fmtHoraire(smicHourlyGross)}. Règle consultée le ${smicState.checkedAt?new Date(smicState.checkedAt).toLocaleDateString('fr-FR'):'—'}.</p>
          <p><a href="https://www.urssaf.fr/accueil/outils-documentation/taux-baremes/montant-smic.html" target="_blank" rel="noopener noreferrer">Source officielle : Urssaf — montant du SMIC</a></p>
        </details>`:''}
      </article>`;
  const medianCard=`
      <article class="benchmark-item">
        <div class="median-card-head"><div class="benchmark-label">Médiane des salaires privés</div></div>
        <div class="benchmark-meta">Référence statistique · INSEE 2025 · France</div>
        <div class="benchmark-value">${format(medianValue)}</div>
        <div class="benchmark-period">Net estimé · par ${unit}</div>
        <div class="benchmark-gap-label">Écart avec la médiane</div>
        ${medianGap===null?'<div class="benchmark-result">Écart disponible après calcul</div>':'<div class="benchmark-result '+gapClass(medianGap)+'">'+gapText(medianGap)+'</div>'}
        <details class="benchmark-details"><summary>Que signifie la médiane ?</summary>
          <p>Données INSEE 2025, publiées en 2026, pour la France. La médiane publiée est de 2 238 € nets mensuels en EQTP. Le taux horaire est ramené à 151,67 h/mois ; les périodes mensuelle et annuelle sont ajustées à la durée du contrat comparé (${durationLabel}).</p>
          <p>Le champ couvre les salariés du privé en France, y compris alternants, stagiaires et contrats aidés ; il exclut l’agriculture et les particuliers employeurs. Il est plus large que le périmètre CDI non-cadre d’OnNet.</p>
          <p>Source : <a href="https://www.insee.fr/fr/statistiques/9087193" target="_blank" rel="noopener noreferrer">INSEE, salaires dans le secteur privé en 2025</a>.</p>
        </details>
      </article>`;
  return '<div class="benchmark-grid">'+smicCard+medianCard+'</div>';
}
// ---------- Rendu ----------
let maquetteComparisonPeriod='month';


function renderMaquetteControls(computedOverride){
  // Synchronise l'état accessible et visuel des périodes après chaque rendu.
  document.querySelectorAll('[data-maquette-period]').forEach(button=>{
    button.setAttribute('aria-pressed',String(button.dataset.maquettePeriod===maquetteComparisonPeriod));
  });
  // Les repères SMIC et médiane restent dans le panneau Comparaison.
  const tabs=document.getElementById('maquetteOfferTabs');
  if(tabs) tabs.replaceChildren();
  if(tabs) scenarios.forEach((scenario,index)=>{
    const item=document.createElement('div');
    item.className='offer-tab-item';
    const button=document.createElement('button');
    button.type='button';button.className='offer-tab'+(scenario.id===refId?' active':'');
    button.setAttribute('aria-pressed',String(scenario.id===refId));
    const name=document.createElement('span');name.className='offer-tab-name';name.textContent=scenario.name;button.append(name);
    const small=document.createElement('small');small.textContent=index===0?'Actuelle':'Proposition';button.append(small);
    button.addEventListener('click',()=>{refId=scenario.id;saveState();render();});
    item.append(button);
    const actions=document.createElement('div');actions.className='offer-tab-actions';
    if(scenarios.length>1){
      const remove=document.createElement('button');remove.type='button';remove.className='offer-tab-action is-danger';remove.textContent='×';remove.setAttribute('aria-label','Supprimer '+scenario.name);remove.title='Supprimer ce poste';
      remove.addEventListener('click',event=>{event.stopPropagation();removeScenario(scenario.id);});
      actions.append(remove);
    }
    item.append(actions);tabs?.append(item);
  });
  const summary=document.getElementById('maquetteYourSalary');
  if(summary){
    const allComputed=computedOverride||getCurrentComputed();
    summary.innerHTML=allComputed.map(({s,r},index)=>{
      const weekly=Number(s.dureeType), hoursMonth=weekly*52/12;
      const hourly=r && Number.isFinite(r.netHoraire)?r.netHoraire:null;
      const factor=maquetteComparisonPeriod==='hour'?1:maquetteComparisonPeriod==='year'?weekly*52:hoursMonth;
      const value=hourly===null?null:hourly*factor;
      return '<article class="offer-comparison-card '+(s.id===refId?'is-reference':'')+'">'+
        '<div class="offer-comparison-card-head"><div><span class="offer-comparison-index">OFFRE '+(index+1)+'</span><h4 class="offer-comparison-name">'+esc(s.name)+'</h4></div><div class="offer-comparison-card-actions">'+(s.id===refId?'<span class="offer-reference-label">Référence</span>':'<button type="button" class="offer-reference-select" data-set-offer-reference="'+s.id+'" aria-label="Choisir cette offre comme référence">Choisir réf.</button>')+(allComputed.length>1?'<button type="button" class="offer-comparison-remove" data-delete-offer="'+s.id+'" aria-label="Supprimer '+esc(s.name)+'">×</button>':'')+'</div></div>'+
        '<div class="offer-comparison-meta">Contrat : '+fmt(s.brut)+' brut/mois · '+fmt(s.brut*12)+' brut/an · '+weekly+' h</div>'+
        '<button type="button" class="offer-comparison-edit" data-edit-offer="'+s.id+'">Modifier cette offre <span aria-hidden="true">→</span></button>'+
      '</article>';
    }).join('');
    if(summary.dataset.editBound!=='true'){
      summary.addEventListener('click',event=>{
        const remove=event.target.closest('[data-delete-offer]');
        if(remove){removeScenario(Number(remove.dataset.deleteOffer));return;}
        const reference=event.target.closest('[data-set-offer-reference]');
        if(reference){
          refId=Number(reference.dataset.setOfferReference);
          saveState();
          render();
          return;
        }
        const button=event.target.closest('[data-edit-offer]');
        if(!button)return;
        const scenario=findScenario(Number(button.dataset.editOffer));
        if(!scenario) return;
        showEditScenarioModal(scenario).then(answers=>{
          if(!answers) return;
          Object.assign(scenario,answers);
          grantUrssafConsent();
          saveState();
          render();
          scheduleUrssafCalculations(false,false);
        });
      });
      summary.dataset.editBound='true';
    }
  }
  const status=document.getElementById('urssafStatus'), mount=document.getElementById('maquetteUrssafMount');
  if(status && mount && status.parentElement!==mount) mount.appendChild(status);
}

function renderComparisonChart(computed){
  const hasSalaryResults=computed.length>0&&computed.every(item=>!!item.r);
  const comparePanel=document.getElementById('comparePanel');
  if(comparePanel) comparePanel.hidden=!hasSalaryResults;

  const hint=document.getElementById('stackHint');
  const insight=document.getElementById('insightBox');
  const chart=document.getElementById('stackChart');
  const scroll=comparePanel?.querySelector('.stack-chart-scroll');
  const legend=document.getElementById('stackLegend');
  const alerts=document.getElementById('barsAlerts');
  const bars=document.getElementById('barsBody');

  [hint,insight,scroll].filter(Boolean).forEach(element=>{element.hidden=!hasSalaryResults;});
  if(legend){legend.innerHTML='';legend.hidden=true;}
  if(alerts){alerts.innerHTML='';alerts.hidden=true;}
  if(bars) bars.innerHTML='';
  if(!chart) return;

  if(!hasSalaryResults){
    chart.className='comparison-offer-grid';
    chart.innerHTML='';
    if(hint) hint.textContent='La comparaison apparaîtra après validation des calculs par l’API Urssaf.';
    if(insight) insight.innerHTML='';
    return;
  }

  const config=getComparisonPeriodConfig();
  if(hint) hint.textContent=config.label+' · net avant impôt estimé par l’API Urssaf.';
  if(insight) insight.innerHTML=renderInsight(computed);
  chart.className='comparison-offer-grid';
  chart.innerHTML=renderComparisonCards(computed);

  if(chart.dataset.comparisonReferenceBound!=='true'){
    chart.addEventListener('click',event=>{
      const button=event.target.closest('[data-set-offer-reference]');
      if(!button) return;
      refId=Number(button.dataset.setOfferReference);
      saveState();
      render();
    });
    chart.dataset.comparisonReferenceBound='true';
  }
}

function render(){
  if(!scenarios.some(s => s.id === refId)) refId = scenarios[0].id;
  const computed = getCurrentComputed();
  renderComparisonChart(computed);
  updateRaiseBaseName();
  bindRefPickers();
  document.getElementById('benchmarkBody').innerHTML = renderBenchmarks(computed);
  renderMaquetteControls(computed);
    document.getElementById('refSelect').innerHTML = scenarios
    .map(s => `<option value="${s.id}" ${s.id===refId?'selected':''}>${esc(s.name)}</option>`).join('');
  document.getElementById('cardsBody').innerHTML =
    computed.map(({s,r}) => renderCard(s, r, scenarios.length > 1)).join('') + renderAddCard();
  bindCardDragAndDrop();
  document.querySelectorAll('#cardsBody .card-enter, #stackChart .card-enter').forEach(el => {
    el.addEventListener('animationend', () => el.classList.remove('card-enter'), { once:true });
  });

  document.querySelectorAll('.metric-toggle button').forEach(b => {
    b.setAttribute('aria-pressed', b.dataset.metric === metric ? 'true' : 'false');
  });
  setHTML('metricHint', metricHints[metric] || '');

  document.querySelectorAll('.card').forEach(cardEl => {
    const id = parseInt(cardEl.dataset.card, 10);
    const d = cardEl.querySelector('details.more');
    if(d){
      if(openCardIds.has(id)) d.open = true;
      d.addEventListener('toggle', () => {
        if(d.open) openCardIds.add(id); else openCardIds.delete(id);
        saveState();
      });
    }
  });

  bindScenarioInputs();
  updateNavButtons();
  saveState();
  suppressAutosave = false;
  justAddedId = null;
  updateUrssafStatus(computed);
  renderMaquetteControls(computed);
  scheduleUrssafCalculations(false,false);
}

function bindCardDragAndDrop(){
  const cardsBody = document.getElementById('cardsBody');
  if(cardsBody.dataset.dragBound) return;
  cardsBody.dataset.dragBound = 'true';

  const clearDropTargets = () => {
    cardsBody.querySelectorAll('.drop-before, .drop-after').forEach(card => {
      card.classList.remove('drop-before', 'drop-after');
    });
  };

  cardsBody.addEventListener('dragstart', e => {
    const handle = e.target.closest('[data-drag-handle]');
    const card = handle && handle.closest('.card[data-card]');
    if(!card) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', card.dataset.card);
    requestAnimationFrame(() => card.classList.add('is-dragging'));
  });

  cardsBody.addEventListener('dragover', e => {
    const target = e.target.closest('.card[data-card]');
    if(!target || target.classList.contains('card-add')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearDropTargets();
    const before = e.clientX < target.getBoundingClientRect().left + target.offsetWidth / 2;
    target.classList.add(before ? 'drop-before' : 'drop-after');
  });

  cardsBody.addEventListener('drop', e => {
    const target = e.target.closest('.card[data-card]');
    if(!target || target.classList.contains('card-add')) return;
    e.preventDefault();
    const draggedId = Number(e.dataTransfer.getData('text/plain'));
    const targetId = Number(target.dataset.card);
    if(!Number.isInteger(draggedId) || draggedId === targetId) return clearDropTargets();

    const from = scenarios.findIndex(s => s.id === draggedId);
    if(from < 0) return clearDropTargets();
    const before = e.clientX < target.getBoundingClientRect().left + target.offsetWidth / 2;
    const [moved] = scenarios.splice(from, 1);
    const targetIndex = scenarios.findIndex(s => s.id === targetId);
    if(targetIndex < 0){
      scenarios.splice(from, 0, moved);
      return clearDropTargets();
    }
    scenarios.splice(targetIndex + (before ? 0 : 1), 0, moved);
    render();
  });

  cardsBody.addEventListener('dragend', e => {
    const card = e.target.closest('.card[data-card]');
    if(card) card.classList.remove('is-dragging');
    clearDropTargets();
  });

  cardsBody.addEventListener('keydown', e => {
    const handle = e.target.closest('[data-drag-handle]');
    if(!handle || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();

    const id = Number(handle.dataset.dragHandle);
    const from = scenarios.findIndex(s => s.id === id);
    const to = from + (e.key === 'ArrowLeft' ? -1 : 1);
    if(from < 0 || to < 0 || to >= scenarios.length) return;

    const [moved] = scenarios.splice(from, 1);
    scenarios.splice(to, 0, moved);
    render();
    const nextHandle = cardsBody.querySelector(`[data-drag-handle="${id}"]`);
    if(nextHandle) nextHandle.focus();
    showToastImpl(`${moved.name} déplacé à la position ${to + 1} sur ${scenarios.length}.`);
  });
}

function bindScenarioInputs(){
  document.querySelectorAll('#cardsBody [data-key]').forEach(el => {
    if(el.type === 'checkbox'){
      el.addEventListener('change', onCheck);
    } else if(el.tagName === 'SELECT'){
      el.addEventListener('change', onStructural);
    } else {
      el.addEventListener('input', onInput);
      el.addEventListener('blur', onBlurClamp);
    }
  });
  document.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', () => removeScenario(parseInt(btn.dataset.remove, 10)));
  });
  document.querySelectorAll('[data-duree]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.id, 10);
      const s = findScenario(id);
      if(!s) return;
      if(s.dureeType === btn.dataset.duree) return;
      s.dureeType = btn.dataset.duree;
      render();
    });
  });
}

function bindRefPickers(){
  document.querySelectorAll('[data-setref]').forEach(el => {
    el.addEventListener('click', () => {
      refId = parseInt(el.dataset.setref, 10);
      render();
    });
    el.addEventListener('keydown', (e) => {
      if(e.key === 'Enter' || e.key === ' '){
        e.preventDefault();
        refId = parseInt(el.dataset.setref, 10);
        render();
      }
    });
  });
}

