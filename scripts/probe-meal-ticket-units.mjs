const endpoint='https://mon-entreprise.urssaf.fr/api/v1/evaluate'
const date=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Paris',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date())
const base={'salarié':'oui','salarié . contrat':"'CDI'",'salarié . contrat . salaire brut':'2300 €/mois','salarié . contrat . statut cadre':'non','salarié . rémunération . frais professionnels . titres-restaurant':'oui','salarié . rémunération . frais professionnels . titres-restaurant . taux employeur':'50%','date':date}
const expressions=['salarié . rémunération . frais professionnels . titres-restaurant . montant','salarié . rémunération . frais professionnels . titres-restaurant . employeur','salarié . rémunération . frais professionnels . titres-restaurant . déductible','salarié . rémunération . frais professionnels . titres-restaurant . déductible . plafond unitaire']
const variants=[
{name:'defaults',values:{}},
{name:'plural-count-singular-unit',values:{'salarié . rémunération . frais professionnels . titres-restaurant . nombre':'21 titres-restaurant/mois','salarié . rémunération . frais professionnels . titres-restaurant . montant unitaire':'8 €/titre-restaurant'}},
{name:'singular-count-singular-unit',values:{'salarié . rémunération . frais professionnels . titres-restaurant . nombre':'21 titre-restaurant/mois','salarié . rémunération . frais professionnels . titres-restaurant . montant unitaire':'8 €/titre-restaurant'}},
{name:'plural-count-plural-unit',values:{'salarié . rémunération . frais professionnels . titres-restaurant . nombre':'21 titres-restaurant/mois','salarié . rémunération . frais professionnels . titres-restaurant . montant unitaire':'8 €/titres-restaurant'}},
{name:'dimensionless-count-singular-unit',values:{'salarié . rémunération . frais professionnels . titres-restaurant . nombre':'21/mois','salarié . rémunération . frais professionnels . titres-restaurant . montant unitaire':'8 €/titre-restaurant'}}
]
const results=[]
for(const v of variants){const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify({situation:{...base,...v.values},expressions})});const p=await r.json();results.push({name:v.name,httpStatus:r.status,values:p.evaluate?.map(x=>({expression:x.expression,nodeValue:x.nodeValue,unit:x.unit,missingVariables:x.missingVariables})),warnings:p.warnings,error:p.error??p.situationError})}
const report={capturedAt:new Date().toISOString(),date,results}
console.log(JSON.stringify(report,null,2))
await import('node:fs/promises').then(({writeFile})=>writeFile('urssaf-meal-ticket-unit-probes.json',JSON.stringify(report,null,2)))
