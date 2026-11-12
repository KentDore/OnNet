# OnNet

**Le brut promet. Le net décide.**

OnNet compare plusieurs scénarios de rémunération pour le secteur privé français.

## État du projet

La branche de migration raccorde le calculateur à l’API REST officielle **Mon-entreprise / Urssaf**. Cette version n’est pas publiée tant que la validation et la fusion dans `main` n’ont pas été approuvées. La version GitHub Pages ne change donc pas avec cette branche.

## Source des calculs et confidentialité

Les résultats de rémunération et de prélèvement à la source sont calculés par l’API officielle Mon-entreprise / Urssaf. OnNet n’effectue pas localement les calculs de cotisations ou d’impôt et ne bascule pas vers un ancien moteur en cas d’échec.

À l’ouverture, OnNet interroge la règle officielle `SMIC` pour actualiser le repère. Cet appel ne transmet que la règle demandée et sa date, sans salaire ni données personnelles de paie. Si l’API ne répond pas, OnNet signale l’indisponibilité au lieu de réutiliser silencieusement une ancienne valeur.

Les simulations salariales nécessitent un accord explicite avant le premier envoi. L’interface indique les paramètres transmis à l’API : salaire, durée du travail, commune, mutuelle, titres-restaurant et situation fiscale. Après accord, les modifications sont recalculées automatiquement. Le choix de consentement peut être mémorisé sur l’appareil. Une connexion Internet est indispensable.

Les résultats restent des estimations. Ils ne remplacent ni un bulletin de paie vérifié ni un avis d’imposition. Les avertissements et variables recevant une valeur par défaut doivent être pris en compte.

## Fonctionnalités et périmètre

- Comparaison de plusieurs salaires, graphiques, réorganisation des cartes et simulation d’augmentation.
- Contrat CDI du secteur privé non-cadre, à temps plein.
- Scénarios 35 h et 39 h. Le mode 39 h modélise un contrat de 35 h avec 4 heures supplémentaires rémunérées par semaine, au taux de droit commun de 25 %. Les taux particuliers des conventions collectives et les RTT ne sont pas pris en compte.
- Recherche et confirmation de la commune de l’établissement via l’API officielle geo.api.gouv.fr (Pacé par défaut).
- Saisie séparée de la mutuelle salariale et patronale. La valeur préremplie est de 30 € par part, soit 30 € déduits du salaire chaque mois et 30 € financés par l’employeur. La validation suppose une complémentaire santé obligatoire financée à au moins 50 % par l’employeur ; les cas d’exemption ou régimes particuliers ne sont pas couverts.
- Titres-restaurant : nombre, valeur et part salariale paramétrables dans les limites du modèle Urssaf.
- Prélèvement à la source : taux personnalisé, taux neutre ou barème standard du modèle.
- Repère SMIC brut récupéré par la règle officielle `SMIC`, et net avant impôt calculé via la même API.
- Sauvegarde locale, partage par URL, impression et export PDF via le navigateur.

## Limites connues

- Les conventions collectives particulières, le temps partiel, les cadres, la fonction publique et certains régimes spécifiques ne sont pas couverts.
- Les avantages en nature, primes libres, 13e/14e mois, remboursements de transport spécifiques, DFS et taux réduits particuliers ne sont pas paramétrables. Les situations qui ne peuvent pas être calculées de façon fiable doivent être signalées ou bloquées.
- Le scénario 39 h repose sur l’hypothèse de droit commun décrite ci-dessus ; il ne doit pas être interprété comme un calcul adapté à chaque convention collective.
- Le net annuel affiché est le net mensuel multiplié par 12 ; ce n’est pas une simulation annuelle indépendante.
- Le partage par URL encode les données sélectionnées dans le fragment de l’adresse. Ce contenu n’est ni chiffré ni protégé par mot de passe : ne partagez que les informations nécessaires.

## Développement et tests

Le client API est dans `src/urssaf-api-client.mjs`. Le build autonome `index.html` embarque ce client et ne doit pas être modifié indépendamment des sources.

Tests automatisés :

```sh
npm ci
npm run test:all
node --test test/ui.test.js
node --test test/build.test.js
```

Les tests navigateur nécessitent Playwright et Chromium ; la CI les installe automatiquement.

Le smoke test `node scripts/smoke-urssaf-api.mjs` vérifie des réponses réelles de l’API (SMIC, 35 h / 39 h, mutuelle, titres-restaurant et modes fiscaux), avec des contrôles de cohérence internes. Il ne constitue pas une validation indépendante de l’exactitude des montants. Le diagnostic comparatif avec le moteur Publicodes local est séparé et ne doit pas être utilisé comme preuve de conformité réglementaire.
