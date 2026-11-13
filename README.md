# OnNet

**Le brut promet. Le net décide.**

OnNet compare plusieurs scénarios de rémunération pour le secteur privé français.

## État du projet

Le calculateur publié sur GitHub Pages utilise l’API REST officielle **Mon-entreprise / Urssaf** pour les calculs de paie. Le fichier `index.html` est généré depuis les sources de `src/` lors de la préparation d’une publication.

## Calculs et données transmises

Les calculs de cotisations et de prélèvement à la source sont effectués par l’API Mon-entreprise / Urssaf. OnNet ne reprend pas un ancien moteur local si l’API échoue. L’application effectue localement certaines opérations de présentation et de mise en forme des résultats ; elle ne recalcule pas les cotisations ni l’impôt.

À l’ouverture, OnNet interroge la règle officielle `SMIC` avec la date du jour. Cet appel récupère le repère brut et ne transmet aucune donnée de paie. Le premier calcul salarial démarre lorsque l’utilisateur renseigne et valide le formulaire de salaire : cette saisie vaut accord explicite à la transmission.

Le formulaire indique les paramètres transmis à l’API : salaires comparés, durée du travail, commune de l’établissement (paramètre de calcul Urssaf), mutuelle, titres-restaurant et situation fiscale. Aucun scénario salarial n’est envoyé avant la saisie/validation du formulaire. Après accord, les modifications valides sont recalculées automatiquement, sans bouton de calcul dédié. L’accord n’est pas mémorisé : il est redemandé à chaque ouverture. Une connexion Internet est nécessaire.

Les résultats sont des estimations : ils ne remplacent ni un bulletin de paie vérifié ni un avis d’imposition. Le modèle fiscal Mon-entreprise comporte des règles simplifiées ou expérimentales ; les avertissements et valeurs par défaut doivent être examinés.

## Référence salariale

Le comparatif utilise la médiane nationale des salaires nets du secteur privé en EQTP pour 2025 : 2 238 € par mois, avant impôt sur le revenu. Ces données ont été publiées par l’INSEE le 22 octobre 2026 ([Insee Première n° 2132](https://www.insee.fr/fr/statistiques/9087193)). Le champ statistique inclut les alternants, stagiaires et bénéficiaires de contrats aidés ; il exclut l’agriculture et les particuliers employeurs. Il ne correspond donc pas exactement au périmètre de simulation d’OnNet (CDI non-cadre à temps plein). Cette référence statistique est distincte du calcul individuel réalisé par l’API Mon-entreprise / Urssaf.

## Fonctionnalités et périmètre

- Comparaison de plusieurs scénarios de salaire, graphiques, réorganisation des cartes et simulation d’augmentation.
- CDI du secteur privé, non-cadre, à temps plein.
- Scénarios 35 h et 39 h. Le scénario 39 h représente 35 h auxquelles s’ajoutent 4 heures supplémentaires rémunérées par semaine, selon le droit commun avec une majoration de 25 %. Les taux propres aux conventions collectives et les RTT ne sont pas pris en compte.
- Recherche et confirmation de la commune de l’établissement via l’API officielle geo.api.gouv.fr (Pacé par défaut).
- Mutuelle saisie séparément pour le salarié et l’employeur. Valeur initiale : 30 € par part, soit 30 € déduits du salaire chaque mois et 30 € financés par l’employeur. Le modèle impose une participation employeur d’au moins 50 % pour une complémentaire santé non nulle ; les exemptions et régimes particuliers ne sont pas gérés.
- Titres-restaurant paramétrables en nombre, valeur et part salariale. Le modèle accepte une participation salariale de 40 à 50 % (participation employeur de 50 à 60 %).
- Prélèvement à la source selon le barème du modèle fiscal ou selon un taux personnalisé. Le taux personnalisé reste constant dans les scénarios comparés.
- Foyer fiscal : personne seule, parent isolé, couple marié ou pacsé avec revenus complémentaires renseignables, ou concubinage. En concubinage, les revenus du partenaire ne sont pas intégrés au calcul de l’utilisateur.
- Repère SMIC brut récupéré via la règle officielle `SMIC` ; son net avant impôt est calculé par la même API après consentement. Pour une offre de 39 h, le repère tient compte des 4 heures supplémentaires hebdomadaires majorées à 25 % selon l’hypothèse de droit commun retenue par le simulateur.
- Sauvegarde locale, partage par URL, impression et export PDF via le navigateur.

## Limites connues

- Les conventions collectives particulières, le temps partiel, les cadres, la fonction publique et certains régimes spécifiques ne sont pas couverts.
- Le scénario 39 h repose sur l’hypothèse de droit commun : il ne représente pas nécessairement les règles applicables au contrat réel.
- Les avantages en nature, primes libres, 13e/14e mois, remboursements de transport spécifiques, DFS et taux réduits particuliers ne sont pas paramétrables. Les scénarios incompatibles avec le périmètre sont bloqués plutôt que calculés avec l’ancien moteur.
- Le modèle fiscal est une estimation. Le barème dépend des informations de foyer renseignées ; en concubinage, le revenu du partenaire n’est pas intégré. Le taux personnalisé est appliqué de façon constante aux scénarios et peut donc fausser une comparaison si le taux réel évoluerait avec le salaire.
- Le net annuel affiché correspond au net mensuel multiplié par 12 ; il ne s’agit pas d’une simulation annuelle indépendante.
- Le partage par URL encode les données sélectionnées dans le fragment de l’adresse. Elles ne sont ni chiffrées ni protégées par mot de passe : ne partagez que les informations nécessaires.

## Développement et tests

Le client API se trouve dans `src/urssaf-api-client.mjs`. Le fichier autonome `index.html` est généré par le build et embarque ce client : il ne doit pas être modifié indépendamment des sources.

Tests automatisés :

```sh
npm ci
npm run test:all
node --test test/ui.test.js
node --test test/build.test.js
```

Les tests navigateur nécessitent Playwright et Chromium ; la CI les installe automatiquement. Les parcours navigateur utilisent une API simulée : ils vérifient les interactions, les paramètres transmis et les états d’erreur, mais ne valident pas l’exactitude des montants de paie. La CI standard ne dépend pas de la disponibilité de l’API distante. `npm run test:all` couvre les tests du client API et du prototype Publicodes ; les tests UI et build sont lancés séparément par les deux commandes suivantes.

Le smoke test `node scripts/smoke-urssaf-api.mjs` interroge réellement l’API et contrôle plusieurs scénarios (SMIC, 35 h / 39 h, mutuelle, titres-restaurant et paramètres fiscaux). Il vérifie des cohérences internes, mais ne constitue pas une validation indépendante de l’exactitude des montants. Le diagnostic comparatif avec le moteur Publicodes local est distinct et ne prouve pas la conformité réglementaire.
