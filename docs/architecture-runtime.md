# Architecture runtime

## Pourquoi ce document existe

OnNet a été découpé en fichiers source, mais ce découpage physique ne constitue pas encore une architecture modulaire. Cette distinction est importante : déplacer une fonction dans un autre fichier ne suffit pas à rendre ses dépendances explicites.

Ce document décrit le fonctionnement actuel et fixe une trajectoire de migration prudente. Il doit être mis à jour lorsqu'une frontière technique change.

## Chaîne de construction

1. `src/template.html` fournit le squelette HTML et les marqueurs de génération.
2. `src/urssaf-api-client.mjs` contient le client de l'API officielle. Il est intégré au script final et expose l'interface attendue par l'application.
3. `src/ui-utils.js` fournit les valeurs par défaut et les utilitaires de présentation.
4. `src/app/manifest.json` impose l'ordre d'assemblage des huit fragments applicatifs.
5. `src/styles/manifest.json` impose l'ordre d'assemblage des fragments CSS. Les ressources de police sont réinjectées depuis `src/fonts/`.
6. `scripts/build.js` génère le HTML autonome. `index.html` et `Onnet-2.2.1.html` sont des artefacts générés : ne pas les modifier indépendamment des sources.

Depuis la fusion de la [PR #91](https://github.com/KentDore/OnNet/pull/91), le client Urssaf, les utilitaires et les fragments applicatifs sont regroupés dans un unique `<script type="module">`. Les fonctions et variables internes ne polluent donc plus `window` ; `window.OnNetUrssafApi` reste le point d'accès volontaire. Cette amélioration encapsule le runtime, mais ne crée pas encore des modules ES indépendants : les fragments applicatifs partagent toujours le même espace lexical et leur ordre d'assemblage reste important.

## Responsabilités actuelles

| Source | Responsabilité principale | Dépendances ou points d'attention |
| --- | --- | --- |
| `00-state-and-calculations.js` | État des simulations, préparation des paramètres, cache et orchestration des appels Urssaf | État mutable utilisé par le rendu, les événements et le démarrage |
| `10-persistence.js` | Validation, restauration et sauvegarde locale | Dépend des valeurs par défaut et des utilitaires communs ; la notification de sauvegarde est injectée plus tard |
| `20-sharing.js` | Encodage/décodage des liens et restauration d'un partage | Réutilise la normalisation de la persistance et participe à l'initialisation de l'état |
| `30-rendering.js` | Rendu des cartes, indicateurs, comparatifs et graphiques | Point de couplage majeur : lit l'état et les résultats, et est rappelé par de nombreux gestionnaires |
| `40-household-and-navigation.js` | Foyer fiscal, navigation et interactions de structure | Modifie l'état puis déclenche rendu, sauvegarde ou recalcul |
| `50-input-events.js` | Événements des formulaires et modifications de scénarios | Dépend des fonctions de validation, du rendu, de la persistance et du calcul |
| `60-notifications-and-modals.js` | Notifications, modales et formulaires complémentaires | Utilisé par le partage et les événements ; certaines fonctions sont injectées dans d'autres fragments |
| `70-optional-tools-and-startup.js` | Modules facultatifs, outils d'augmentation et démarrage | Appelle les fonctions précédentes et termine l'initialisation |

Cette table décrit les responsabilités dominantes, pas une séparation stricte. Plusieurs fonctions et variables sont encore utilisées en dehors du fragment où elles sont définies.

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

Cible initiale possible : formatage, échappement HTML et parsing numérique. Ces fonctions ne doivent dépendre ni du DOM, ni du stockage, ni de l'état des scénarios. Les valeurs par défaut et constantes métier seront traitées séparément pour éviter de déplacer des responsabilités qui ne sont pas purement utilitaires.

L'extraction devra préserver le HTML autonome : les modules seront regroupés au build, sans imposer de requêtes supplémentaires à l'ouverture ni rendre le fichier autonome dépendant de fichiers externes.

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
