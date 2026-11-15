# Architecture runtime

## Pourquoi ce document existe

OnNet a été découpé en fichiers source, mais ce découpage physique ne constitue pas encore une architecture modulaire. Cette distinction est importante : déplacer une fonction dans un autre fichier ne suffit pas à rendre ses dépendances explicites.

Ce document décrit le fonctionnement actuel et fixe une trajectoire de migration prudente. Il doit être mis à jour lorsqu'une frontière technique change.

## Chaîne de construction

1. `src/template.html` fournit le squelette HTML et les marqueurs de génération.
2. `src/urssaf-api-client.mjs` contient le client de l'API officielle. Il est intégré au script final et expose l'interface attendue par l'application.
3. `src/ui-utils.mjs` exporte les valeurs par défaut et les utilitaires purs de présentation.
4. `src/state-normalizers.mjs` exporte les règles de validation et de normalisation des scénarios et du foyer fiscal.
5. `src/urssaf-calculation.mjs` isole les règles pures de calcul : clé de cache, validation du périmètre, construction des paramètres transmis et conversion des réponses Urssaf vers le modèle interne.
6. `src/smic-reference.mjs` contient les fonctions pures qui construisent le repère SMIC en 35 h ou en 39 h, avec quatre heures supplémentaires majorées à 25 %.
7. `src/rate-limited-fetch.mjs` encapsule la file d'appels réseau et l'intervalle minimal entre deux démarrages ; le fetch, l'horloge et l'attente sont injectables.
8. `src/app/manifest.json` impose l'ordre d'assemblage des huit fragments applicatifs.
9. `src/styles/manifest.json` impose l'ordre d'assemblage des fragments CSS. Les ressources de police sont réinjectées depuis `src/fonts/`.
10. `scripts/build.js` utilise esbuild pour regrouper le client Urssaf, les utilitaires, les normalisateurs, les adaptateurs de calcul, l'ordonnanceur réseau et les fragments applicatifs en un seul module embarqué. `index.html` et `Onnet-2.2.1.html` sont des artefacts générés : ne pas les modifier indépendamment des sources.

Depuis la [PR #91](https://github.com/KentDore/OnNet/pull/91), le runtime est encapsulé dans un unique `<script type="module">`. La [PR #94](https://github.com/KentDore/OnNet/pull/94) a extrait les utilitaires purs et le client Urssaf en véritables modules ES. La [PR #95](https://github.com/KentDore/OnNet/pull/95) extrait les règles de normalisation des scénarios et du foyer fiscal. La PR #96 isole les adaptateurs purs entre l'état de l'application et le contrat de l'API Urssaf. La PR #97 ajoute à ce module la construction pure de la clé qui identifie les paramètres d'un calcul et gouverne la réutilisation du cache. La PR #98 sépare l'ordonnanceur de requêtes réseau, avec des dépendances de temps injectées pour tester la sérialisation et la reprise après erreur. La PR #99 isole le calcul du scénario SMIC, notamment le cas 39 h avec quatre heures supplémentaires majorées.

Le wrapper démarre la première requête sans attente, puis impose au moins 350 ms entre les démarrages suivants. Il remet la file dans un état utilisable après un rejet ; le module ne dépend pas directement de `window`, car le fetch concret lui est fourni par l'application. esbuild regroupe ces modules avec les fragments applicatifs au moment du build. Le point d'accès volontaire sur `window` reste `window.OnNetUrssafApi`. Les huit fragments applicatifs sont encore assemblés dans un seul espace lexical ; ils ne sont pas encore des modules indépendants.

## Responsabilités actuelles

| Source | Responsabilité principale | Dépendances ou points d'attention |
| --- | --- | --- |
| `00-state-and-calculations.js` | État des simulations, cache et orchestration des appels Urssaf | État mutable utilisé par le rendu, les événements et le démarrage ; délègue désormais les transformations pures au module de calcul |
| `state-normalizers.mjs` | Validation pure des scénarios, normalisation du foyer fiscal et des identifiants | Dépend des utilitaires de présentation ; partagé par la restauration locale et le partage d'URL |
| `urssaf-calculation.mjs` | Clé d'identification des paramètres de calcul, validation du périmètre, construction des entrées API et conversion des réponses | Fonctions pures testées séparément ; ne gère ni état de cache, ni stockage, ni requête réseau |
| `rate-limited-fetch.mjs` | File réseau séquentielle et intervalle minimal entre les démarrages de requêtes | Dépendances réseau, horloge et temporisation injectées ; testable sans navigateur |
| `smic-reference.mjs` | Construction du scénario de référence SMIC, avec ou sans 4 heures supplémentaires | Formules pures testées pour les durées 35 h et 39 h ; aucune lecture de l'état applicatif |
| `10-persistence.js` | Lecture/écriture et restauration du stockage local | Utilise les normalisateurs ; la notification de sauvegarde est injectée plus tard |
| `20-sharing.js` | Encodage/décodage des liens et restauration d'un partage | Réutilise directement les normalisateurs partagés et participe à l'initialisation de l'état |
| `30-rendering.js` | Rendu des cartes, indicateurs, comparatifs et graphiques | Point de couplage majeur : lit l'état et les résultats, et est rappelé par de nombreux gestionnaires |
| `40-household-and-navigation.js` | Foyer fiscal, navigation et interactions de structure | Modifie l'état puis déclenche rendu, sauvegarde ou recalcul |
| `50-input-events.js` | Événements des formulaires et modifications de scénarios | Dépend des fonctions de validation, du rendu, de la persistance et du calcul |
| `60-notifications-and-modals.js` | Notifications, modales et formulaires complémentaires | Utilisé par le partage et les événements ; certaines fonctions sont injectées dans d'autres fragments |
| `70-optional-tools-and-startup.js` | Modules facultatifs, outils d'augmentation et démarrage | Appelle les fonctions précédentes et termine l'initialisation |

Cette table décrit les responsabilités dominantes, pas une séparation stricte. Plusieurs fonctions et variables sont encore utilisées en dehors du fragment où elles sont définies.

Le montant officiel du SMIC est récupéré par l'orchestrateur puis transmis au module `smic-reference.mjs`. Le module ne lit donc ni le réseau ni l'état global. Le scénario 35 h utilise directement ce montant ; le scénario 39 h applique l'hypothèse existante de quatre heures supplémentaires hebdomadaires majorées à 25 %. La mutuelle et les titres-restaurant sont neutralisés dans le repère.

Les vérifications GitHub Actions reconstruisent `index.html` et `Onnet-2.2.1.html` depuis les sources avant les tests. La synchronisation vers la branche de la PR n'a lieu que si sa tête correspond encore au commit testé ; une exécution plus ancienne ne peut donc pas écraser les artefacts d'un commit plus récent.

## Constats critiques

- **Le découpage est d'abord organisationnel.** L'ordre du manifeste est une dépendance d'exécution : changer cet ordre peut casser l'application.
- **L'état est partagé implicitement.** Les scénarios, le foyer fiscal, la référence sélectionnée, les résultats Urssaf et le consentement sont lus ou modifiés par plusieurs fragments.
- **Le rendu est trop central.** Il est appelé par plusieurs domaines fonctionnels. Le déplacer ou le convertir en module sans interface d'état stable aurait un risque élevé.
- **Des fonctions sont affectées après leur déclaration.** Par exemple, des implémentations de notification et des indicateurs d'initialisation sont définis dans un fragment puis renseignés ou utilisés plus tard.
- **Le lint reflète cette contrainte.** La règle `prefer-const` est désactivée pour les fragments applicatifs, car une variable déclarée dans un fragment peut être réaffectée dans un autre. Ce contournement est limité aux fragments concernés, mais il signale une dette d'architecture.
- **Le moteur local historique ne doit pas redevenir un repli de calcul.** Les montants de paie en production restent calculés par l'API officielle ; la migration de l'interface ne doit pas modifier cette règle.

## Trajectoire de migration proposée

### Étape 1 — Stabiliser les contrats

- Garder les tests de build, les tests navigateur et les tests du client API comme barrières obligatoires.
- Ajouter des tests unitaires aux fonctions réellement pures avant de les déplacer.
- Identifier les variables partagées et leurs propriétaires ; ne pas déduire les dépendances uniquement du nom des fichiers.

### Étape 2 — Extraire les utilitaires purs

**Réalisée pour les utilitaires de présentation** : formatage, échappement HTML, parsing numérique, constantes d'interface et valeurs par défaut sont exportés par `src/ui-utils.mjs`. Le build les regroupe avec le client Urssaf et les fragments applicatifs au moyen d'esbuild. Le HTML final reste autonome et n'effectue aucune requête supplémentaire vers les modules source.

Cette extraction est couverte par des tests unitaires dédiés et par les tests navigateur qui vérifient que les fonctions internes ne sont pas exposées sur `window`.

### Étape 2 bis — Extraire les normalisateurs d'état

Les règles pures de validation des scénarios, de normalisation du foyer fiscal et de renumérotation des identifiants sont désormais isolées dans `src/state-normalizers.mjs`. La persistance locale conserve son adaptateur `localStorage` dans le fragment applicatif, tandis que les fonctions de normalisation sont partagées par la restauration et le partage d'URL.

### Étape 3 — Rendre l'état explicite

Introduire progressivement une interface d'état limitée (lecture et commandes identifiées) avant de séparer les fragments qui modifient les mêmes données. Éviter un grand objet global qui ne ferait que déplacer le problème.

### Étape 4 — Séparer les domaines fonctionnels

Une fois les contrats stabilisés, convertir progressivement persistance, partage, calcul/orchestration et interactions en modules indépendants. Le rendu sera traité plus tard, après réduction de ses dépendances.

## Critères d'acceptation de chaque étape

Une étape n'est acceptable que si :

- le diff reste ciblé et compréhensible ;
- les tests unitaires couvrent les comportements déplacés ;
- les tests Playwright passent sur desktop et mobile ;
- le build reproduit exactement les artefacts HTML publiés ;
- les appels Urssaf, le consentement et les données transmises conservent leur comportement ;
- le déploiement GitHub Pages est confirmé après fusion.

Si une étape ne satisfait pas ces critères, elle doit être corrigée ou annulée plutôt que fusionnée en espérant une correction ultérieure.
