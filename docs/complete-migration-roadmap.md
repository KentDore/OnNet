# Feuille de route — migration complète OnNet vers le moteur Urssaf

Statut : migration en cours, branche `migration/publicodes-urssaf`. Aucune modification de `main` et aucune mise en production.

## Décision d'architecture

**Le moteur principal cible est l'API REST officielle Mon-entreprise / Urssaf**, plutôt que la reproduction locale de règles sociales et fiscales.

Documentation : https://mon-entreprise.urssaf.fr/d%C3%A9veloppeur/api

L'API permet d'évaluer les règles du modèle social et de consulter les règles disponibles. Elle est ouverte et sans authentification. Cela réduit la maintenance des règles copiées dans OnNet, mais ne garantit pas que l'API soit instantanément synchronisée avec le simulateur public : des écarts de version ont déjà été signalés.

Principes d'intégration :
- [ ] Créer un client API isolé, avec délai maximal, gestion des erreurs réseau/HTTP/JSON et validation stricte des valeurs retournées.
- [ ] Construire une situation Publicodes à partir des entrées OnNet et demander à l'API toutes les expressions nécessaires en une seule requête lorsque c'est possible.
- [ ] Ne pas afficher de résultat partiel si une expression essentielle manque, si une valeur n'est pas numérique ou si la réponse contient une erreur bloquante.
- [ ] Ne pas basculer silencieusement vers le moteur local en cas d'indisponibilité : ses règles épinglées peuvent diverger de l'API. Afficher une erreur explicite et proposer de réessayer.
- [ ] Garder le paquet local `modele-social` uniquement pour les tests de non-régression et les comparaisons, jusqu'à ce que le client API soit validé. Réévaluer ensuite s'il reste nécessaire dans le bundle de production.
- [ ] Contrôler les avertissements et variables manquantes retournés par l'API ; ne pas ignorer les règles expérimentales.
- [ ] Afficher une mention claire : estimation indicative, moteur Urssaf, date du scénario et état de disponibilité du service.
- [ ] Tester CORS et l'accès direct depuis le navigateur, les limites de requêtes, les erreurs transitoires et les changements de schéma avant d'adopter l'appel direct côté client.
- [ ] Si un proxy serveur est nécessaire, le concevoir sans journaliser ni conserver les situations salariales sensibles.
- [ ] Garder une stratégie de test indépendante : la parité avec l'API du même modèle ne constitue pas une validation indépendante du droit.
- [ ] Mettre à jour ce document après chaque phase et consigner les écarts constatés.

## Inventaire fonctionnel de référence

- Comparaison de plusieurs salaires/offres et réorganisation des cartes.
- Entrée du salaire mensuel ou annuel, durée 35 h/39 h, nombre de mensualités, primes et règles de rattachement du 13e/14e mois aux heures supplémentaires.
- Brut, cotisations, net avant impôt, net imposable, net payé après prélèvement à la source et taux horaire.
- Mutuelle salariale et patronale.
- Titres-restaurant, part salariale/patronale et contrôle des plafonds.
- Impôt : taux de prélèvement personnalisé saisi ou estimation au barème, composition du foyer, enfants à charge, parent isolé.
- Modules d'augmentation et d'absence.
- Repères SMIC et salaire médian, graphique de répartition, impression/export PDF.
- Sauvegardes locales et partage via URL fragment (non chiffré).

Les limites historiques documentées — absence de modélisation complète des arrêts/IJSS, temps partiel, régularisation progressive des plafonds, Alsace-Moselle et régimes particuliers — ne doivent pas être présentées comme résolues simplement parce que l'API retourne un résultat.

## Phases et critères de sortie

### Phase A — fiabiliser les entrées OnNet
- [x] Contrôler la validité des dates et le nombre entier de titres-restaurant.
- [ ] Cartographier tous les champs OnNet vers les règles Publicodes officielles et leurs unités.
- [ ] Vérifier les hypothèses 35 h/39 h, les heures supplémentaires et les majorations conventionnelles.
- [ ] Vérifier les cas limites : salaire nul, très faibles salaires, seuil PMSS, hauts salaires et valeurs extrêmes.

### Phase B — client API officiel
- [ ] Implémenter un client REST dédié à `https://mon-entreprise.urssaf.fr/api/v1/evaluate`.
- [ ] Vérifier les routes et le modèle salarié appropriés à partir de la documentation actuelle et du Swagger.
- [ ] Valider les réponses, les unités, les avertissements et les variables manquantes.
- [ ] Vérifier CORS, délai maximal, disponibilité et erreurs réseau depuis le prototype navigateur.
- [ ] Couvrir les modes fiscalité personnalisée, taux neutre et barème uniquement si les règles et entrées nécessaires sont confirmées par le modèle officiel.
- [ ] Ne pas inventer les paramètres absents et ne pas calculer le net après impôt à partir d'un taux supposé.

### Phase C — parité et qualité
- [ ] Comparer les résultats API avec des scénarios de référence et le simulateur officiel en utilisant exactement les mêmes hypothèses et dates.
- [ ] Documenter tout écart entre API, simulateur public et paquet npm local, sans présumer que l'un est toujours correct.
- [ ] Ajouter des tests de non-régression des scénarios représentatifs, dont heures supplémentaires, mutuelle, titres-restaurant et fiscalité.
- [ ] Ne pas utiliser les comparaisons API comme seule preuve de conformité.

### Phase D — intégration complète
- [ ] Établir un adaptateur unique utilisé par tous les scénarios comparés.
- [ ] Garder le stockage, le partage, les graphiques et l'export indépendants du moteur de paie.
- [ ] Ajouter tests de non-régression des sauvegardes et des liens de partage.
- [ ] Auditer le poids du bundle, les performances, l'accessibilité, le fonctionnement hors ligne et la gestion d'erreur.
- [ ] Décider explicitement du comportement hors ligne : pas de calcul local silencieux si ses règles peuvent diverger.

## Risques à surveiller

- L'API officielle est ouverte et sans authentification, mais cela ne constitue pas une garantie de disponibilité ou de synchronisation instantanée avec le simulateur web.
- Un ticket public a documenté un écart entre API et simulateur pour un cas daté de 2026, lié à des versions de règles différentes : https://github.com/betagouv/mon-entreprise/issues/4581
- Certaines règles peuvent être expérimentales et évoluer sans compatibilité garantie. Contrôler les avertissements retournés.
- Le calcul d'un net après impôt dépend de la méthode et des données fiscales effectivement fournies. Ne pas présenter une estimation comme un montant réel de bulletin.
- Les situations salariales sont potentiellement sensibles : limiter les données envoyées, ne pas journaliser les payloads et vérifier les conditions d'utilisation applicables.

## Règle de mise en production

Pas de fusion vers `main), pas de remplacement du calculateur courant et pas de publication tant que :
1. le client API et ses erreurs sont testés ;
2. la matrice de tests est verte ;
3. les écarts importants sont expliqués ;
4. les limites visibles dans l'interface correspondent aux limites réelles ;
5. l'audit des scénarios, du partage, des sauvegardes et de la génération autonome est terminé ;
6. l'utilisateur a explicitement approuvé la bascule.
