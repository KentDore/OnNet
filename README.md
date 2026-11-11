# OnNet

**Le brut promet. Le net décide.**

OnNet compare plusieurs scénarios de rémunération pour le secteur privé français.

## État de la migration

La branche `migration/publicodes-urssaf` raccorde le calculateur principal à l’API REST officielle **Mon-entreprise / Urssaf**. Cette migration n’est pas encore publiée : `main`, `index.html` et la version actuellement accessible sur GitHub Pages restent inchangés jusqu’à validation et approbation explicite.

## Source des calculs et confidentialité

Les montants de brut reconstitué, de net avant impôt, de net imposable, de cotisations et de prélèvement à la source proviennent de l’API officielle Urssaf. OnNet ne calcule pas localement les cotisations ni l’impôt et ne bascule pas vers un ancien moteur en cas d’échec.

Avant l’envoi, l’utilisateur doit cliquer sur **« Calculer avec l’Urssaf »**. Les données nécessaires (rémunération, horaires, commune de l’établissement, mutuelle, titres-restaurant et situation fiscale) sont alors transmises à l’API. Une connexion Internet est indispensable. Les scénarios, réglages et liens de partage restent gérés dans le navigateur.

Les résultats restent des estimations : le modèle fiscal Urssaf comporte des règles simplifiées ou expérimentales. Les montants ne remplacent ni un bulletin de paie vérifié ni un avis d’imposition. Les avertissements et variables recevant une valeur par défaut sont signalés.

## Fonctionnalités raccordées

- Comparaison de plusieurs salaires, graphiques, réorganisation des cartes et simulation d’augmentation.
- Saisie du brut mensuel, en 35 h ou 39 h ; pour 39 h, OnNet transmet 4 heures supplémentaires par semaine (environ 17,33 h/mois) et laisse le moteur Urssaf calculer leur rémunération. Le scénario force actuellement le droit commun : la majoration standard est de 25 % pour les 8 premières heures supplémentaires hebdomadaires, mais les accords/conventions spécifiques ne sont pas paramétrables dans OnNet.
- CDI du secteur privé non-cadre, droit commun, avec commune de l’établissement modifiable pour chaque salaire (Pacé par défaut).
- Saisie séparée des parts salariale et employeur de mutuelle.
- Titres-restaurant : nombre, valeur et part salariale.
- Impôt au barème standard du modèle ou taux de prélèvement personnalisé.
- Repère SMIC : le montant brut est récupéré via la règle officielle `SMIC` de l’API Mon-entreprise / Urssaf ; le net avant impôt est ensuite calculé par cette même API. Une saisie manuelle reste possible et n’est jamais écrasée automatiquement. Si l’API est indisponible, OnNet signale l’erreur au lieu d’afficher une valeur codée en dur comme actuelle.
- Repère de salaire médian privé : référence INSEE 2024 (2 190 € net mensuel en EQTP).
- Sauvegarde locale, partage par URL, impression et export PDF via le navigateur.

## Limites actuelles

- Le périmètre raccordé est limité au CDI privé non-cadre, à temps plein, en droit commun et aux durées 35 h / 39 h. Les conventions particulières, le temps partiel, les cadres, la fonction publique et certains régimes territoriaux ne sont pas couverts par cette première version.
- Les primes libres et les 13ᵉ/14ᵉ mois ne sont pas encore raccordés : un scénario qui les utilise est bloqué au lieu de recevoir une estimation locale.
- Le net annuel affiché est le net mensuel Urssaf multiplié par 12 ; ce n’est pas une évaluation annuelle indépendante. Le salaire brut annuel saisi à l’onboarding est divisé par 12.
- La commune par défaut est Pacé. Vérifiez ou modifiez cette commune pour chaque poste comparé.
- Le salaire médian est une référence nationale, pas un repère spécifique au métier ou à la région.
- Le module de simulation d’absence a été retiré.

## Données partagées

Les scénarios enregistrés localement restent dans le navigateur. Un lien de partage encode les données sélectionnées dans le fragment de l’URL ; ce contenu n’est ni chiffré ni protégé par mot de passe. N’incluez les détails de paie et la situation fiscale que si nécessaire.

## Développement

Le client API est dans `src/urssaf-api-client.mjs`. `src/ui-utils.js` ne contient que des utilitaires de présentation. Le build autonome embarque le client API et ne charge pas l’ancien calculateur `src/calc.js`. Le paquet local `modele-social` / `publicodes` est conservé pour les diagnostics et tests de parité, pas pour calculer les résultats présentés à l’utilisateur.

Construire un HTML de test sans modifier les fichiers de production :

```sh
npm ci
node scripts/build.js 2.1.6 /tmp/Onnet-migration.html
```

Tests :

```sh
npm run test:prototype
node --test test/calc.test.js
node --test test/build.test.js
node --test test/ui.test.js
```

Les tests navigateur nécessitent Playwright et Chromium ; la CI les installe automatiquement.
