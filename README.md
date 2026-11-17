# OnNet

**Le brut promet. Le net décide.**

OnNet compare plusieurs scénarios de rémunération pour le secteur privé français.

## État du projet

Le calculateur publié sur GitHub Pages utilise l’API REST officielle **Mon-entreprise / Urssaf** pour les calculs de paie. Les fichiers `index.html` et `Onnet-X.Y.Z.html` sont générés depuis les sources de `src/`. À chaque PR fusionnée, la CI incrémente automatiquement la version selon SemVer à partir du titre : `feat` augmente le mineur, les autres changements augmentent le correctif, et `!` ou `BREAKING CHANGE` augmente le majeur. Une version explicitement avancée dans la PR est conservée. La CI synchronise ensuite `package.json`, le lockfile et les HTML générés dans la branche après la réussite des contrôles.

## Calculs et données transmises

Les calculs de cotisations et de net salarial sont effectués par l’API Mon-entreprise / Urssaf. OnNet ne reprend pas un ancien moteur local si l’API échoue. L’application effectue localement certaines opérations de présentation et de mise en forme des résultats ; elle ne recalcule pas les cotisations.

À l’ouverture, OnNet interroge la règle officielle `SMIC` avec la date du jour. Cet appel récupère le repère brut et ne transmet aucune donnée de paie. Aucun scénario salarial n’est transmis avant une autorisation explicite : elle peut être donnée avec le bouton dédié ou en validant le formulaire de salaire.

Le formulaire indique les paramètres transmis à l’API : salaires comparés, durée du travail, commune de l’établissement (paramètre de calcul Urssaf), mutuelle et titres-restaurant. Après autorisation, la saisie ou la modification du salaire dans le formulaire principal met à jour le scénario et relance automatiquement le calcul ; les changements de période ou de durée du travail sont également pris en compte. L’autorisation est conservée sur cet appareil dans une clé distincte des offres enregistrées, puis réutilisée au rechargement jusqu’à son retrait. Le bouton de retrait supprime uniquement cette autorisation et ne supprime pas les offres. Une connexion Internet est nécessaire.

Les résultats sont des estimations : ils ne remplacent pas un bulletin de paie vérifié. Les avertissements et valeurs par défaut du modèle Urssaf doivent être examinés.

## Référence salariale

Le comparatif utilise la médiane nationale des salaires nets du secteur privé en EQTP pour 2025 : 2 238 € nets par mois. Ces données ont été publiées par l’INSEE le 22 octobre 2026 ([Insee Première n° 2132](https://www.insee.fr/fr/statistiques/9087193)). Le champ statistique inclut les alternants, stagiaires et bénéficiaires de contrats aidés ; il exclut l’agriculture et les particuliers employeurs. Il ne correspond donc pas exactement au périmètre de simulation d’OnNet (CDI non-cadre à temps plein). Cette référence statistique est distincte du calcul individuel réalisé par l’API Mon-entreprise / Urssaf.

## Fonctionnalités et périmètre

- Comparaison de plusieurs scénarios de salaire, graphiques, réorganisation des cartes et simulation d’augmentation.
- CDI du secteur privé, non-cadre, à temps plein.
- Scénarios 35 h et 39 h. Le scénario 39 h représente 35 h auxquelles s’ajoutent 4 heures supplémentaires rémunérées par semaine, selon le droit commun avec une majoration de 25 %. Les taux propres aux conventions collectives et les RTT ne sont pas pris en compte.
- Recherche et confirmation de la commune de l’établissement via l’API officielle geo.api.gouv.fr (Pacé par défaut).
- Mutuelle saisie séparément pour le salarié et l’employeur. Valeur initiale : 30 € par part, soit 30 € déduits du salaire chaque mois et 30 € financés par l’employeur. Le modèle impose une participation employeur d’au moins 50 % pour une complémentaire santé non nulle ; les exemptions et régimes particuliers ne sont pas gérés.
- Titres-restaurant paramétrables en nombre, valeur et part salariale. Le récapitulatif affiche dans cet ordre le net sans TR, le total des deux parts, puis le net avec TR. Le total utilise les montants Urssaf lorsqu’ils sont tous deux disponibles ; sinon, il repose sur le nombre de titres multiplié par leur valeur faciale. Le modèle accepte une participation salariale de 40 à 50 % (participation employeur de 50 à 60 %).
- Repère SMIC brut récupéré via la règle officielle `SMIC` ; son net est calculé par la même API après consentement. Pour une offre de 39 h, le repère tient compte des 4 heures supplémentaires hebdomadaires majorées à 25 % selon l’hypothèse de droit commun retenue par le simulateur.
- Sauvegarde locale, partage par URL, impression et export PDF via le navigateur.

## Limites connues

- Les conventions collectives particulières, le temps partiel, les cadres, la fonction publique et certains régimes spécifiques ne sont pas couverts.
- Le scénario 39 h repose sur l’hypothèse de droit commun : il ne représente pas nécessairement les règles applicables au contrat réel.
- Les avantages en nature, primes libres, 13e/14e mois, remboursements de transport spécifiques, DFS et taux réduits particuliers ne sont pas paramétrables. Les scénarios incompatibles avec le périmètre sont bloqués plutôt que calculés avec l’ancien moteur.
- Le net annuel affiché correspond au net mensuel multiplié par 12 ; il ne s’agit pas d’une simulation annuelle indépendante.
- Le partage par URL encode les données sélectionnées dans le fragment de l’adresse. Elles ne sont ni chiffrées ni protégées par mot de passe : ne partagez que les informations nécessaires.

## Architecture technique

La cartographie des responsabilités, des couplages actuels et de la trajectoire de modularisation est décrite dans [docs/architecture-runtime.md](docs/architecture-runtime.md). Ce document distingue le découpage des fichiers de véritables frontières de modules.

## Développement et tests

Le client API se trouve dans `src/urssaf-api-client.mjs`, les fonctions pures d'interface dans `src/ui-utils.mjs` et la normalisation des scénarios dans `src/state-normalizers.mjs`. Le build les regroupe avec les fragments de `src/app/` grâce à esbuild, dans un seul script de type module embarqué. Le HTML publié reste autonome : aucune requête supplémentaire vers les fichiers source n'est nécessaire. Les fragments applicatifs partagent encore le même espace lexical ; leur modularisation indépendante reste une étape distincte. Les sources se modifient dans `src/app/` et `src/styles/`, pas dans le HTML généré. Le fichier `index.html` est généré depuis ces sources et ne doit pas être modifié indépendamment.

Tests automatisés et contrôles de qualité :

```sh
npm ci
npm run lint
npm run test:all
node --test test/ui.test.js
node --test test/build.test.js
```

`npm run lint` exécute ESLint 10.15.0 et Stylelint 18.0.0 avec des versions fixées dans les scripts. Les règles bloquantes ciblent d’abord les erreurs JavaScript/CSS objectivement dangereuses ; les règles de style JavaScript sont encore en avertissement pour permettre de réduire progressivement la dette sans une réécriture massive. Les outils sont téléchargés à la première exécution s’ils ne sont pas déjà présents.

Les tests navigateur nécessitent Playwright et Chromium ; la CI les installe automatiquement. Les parcours navigateur utilisent une API simulée : ils vérifient les interactions, les paramètres transmis et les états d’erreur, mais ne valident pas l’exactitude des montants de paie. La CI standard ne dépend pas de la disponibilité de l’API distante. `npm run test:all` couvre les tests du client API, du comparateur local de contrôle et des utilitaires de présentation ; les tests UI et build sont lancés séparément par les deux commandes suivantes.

Le smoke test `node scripts/smoke-urssaf-api.mjs` interroge réellement l’API et contrôle plusieurs scénarios (SMIC, 35 h / 39 h, mutuelle et titres-restaurant). Il vérifie des cohérences internes, mais ne constitue pas une validation indépendante de l’exactitude des montants. 
