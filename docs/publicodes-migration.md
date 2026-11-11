# Migration du calcul brut → net vers Publicodes / modèle Urssaf

Statut : étude technique initiale — branche `migration/publicodes-urssaf`

## Décision

Utiliser le paquet officiel `modele-social` et le moteur `publicodes` comme source des calculs de paie, plutôt que maintenir dans OnNet une seconde implémentation des cotisations et des règles légales.

La migration doit rester progressive. Le moteur actuel ne sera pas supprimé tant que les scénarios de référence ne passent pas les tests de comparaison.

## Sources officielles vérifiées

- Modèle social et exemple d'intégration : https://github.com/betagouv/mon-entreprise/tree/master/modele-social
- README du paquet : https://github.com/betagouv/mon-entreprise/blob/master/modele-social/README.md
- Métadonnées du paquet : https://github.com/betagouv/mon-entreprise/blob/master/modele-social/package.json
- Paquet npm : https://www.npmjs.com/package/modele-social
- Documentation de l'API Publicodes : https://publi.codes/docs/api/publicodes/classes/engine
- Configuration du simulateur salarié officiel : https://github.com/betagouv/mon-entreprise/blob/master/site/source/pages/simulateurs/salari%C3%A9/simulationConfig.ts

Au moment de l'étude, npm affiche `modele-social@11.1.0` (licence MIT). Son `package.json` déclare `publicodes` comme peer dependency avec la plage `^1.0.4`. npm affiche `publicodes@1.10.1` comme version courante. Ces versions sont des candidates à verrouiller dans le lockfile après un test d'installation et de compilation ; elles ne sont pas encore validées dans OnNet.

## Architecture cible

1. Les règles et le moteur sont installés comme dépendances de développement/runtime de compilation.
2. Un adaptateur OnNet transforme les scénarios existants en situation Publicodes et récupère les valeurs numériques via `evaluate(...).nodeValue`.
3. La compilation produit un bundle JavaScript local intégré dans le HTML autonome.
4. Aucun appel à l'API distante de Mon-entreprise n'est nécessaire au calcul. L'application doit continuer à fonctionner hors ligne et les données salariales restent dans le navigateur.
5. L'interface, les comparaisons multi-offres, les sauvegardes locales et le partage restent indépendants du moteur de calcul.

Il faut contrôler le poids du bundle et la compatibilité navigateur avant d'adopter définitivement cette architecture. Le dépôt actuel utilise un script de compilation maison et ne contient pas encore de `package.json` à sa racine.

## Correspondance initiale des données

Les noms ci-dessous sont ceux des règles officielles du modèle salarié. Les unités d'entrée doivent suivre exactement les exemples du dépôt officiel : `heure/mois` pour les heures supplémentaires dans le moteur (même si les exemples de paramètres d'URL affichent parfois `heures/mois`), `titre-restaurant/mois` pour le nombre et `€/titre-restaurant` pour le montant unitaire. Le prototype utilise aussi `établissement . commune = 'Pacé'` pour expliciter la localisation.

| Donnée OnNet | Situation Publicodes envisagée |
|---|---|
| Statut non-cadre | `salarié . contrat . statut cadre = non` |
| Contrat privé standard | `salarié = 'CDI'` |
| Brut mensuel à 35 h | `salarié . contrat . salaire brut` |
| Heures sup d'un 39 h | `salarié . temps de travail . heures supplémentaires = 17.33 heures/mois` |
| Part mutuelle salarié + employeur | `salarié . cotisations . prévoyances . santé . montant` = total des deux parts |
| Part employeur mutuelle | `salarié . cotisations . prévoyances . santé . taux employeur` = part employeur / montant total |
| Titres-restaurant | `salarié . rémunération . frais professionnels . titres-restaurant . nombre`, `. montant unitaire` et `. taux employeur` |
| Prime d'activité | `salarié . rémunération . primes . activité . base` |
| 13e mois | `salarié . rémunération . primes . fin d'année` |

Le modèle officiel définit les heures supplémentaires en heures par mois. Il propose explicitement 17,33 h/mois pour un contrat à 39 h. Il applique par défaut 25 % sur les huit premières heures supplémentaires hebdomadaires, puis 50 % au-delà, sauf règle conventionnelle applicable. Attention : la CI a mis en évidence une erreur de conversion d'unité dans la règle des titres-restaurant (`€.titre-restaurant/titres-restaurant.mois` vers `€/mois`). Le prototype refuse donc explicitement les scénarios avec titres-restaurant plutôt que d'afficher un résultat trompeur. Cette fonction sera réactivée après résolution et tests.

### Conversion du brut OnNet en 39 h

Le champ brut actuel d'OnNet représente le montant brut mensuel total, heures supplémentaires incluses. Le modèle officiel attend le salaire contractuel de base hors heures supplémentaires et calcule celles-ci séparément.

Il faudra donc convertir le brut total OnNet en salaire de base selon le nombre d'heures supplémentaires et leur majoration, ou mieux ajouter un mode de saisie explicite du brut de base et des heures supplémentaires si cela améliore l'expérience. Toute conversion doit être testée contre le montant brut total restitué par Publicodes. Ne pas conserver silencieusement deux définitions différentes du champ « brut ».

## Hypothèses et limites à rendre visibles

Le moteur produit encore de nombreux avertissements de cycles sur des règles de l'espace entreprise et sur certaines règles de prévoyance. Ils ne font pas échouer les tests de scénarios ciblés, mais doivent être qualifiés avant la production. L'erreur de conversion d'unité des titres-restaurant est contournée temporairement en refusant cette entrée. Les tests doivent continuer à capturer ces diagnostics ; la réussite de la CI ne signifie pas que toutes les règles du modèle sont exemptes d'avertissements. Le modèle officiel couvre beaucoup plus de paramètres qu'OnNet n'en demande aujourd'hui. Les résultats dépendent notamment de la date du calcul, du temps de travail, du statut cadre, de la localisation de l'établissement, de la convention collective, de certaines caractéristiques de l'entreprise et des éléments variables de rémunération.

Pour une première version, OnNet peut rester limité au CDI privé non-cadre en métropole, sans activité partielle, avec une majoration standard des heures supplémentaires. Les paramètres non saisis doivent être explicitement documentés comme hypothèses. Ne pas présenter cette configuration standard comme un bulletin de paie garanti conforme à toutes les conventions et entreprises.

La mutuelle doit être convertie depuis les deux montants existants vers un montant total et un taux employeur. Il faudra avertir lorsque la part employeur est inférieure au minimum modélisé de 50 %, et vérifier le cas où le montant total est nul.

L'impôt sur le revenu doit être traité dans une phase séparée : le net avant impôt et le net effectivement payé après PAS sont deux résultats distincts. Ne pas remplacer le calcul fiscal actuel par une valeur par défaut Publicodes sans avoir choisi explicitement la méthode et les hypothèses de foyer fiscal.

## Premiers résultats techniques (11/11/2026)

Exécution reproductible dans GitHub Actions avec le modèle daté du 11 novembre 2026, CDI privé non-cadre, commune de Pacé, sans titres-restaurant :

| Scénario | Brut calculé | Net avant impôt | Net imposable |
|---|---:|---:|---:|
| 2 300 € brut, 39 h, mutuelle 30 € salarié + 30 € employeur | 2 300,01 € | 1 820,28 € | 1 648,86 € |
| 2 300 € brut, 35 h, mutuelle 30 € + 30 € | 2 300,00 € | 1 787,76 € | 1 884,17 € |
| 2 300 € brut, 39 h, sans mutuelle | 2 300,01 € | 1 853,19 € | 1 650,90 € |

Le brut reconstitué à 39 h présente un écart d'arrondi de 0,01 €. Il faut le traiter proprement dans l'adaptateur (arrondi et précision) avant d'intégrer ce calcul au comparateur.

Ces chiffres sont des sorties du moteur local `modele-social` avec les hypothèses ci-dessus ; ils ne constituent pas encore une comparaison indépendante validée avec l'interface web de l'Urssaf. Les valeurs de mutuelle et l'absence de titres-restaurant sont des paramètres de test, pas une représentation exhaustive d'une fiche de paie réelle.

## Stratégie de validation

Avant toute bascule :

- comparer des situations à 35 h et 39 h, sans prime, sans mutuelle et sans titres-restaurant ;
- comparer les heures supplémentaires avec majoration standard ;
- tester le brut sous, proche et au-dessus du plafond de sécurité sociale ;
- tester les parts de mutuelle distinctes et les titres-restaurant ;
- vérifier le net avant impôt et le détail de chaque retenue ;
- comparer chaque situation à Mon-entreprise avec des paramètres strictement identiques ;
- ajouter des tests de non-régression pour le stockage, le partage, le rendu et la compilation HTML autonome ;
- vérifier que le HTML produit ne dépend d'aucun CDN ni d'une connexion Internet.

Les tests doivent couvrir les règles à la date courante du modèle, puis être rejoués lors de chaque mise à jour de dépendance.

## Séquencement proposé

1. Ajouter un environnement npm et verrouiller les dépendances.
2. Produire un prototype de bundle autonome, sans modifier le calcul existant.
3. Écrire l'adaptateur et les tests sur un petit jeu de scénarios.
4. Comparer les résultats avec l'outil officiel et analyser tous les écarts.
5. Migrer les sorties du moteur une à une.
6. Retirer l'ancien calcul uniquement après validation complète.

## État d'avancement

- [x] Branche de migration créée à partir de l'état actuel de la branche principale.
- [x] Modèle npm officiel, licence et interface d'utilisation repérés.
- [x] Principales règles de saisie salarié, heures supplémentaires et mutuelle identifiées.
- [ ] Installation et verrouillage des dépendances dans le dépôt.
- [x] Prototype bundlé et exécuté dans GitHub Actions (HTML autonome généré).
- [ ] Comparaison indépendante des scénarios avec le simulateur web officiel, à paramètres identiques.
- [ ] Résolution du calcul des titres-restaurant.
- [ ] Explication/qualification des avertissements de cycles du modèle.
- [ ] Migration du moteur de production.
