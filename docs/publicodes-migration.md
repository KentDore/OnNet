# Migration du calcul brut → net vers Publicodes / modèle Urssaf

Statut au 12 novembre 2026 : ce document décrit la conception initiale et les étapes historiques de la migration. L’intégration est désormais réalisée dans `main` et publiée sur GitHub Pages. Les mentions « non publiée » ci-dessous sont historiques. Pour l’état actuellement livré et ses limites, consulter le [README](../README.md) et la [feuille de route de migration](complete-migration-roadmap.md).

## Décision

L’API REST officielle Mon-entreprise / Urssaf est le seul moteur de calcul du calculateur principal sur cette branche. L’ancien fichier `src/calc.js` n’est plus embarqué dans le build. Le paquet `modele-social` / `publicodes` reste disponible pour les tests de parité et diagnostics, jamais comme solution de repli en production.

## Sources officielles vérifiées

- Modèle social et exemple d'intégration : https://github.com/betagouv/mon-entreprise/tree/master/modele-social
- README du paquet : https://github.com/betagouv/mon-entreprise/blob/master/modele-social/README.md
- Métadonnées du paquet : https://github.com/betagouv/mon-entreprise/blob/master/modele-social/package.json
- Paquet npm : https://www.npmjs.com/package/modele-social
- Documentation de l'API Publicodes : https://publi.codes/docs/api/publicodes/classes/engine
- Configuration du simulateur salarié officiel : https://github.com/betagouv/mon-entreprise/blob/master/site/source/pages/simulateurs/salari%C3%A9/simulationConfig.ts

Le modèle officiel `modele-social@11.1.0` est sous licence MIT et déclare `publicodes` comme peer dependency (`^1.0.4`). La branche OnNet utilise actuellement `modele-social@11.1.0` et `publicodes@1.10.4`, versions exactes déclarées dans `package.json`. Le `package-lock.json` est commité et l'intégration continue utilise `npm ci` pour installer l'arbre verrouillé. Le dépôt officiel déclare de son côté `publicodes` en `^1.8.1` dans son application API.

## Architecture cible — API officielle comme source unique

Décision retenue : les résultats de calcul affichés par OnNet doivent provenir de l'API officielle Mon-entreprise / Urssaf (`POST /api/v1/evaluate`). Aucun calcul local de cotisations ou d'impôt, aucune formule fiscale maison et aucun repli vers un moteur local ne sont autorisés pour produire un résultat utilisateur.

1. L'adaptateur OnNet convertit les champs saisis en situation Publicodes avec les identifiants et unités officiels.
2. L'API officielle évalue les règles et renvoie les valeurs affichées : brut calculé, net avant impôt, net imposable, cotisations et, si demandé, net après impôt, montant d'impôt et taux.
3. Le paquet local `modele-social` / `publicodes` reste réservé aux tests de parité et diagnostics de développement. Il ne doit jamais remplacer silencieusement l'API dans l'application.
4. En cas d'indisponibilité, de réponse incomplète ou de variables manquantes bloquantes, OnNet doit expliquer que le calcul n'a pas pu être confirmé, plutôt que produire une estimation locale présentée comme officielle.
5. Les comparaisons, sauvegardes et données personnelles restent côté navigateur autant que possible. Les paramètres nécessaires au calcul ne sont transmis à l’API Urssaf qu’après action explicite et la portée de cette transmission est annoncée dans l’interface.

Les seules opérations locales tolérées sont des conversions d'unités ou de représentation nécessaires pour construire la situation (par exemple convertir un brut total 39 h en salaire de base + heures supplémentaires, ou annualiser une rémunération mensuelle récurrente si la règle fiscale attend une assiette annuelle). Ces transformations doivent être documentées, testées et ne doivent jamais remplacer une règle de calcul Urssaf. Les hypothèses de saisie (statut cadre, convention collective, majoration, situation familiale, etc.) doivent être explicites et modifiables lorsque pertinentes.

**Limite importante :** utiliser l'API officielle ne garantit pas un résultat exhaustif pour toutes les situations. Le modèle fiscal comporte des règles signalées comme expérimentales/simplifiées. OnNet devra exposer les avertissements du moteur et ne pas présenter le résultat comme un avis d'imposition ni comme un bulletin de paie garanti conforme.

## Correspondance initiale des données

Les noms ci-dessous sont ceux des règles officielles du modèle salarié. Les unités d'entrée doivent suivre exactement les exemples du dépôt officiel : `heure/mois` pour les heures supplémentaires dans le moteur (même si les exemples de paramètres d'URL affichent parfois `heures/mois`), `titre-restaurant/mois` pour le nombre et `€/titre-restaurant` pour le montant unitaire. Le client transmet `établissement . commune` pour chaque scénario. La valeur initiale est Pacé et l’utilisateur peut la modifier dans les détails du salaire.

| Donnée OnNet | Situation Publicodes envisagée |
|---|---|
| Statut non-cadre | `salarié . contrat . statut cadre = non` |
| Contrat privé standard | `salarié = 'CDI'` |
| Brut mensuel à 35 h | `salarié . contrat . salaire brut` |
| Heures sup d'un 39 h | `salarié . temps de travail . heures supplémentaires = 4 × 52 / 12 heure/mois` |
| Part mutuelle salarié + employeur | `salarié . cotisations . prévoyances . santé . montant` = total des deux parts |
| Part employeur mutuelle | `salarié . cotisations . prévoyances . santé . taux employeur` = part employeur / montant total |
| Titres-restaurant | `salarié . rémunération . frais professionnels . titres-restaurant . nombre`, `. montant unitaire` et `. taux employeur` |
| Prime d'activité | `salarié . rémunération . primes . activité . base` |
| 13e mois | `salarié . rémunération . primes . fin d'année` |

Le modèle officiel définit les heures supplémentaires en heures par mois. Pour rester cohérent avec l'ancien calcul OnNet, le prototype transmet désormais 4 × 52 / 12, soit 17,333333… h/mois pour un contrat à 39 h ; 17,33 h/mois est l'arrondi usuel affiché. Il applique par défaut 25 % sur les huit premières heures supplémentaires hebdomadaires, puis 50 % au-delà, sauf règle conventionnelle applicable. Le calcul des titres-restaurant est maintenant actif dans le prototype. Le premier essai local avait remonté une erreur d'unité et des diagnostics de cycles avec la configuration par défaut de Publicodes. L'adaptateur utilise désormais les mêmes options de moteur que l'API officielle (`deprecatedSyntax: false`, `cyclicReferences: false`) ; le scénario avec 21 titres à 8 € et une participation employeur de 50 % passe en local et correspond à l'API.

### Conversion du brut OnNet en 39 h

Le champ brut actuel d'OnNet représente le montant brut mensuel total, heures supplémentaires incluses. Le modèle officiel attend le salaire contractuel de base hors heures supplémentaires et calcule celles-ci séparément.

Il faudra donc convertir le brut total OnNet en salaire de base selon le nombre d'heures supplémentaires et leur majoration, ou mieux ajouter un mode de saisie explicite du brut de base et des heures supplémentaires si cela améliore l'expérience. Toute conversion doit être testée contre le montant brut total restitué par Publicodes. Ne pas conserver silencieusement deux définitions différentes du champ « brut ».

## Hypothèses et limites à rendre visibles

L'API officielle renvoie encore des avertissements sur certaines règles marquées expérimentales (notamment des branches BTP, convention collective ou activité partielle). Le moteur local suit les options de diagnostic de l'API, qui désactivent les avertissements de syntaxe obsolète et de références cycliques. La réussite des scénarios ciblés ne signifie pas que toutes les règles du modèle sont exemptes d'avertissements. Le modèle officiel couvre beaucoup plus de paramètres qu'OnNet n'en demande aujourd'hui. Les résultats dépendent notamment de la date du calcul, du temps de travail, du statut cadre, de la localisation de l'établissement, de la convention collective, de certaines caractéristiques de l'entreprise et des éléments variables de rémunération.

Pour une première version, OnNet peut rester limité au CDI privé non-cadre en métropole, sans activité partielle, avec une majoration standard des heures supplémentaires. Les paramètres non saisis doivent être explicitement documentés comme hypothèses. Ne pas présenter cette configuration standard comme un bulletin de paie garanti conforme à toutes les conventions et entreprises.

La mutuelle doit être convertie depuis les deux montants existants vers un montant total et un taux employeur. Il faudra avertir lorsque la part employeur est inférieure au minimum modélisé de 50 %, et vérifier le cas où le montant total est nul.

L’impôt sur le revenu est désormais demandé à l’API avec le mode choisi (barème standard ou taux personnalisé) et les informations du foyer nécessaires. Le net avant impôt et le net payé après PAS restent deux résultats distincts ; les limites expérimentales du modèle fiscal doivent rester visibles.

## Résultats et parité API officielle (11/11/2026)

Exécution reproductible dans GitHub Actions avec le modèle daté du 11 novembre 2026, CDI privé non-cadre, commune de Pacé :

| Scénario | Brut calculé | Net avant impôt | Net imposable |
|---|---:|---:|---:|
| 2 300 € brut, 39 h, mutuelle 30 € + 30 €, sans titres | 2 300,01 € | 1 820,28 € | 1 648,86 € |
| 2 300 € brut, 35 h, mutuelle 30 € + 30 €, sans titres | 2 300,00 € | 1 787,76 € | 1 884,17 € |
| 2 300 € brut, 39 h, sans mutuelle ni titres | 2 300,01 € | 1 853,19 € | 1 650,90 € |
| 2 300 € brut, 39 h, mutuelle 30 € + 30 €, 21 titres de 8 € à 50/50 | 2 300,01 € | 1 736,28 € | 1 648,86 € |

### Extension des scénarios de seuil (11/11/2026)

La matrice automatisée compte maintenant neuf scénarios, soit 63 valeurs comparées à l'API officielle, avec un écart de 0 sur les valeurs arrondies à deux décimales :

- 1 800 € et 1 900 € brut mensuel à 35 h ;
- 3 990 € et 4 020 € brut mensuel, de part et d'autre du plafond mensuel de Sécurité sociale 2026 (4 005 €) ;
- 8 000 € brut mensuel pour solliciter la tranche 2 de retraite complémentaire ;
- les quatre scénarios déjà testés, dont 39 h avec heures supplémentaires et titres-restaurant.

**Précaution :** le scénario à 1 800 € est uniquement un point de test mathématique situé sous le SMIC mensuel de référence ; ce n'est pas une recommandation de rémunération légale pour un temps plein. Le SMIC horaire applicable en métropole est de 12,31 € à la date de cette vérification, soit environ 1 867 € brut mensuel pour 151,67 h. Source : [simulateur officiel Urssaf](https://mon-entreprise.urssaf.fr/simulateurs/salaire-brut-net). Le plafond mensuel de Sécurité sociale 2026 est de 4 005 € : [source Urssaf](https://www.urssaf.fr/accueil/outils-documentation/taux-baremes/plafonds-securite-sociale.html).

Le test des heures supplémentaires vérifie la formule de rémunération à 25 % sur le scénario 39 h. Un diagnostic séparé teste aussi le palier à 50 % avec 43,33 h/mois (environ 10 h/semaine), sans étendre pour autant les choix de durée proposés par l'interface actuelle (35 h ou 39 h).

### Comparaison avec le service officiel

Le script `scripts/compare-urssaf-api.mjs` interroge `POST https://mon-entreprise.urssaf.fr/api/v1/evaluate`, endpoint documenté dans `api/source/openapi.yaml` du dépôt officiel. Il transmet les mêmes situations au moteur local et à l'API distante puis compare sept valeurs : brut, net avant impôt, net imposable, cotisations salariales, rémunération des heures supplémentaires, part salariale de mutuelle et part employeur de mutuelle.

Résultat au 11/11/2026 : **28 valeurs sur 28 identiques au centime près** sur les quatre scénarios ci-dessus. Le test est automatisé dans GitHub Actions et échoue si un écart dépasse 0,03 €.

Le scénario avec titres-restaurant donne un net avant impôt de 1 736,28 €, contre 1 820,28 € sans titres, soit 84 € de retenue salariale (21 × 8 € × 50 %). Le montant et la participation employeur respectent les paramètres de ce test.

Le diagnostic `scripts/diagnose-overtime-50.mjs` utilise un salaire de base de 3 000 € et 43,33 h supplémentaires/mois. Le moteur local et l'API officielle renvoient tous deux 1 114,19 € de rémunération d'heures supplémentaires (écart 0,00 €). Ce résultat est supérieur au calcul si toutes les heures étaient majorées à 25 % (1 071,32 €) et inférieur au calcul si elles étaient toutes majorées à 50 % (1 285,59 €), ce qui confirme le cumul des deux paliers dans ce scénario. Le diagnostic remonte 12 avertissements de règles expérimentales : la parité ne supprime pas ces avertissements et ne valide pas toutes les situations de paie.

Le brut reconstitué à 39 h ressort à 2 300,01 € côté moteur local comme côté API officielle, pour une entrée OnNet de 2 300 €. C'est un écart d'arrondi commun aux deux moteurs dans cette inversion de salaire de base ; il n'affecte pas les sept écarts comparés, mais il faudra décider comment l'afficher et le documenter.

Ces scénarios démontrent une parité entre la version npm installée et l'API officielle pour les cas testés. Ils ne constituent pas une preuve générale pour toutes les situations de paie ni une validation complète de toutes les règles. Les calculs officiels sont eux-mêmes présentés comme indicatifs et ne couvrent pas toutes les situations ou conventions collectives.

## Stratégie de validation

Avant toute bascule :

- comparer des situations à 35 h et 39 h, sans prime, sans mutuelle et sans titres-restaurant ;
- comparer les heures supplémentaires avec majoration standard ;
- tester le brut sous, proche et au-dessus du plafond de sécurité sociale ;
- tester les parts de mutuelle distinctes et les titres-restaurant ;
- vérifier le net avant impôt et le détail de chaque retenue ;
- étendre les tests de parité API à plusieurs niveaux de brut (notamment sous, proche et au-dessus du plafond de sécurité sociale) ;
- ajouter des tests de non-régression pour le stockage, le partage, le rendu et la compilation HTML autonome ;
- vérifier que le HTML produit ne dépend d'aucun CDN ni d'une connexion Internet.

Les tests doivent couvrir les règles à la date courante du modèle, puis être rejoués lors de chaque mise à jour de dépendance.

## Séquencement proposé

La séquence initiale de prototype est terminée sur la branche de migration :
1. le build autonome principal embarque le client API officiel et les seuls utilitaires de présentation ;
2. les résultats du comparateur, des cartes, des graphiques et du repère SMIC proviennent des réponses API ;
3. aucun calcul local ne remplace une réponse indisponible ;
4. les scénarios non encore pris en charge (primes libres et mensualités différentes de 12) sont bloqués ;
5. les tests CI et navigateur utilisent des réponses simulées ; les scénarios live Urssaf et la vérification CORS réelle restent des critères de sortie avant publication.

## État d'avancement

- [x] Branche de migration créée à partir de l'état actuel de la branche principale.
- [x] Modèle npm officiel, licence et interface d'utilisation repérés.
- [x] Principales règles de saisie salarié, heures supplémentaires et mutuelle identifiées.
- [x] Installation des dépendances et verrouillage de l'arbre avec `package-lock.json` ; installation CI via `npm ci`.
- [x] Prototype bundlé et exécuté dans GitHub Actions (HTML autonome généré).
- [x] Comparaison automatisée de neuf scénarios avec l'API officielle (63 sorties comparées, écart nul au centime affiché).
- [x] Scénarios de paie sous/proches du SMIC, de part et d'autre du PMSS 2026 (4 005 €/mois), et au-dessus du PMSS pour tester la tranche 2.
- [x] Test explicite de la formule des heures supplémentaires à 25 % pour le scénario 39 h.
- [ ] Tester les majorations à 50 % : le prototype actuel n'accepte que 35 h et 39 h, donc ne couvre pas plus de 8 heures supplémentaires hebdomadaires.
- [x] Calcul des titres-restaurant réactivé et testé localement + API.
- [ ] Tests de brut sous, proche et au-dessus du plafond de sécurité sociale.
- [ ] Vérification sur l'interface web du simulateur, avec saisie manuelle indépendante.
- [ ] Migration du moteur de production.
