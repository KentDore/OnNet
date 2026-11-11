# Feuille de route — migration complète OnNet vers le moteur Urssaf

Statut : le calculateur de `fix/smic-official-api` utilise l’API officielle Mon-entreprise / Urssaf ; aucun déploiement ni fusion n’a été effectué. La CI #265 (run 43043170719, commit `bed9e8912b5067d1265a149ed2bab0b2a08960e5`) est verte, y compris la suite navigateur. Le workflow diagnostique #52 (run 43040698637) est également vert : 17 scénarios sociaux et 4 fiscaux, avec 0 € d’écart sur les 7 métriques sociales entre l’API et le paquet npm local. Ce comparatif n’est pas indépendant. Le taux neutre est obtenu par deux évaluations officielles de l’API, sans calcul fiscal local. Les références récupérées le 11/11/2026 sont SMIC 1 867,0167 €/mois (arrondi 1 867,02 €) et PMSS 4 005 € ; elles signalent des variables de localisation manquantes (département / outre-mer), sans échec. Les règles fiscales utilisées restent marquées expérimentales par l’Urssaf. `index.html` a été régénéré depuis les sources. La sonde navigateur du simulateur officiel (run #59, 43041933379) a reproduit le cas et capturé le lien de partage ; elle a mis en évidence un écart de net à expliquer avant toute validation de production.

## Décision d'architecture

**Le moteur principal de la branche de migration est l'API REST officielle Mon-entreprise / Urssaf**, plutôt que la reproduction locale de règles sociales et fiscales.

Documentation : https://mon-entreprise.urssaf.fr/d%C3%A9veloppeur/api

L'API permet d'évaluer les règles du modèle social et de consulter les règles disponibles. Elle est ouverte et sans authentification. Cela réduit la maintenance des règles copiées dans OnNet, mais ne garantit pas que l'API soit instantanément synchronisée avec le simulateur public : des écarts de version ont déjà été signalés.

Principes d'intégration :
- [x] Créer un client API isolé avec délai maximal, gestion des erreurs réseau/HTTP/JSON et validation stricte des valeurs retournées (`src/urssaf-api-client.mjs`).
- [x] Construire une situation Publicodes à partir des entrées du prototype et regrouper les expressions nécessaires dans un appel API ; le scénario 39 h peut nécessiter jusqu'à trois appels pour recalibrer le brut.
- [x] Ne pas afficher de résultat partiel si une expression essentielle manque, si une valeur n'est pas numérique ou si la réponse contient une erreur bloquante.
- [x] Ne pas basculer vers le moteur local en cas d'indisponibilité : l'erreur est affichée explicitement.
- [x] Garder le paquet local `modele-social` pour la comparaison et les diagnostics ; le build du prototype utilise désormais uniquement le client API.
- [x] Remonter les avertissements et les variables auxquelles l'API a appliqué une valeur par défaut.
- [x] Le calculateur principal affiche la source API et exige une action de l'utilisateur avant d'envoyer les données.
- [x] La commune de l’établissement est modifiable par scénario ; Pacé est la valeur initiale. Le repère SMIC n’envoie pas de données fiscales inutiles.
- [x] Tester un appel API réel dans Chromium : CORS, réponse JSON, règle `SMIC` et calcul de net avant impôt avec un salaire représentatif. Le premier smoke-test a réussi dans la CI du 11/11/2026 (run 43023772499) ; la version étendue a réussi dans le workflow CI #168 (11/11/2026, run 43028512580).
- [ ] Compléter par un essai sur réseau mobile et par des tests d’erreurs transitoires en conditions réelles.
- [ ] Réévaluer l’intérêt d’un proxy serveur avant publication ; ne jamais journaliser les payloads de paie.
- [ ] Résoudre l’écart constaté avec le simulateur web officiel avant de considérer la validation indépendante terminée. Cas synthétique : 2 300 € brut/mois, 35 h, taux PAS personnalisé 10 %, convention « droit commun ». Le simulateur web affiche net avant impôt 1 798,73 €, net imposable 1 884,85 €, prélèvement mensuel 188,50 € et net après impôt 1 610,23 €. L’API OnNet, sans mutuelle explicite, renvoie net avant impôt 1 820,67 €, net imposable 1 886,21 €, impôt 2 263 €/an (≈ 188,58 €/mois) et net après impôt 1 632,09 €. Écarts : +21,94 € avant impôt, +1,36 € imposable, +0,08 € de prélèvement mensuel et +21,86 € après impôt côté API. Le lien de partage du simulateur n’expose pas de paramètre de mutuelle et affiche un avertissement de paramètres non appliqués après évolution du site. La fiche de paie officielle indique toutefois une complémentaire santé par défaut de 20 € côté salarié et 20 € côté employeur. L’écart de net avant impôt est du même ordre que cette part salariale, mais cela ne suffit pas à prouver la cause : le test API ciblé avec mutuelle 20/20 est encore en attente dans le workflow diagnostique #64. Ne pas corriger ces écarts par une constante arbitraire : attendre ce résultat, puis identifier toute différence résiduelle d’hypothèses ou de règles.
- [ ] Mettre à jour ce document après chaque phase et consigner les écarts constatés.

## Inventaire fonctionnel de référence

- Comparaison de plusieurs salaires/offres et réorganisation des cartes.
- Entrée du salaire mensuel ou annuel, durée 35 h/39 h et commune d’établissement par scénario. Les primes libres et les mensualités différentes de 12 sont visibles mais bloquées tant que leur mapping à l’API n’est pas validé.
- Brut, cotisations, net avant impôt, net imposable, net payé après prélèvement à la source et taux horaire.
- Mutuelle salariale et patronale.
- Titres-restaurant, part salariale/patronale et contrôle des plafonds.
- Impôt : taux de prélèvement personnalisé saisi ou estimation au barème, composition du foyer, enfants à charge, parent isolé.
- Module d'augmentation ; aucun module d'absence (retiré du périmètre).
- Repères SMIC et salaire médian, graphique de répartition, impression/export PDF.
- Sauvegardes locales et partage via URL fragment (non chiffré).

OnNet ne propose plus de module de simulation d’absence. Le périmètre raccordé ne couvre pas encore le temps partiel, la régularisation progressive des plafonds, Alsace-Moselle ou certains régimes particuliers ; une réponse de l’API ne signifie pas que toutes les particularités d’un bulletin sont prises en compte.

## Phases et critères de sortie

### Phase A — fiabiliser les entrées OnNet
- [x] Contrôler la validité des dates et le nombre entier de titres-restaurant.
- [x] Cartographier les champs actuellement pris en charge (brut, heures supplémentaires, commune, mutuelle, titres-restaurant et données fiscales) vers les règles et unités officielles.
- [x] Bloquer explicitement les primes libres et les mensualités différentes de 12 tant que leur mapping API n’est pas validé.
- [x] Vérifier la conversion des 4 heures supplémentaires hebdomadaires en heures mensuelles et retirer le taux de majoration du calcul local d'initialisation du brut.
- [x] Afficher sous le choix 39 h l’hypothèse de calcul : contrat de 35 h + 4 h supplémentaires rémunérées par semaine, droit commun, sans prise en compte des RTT.
- [ ] Permettre ou bloquer explicitement les conventions collectives spécifiques : le scénario 39 h force actuellement le droit commun, donc il ne doit pas être présenté comme adapté à toutes les conventions.
- [x] Refuser explicitement un brut nul : l’API ne fournit pas toutes les expressions nécessaires pour une situation sans salaire ; OnNet bloque cette saisie avant l’appel réseau.
- [ ] Vérifier les cas limites : très faibles salaires positifs, seuil PMSS, hauts salaires et valeurs extrêmes. Les réponses partielles de l’API doivent rester bloquantes, sans fabriquer les valeurs manquantes.

### Phase B — client API officiel
- [x] Implémenter le client REST dédié à `https://mon-entreprise.urssaf.fr/api/v1/evaluate`.
- [x] Confirmer que `/api/v1/evaluate` utilise le modèle `modele-social` et que le catalogue officiel expose les trois méthodes fiscales.
- [x] Valider la structure de réponse, les valeurs numériques, les avertissements et les variables manquantes.
- [x] Gérer le délai maximal, les erreurs réseau, les statuts HTTP 400/429/5xx et les réponses JSON invalides.
- [x] Transmettre les méthodes fiscales personnalisée, neutre et barème ; exiger les informations du foyer pour le barème, y compris les autres revenus imposables annuels en couple ; ne pas supposer le statut de parent isolé.
- [x] Ajouter des tests simulés du client API et un script de comparaison réel de neuf scénarios sociaux et quatre cas fiscaux, dont un couple avec autres revenus imposables.
- [x] Exécuter explicitement `test/urssaf-api-client.test.mjs` dans le workflow `quality.yml` : la CI #237 passe les 18 tests du client API et les 12 tests de l'adaptateur local.
- [x] Exécuter le workflow CI complet : tests de calcul, tests du client API, build autonome, parcours navigateur et smoke-test réel Chromium. La CI n’exécute pas le script de comparaison `scripts/compare-urssaf-api.mjs`, afin d’éviter une multiplication des appels API réels.
- [x] Tester l’appel depuis Chromium : compatibilité CORS confirmée pour le smoke-test `SMIC` (CI du 11/11/2026, run 43023772499). La version étendue inclut aussi le calcul du net avant impôt et a réussi dans le workflow CI #177.
- [ ] Compléter par un essai sur réseau mobile et des scénarios d’erreurs transitoires.
- [ ] Retester le smoke-test réel des trois méthodes fiscales via l'API après l'adaptation du taux neutre : vérifier que le taux de grille officiel est réinjecté comme taux explicite et que l'API renvoie un prélèvement positif cohérent. Cela confirme le fonctionnement technique, pas à lui seul l'exactitude juridique.
- [ ] Traiter explicitement la limite fiscale dans l'interface et la documentation : Urssaf marque la règle `impôt . méthode de calcul . barème standard` et la règle `impôt . taux d'imposition` comme expérimentales ; elles peuvent évoluer, être renommées ou supprimées sans changement de version majeure. L'estimation après impôt ne doit donc pas être présentée comme une retenue garantie.

### Phase C — parité et qualité
- [x] Exécuter `npm run compare:urssaf-api` via le workflow diagnostique isolé (run #52, 11/11/2026). Les 17 scénarios sociaux ont 7 métriques chacun avec un écart local/API de 0 € sur tous les cas. Les 4 scénarios fiscaux pour 2 300 € brut / 35 h ont renvoyé : PAS personnalisé 10 % → net avant impôt 1 820,67 €, imposable 1 886,21 €, net après impôt 1 632,09 €, impôt 2 263 €/an ; taux neutre 2,1 % → net après impôt 1 781,09 €, impôt 475 €/an ; barème célibataire → net après impôt 1 778,67 €, impôt 504 €/an ; barème couple avec 24 000 € d'autres revenus imposables → net après impôt 1 743,84 €, impôt 922 €/an. Résultats diagnostiques, pas validation indépendante. Une répétition ultérieure (run #54) a échoué sur une erreur réseau `fetch` avant de terminer la matrice ; le run #52 reste le dernier passage complet réussi, sans écart mesuré. Le SMIC et le PMSS sont lus dynamiquement. Le script espace les appels d'au moins 350 ms et s'arrête sur HTTP 429/5xx ou erreur réseau.
- [ ] Comparer les cas de référence avec le simulateur web public, indépendamment du paquet npm local.
- [x] Ajouter 18 tests simulés dédiés au client API, en plus des 12 tests de l'adaptateur local ; la suite comprend le cas d'absence de titres-restaurant, les bornes de 500 € et le taux neutre via la règle officielle dédiée.
- [x] Ajouter des tests de non-régression pour heures supplémentaires, mutuelle, titres-restaurant, date, erreurs API, limites de débit et entrées fiscales.
- [ ] Ne pas utiliser les comparaisons API comme seule preuve de conformité.

### Phase D — intégration complète
- [x] Remplacer l'adaptateur de calcul local par l'adaptateur API dans le calculateur principal de la branche de migration.
- [x] Garder le stockage, le partage, les graphiques et l'export indépendants du moteur de paie.
- [x] Ajouter les tests de non-régression des sauvegardes, des anciens champs d’absence et des liens de partage.
- [ ] Auditer le poids du bundle, les performances et l’accessibilité. Les erreurs API et le comportement hors ligne sont déjà testés ; compléter le test sur réseau mobile.
- [x] Comportement hors ligne explicite : calcul impossible sans Internet, aucun fallback local.

## Risques à surveiller

- L'API officielle est ouverte et sans authentification ; la documentation décrit une API REST, et le code serveur officiel applique CORS.
- Le code serveur consulté applique actuellement une limite de 5 requêtes/seconde/IP en production : https://github.com/betagouv/mon-entreprise/blob/master/api/source/middlewares/rate-limiter.ts
- Le cache API serveur est configuré avec une durée de 24 heures : https://github.com/betagouv/mon-entreprise/blob/master/api/source/middlewares/redis-cache.ts. Une même requête peut donc réutiliser un résultat mis en cache ; l'API ne garantit pas une actualisation instantanée de chaque règle.
- Un incident public a documenté un écart entre API et simulateur pour un scénario daté de 2026, dû à un déploiement API non aligné : https://github.com/betagouv/mon-entreprise/issues/4581 et https://github.com/betagouv/mon-entreprise/issues/4624
- Certaines règles sont expérimentales et peuvent changer sans garantie de compatibilité. Contrôler les avertissements retournés.
- Les variables absentes peuvent recevoir une valeur par défaut : OnNet les signale, mais il reste à décider si certaines doivent bloquer le calcul.
- Le client API transmet les paramètres du scénario (salaire, durée, mutuelle, titres-restaurant et, si saisi, données fiscales) au service Urssaf. Il n'y a aucun repli local en cas d'échec.
- Le calcul fiscal dépend de la méthode et des données du foyer. Ne pas présenter une estimation comme un montant réel de bulletin.
- Le smoke-test CORS sur Chromium a réussi (CI du 11/11/2026, run 43023772499). Le test sur réseau mobile reste à effectuer ; ce smoke-test ne valide pas à lui seul tous les parcours de calcul en production.

## Règle de mise en production

Pas de fusion vers `main`, pas de remplacement du calculateur courant et pas de publication tant que :
1. le client API et ses erreurs sont testés ;
2. la matrice de tests est verte ;
3. les écarts importants sont expliqués ;
4. les limites visibles dans l'interface correspondent aux limites réelles ;
5. l'audit des scénarios, du partage, des sauvegardes et de la génération autonome est terminé ;
6. l'utilisateur a explicitement approuvé la bascule.
