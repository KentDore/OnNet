# Feuille de route — migration complète OnNet vers Publicodes

Statut : migration en cours, branche `migration/publicodes-urssaf`. Aucune modification de `main` et aucune mise en production.

## Décision produit

Conserver les fonctionnalités du calculateur existant tout en remplaçant progressivement les formules de paie maison par le modèle officiel `modele-social`. Les fonctions qui ne relèvent pas du bulletin de paie (comparaison multi-offres, présentation, sauvegardes, partage, graphiques et exports) restent dans OnNet.

La migration ne doit pas reproduire aveuglément les approximations historiques : chaque règle doit être classée comme règle officielle, approximation assumée, ou fonctionnalité non couverte.

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

Les limites historiques documentées — absence de modélisation complète des arrêts/IJSS, temps partiel, régularisation progressive des plafonds, Alsace-Moselle et régimes particuliers — ne doivent pas être présentées comme résolues simplement parce que Publicodes calcule un résultat.

## Phases et critères de sortie

### Phase A — fiabiliser l'adaptateur
- [x] Verrouiller les dépendances et utiliser `npm ci` en CI.
- [x] Contrôler la validité des dates et le nombre entier de titres-restaurant.
- [x] Contrôler la convergence du brut global reconstitué à 39 h.
- [x] Utiliser la valeur exacte `4 × 52 / 12` pour les heures supplémentaires mensuelles du scénario 39 h.
- [ ] Réduire et classifier les avertissements du moteur sans masquer les avertissements significatifs.
- [ ] Vérifier les cas limites, notamment salaire nul, très faibles salaires, seuil PMSS, hauts salaires et valeurs extrêmes.

### Phase B — fiscalité officielle
- [x] Ajouter le choix entre barème standard, taux neutre et taux personnalisé dans l'adaptateur.
- [x] Ajouter les champs du foyer fiscal supportés par le modèle salarié (situation, enfants, parent isolé).
- [ ] Vérifier les règles fiscales réellement disponibles dans la version npm verrouillée : certaines règles du jeu Publicodes sont signalées comme expérimentales.
- [ ] Ajouter des scénarios de référence pour les trois modes, y compris les cas où le taux personnalisé vaut 0 %.
- [ ] Distinguer dans l'interface le net avant impôt, le net payé après PAS et l'estimation d'impôt annuel ; ne jamais étiqueter une estimation annuelle comme le prélèvement réel du bulletin.
- [ ] Définir explicitement le comportement pour revenus du foyer autres que le salaire, crédits/réductions, taux individualisé et taux neutre. Ne pas supposer que le modèle salarié les couvre.
- [ ] Comparer les cas de référence avec le simulateur officiel en gardant exactement les mêmes hypothèses.

### Phase C — rémunération et contrats
- [ ] Cartographier les champs OnNet existants vers les règles Publicodes : durée, brut mensuel/annuel, nombre de mois, primes, 13e/14e mois et heures supplémentaires.
- [ ] Remplacer les calculs manuels des heures supplémentaires et de leur exonération par les règles du modèle lorsque celles-ci correspondent au cas.
- [ ] Rendre les majorations conventionnelles configurables seulement si la règle officielle et les données d'entrée sont clairement définies.
- [ ] Reproduire ou redéfinir le taux horaire et le calcul annuel, avec des tests de non-régression.

### Phase D — avantages et absences
- [ ] Vérifier mutuelle : conversion du montant total et taux employeur, part patronale absente dans les anciennes sauvegardes, zéro et participation minimale.
- [ ] Vérifier titres-restaurant : valeur, nombre, participation et plafonds d'exonération.
- [ ] Étudier les règles disponibles pour absences/congés ; ne pas simuler les IJSS ou le maintien conventionnel sans données nécessaires.
- [ ] Documenter séparément ce qui reste une estimation.

### Phase E — intégration complète
- [ ] Établir un adaptateur unique utilisé par tous les scénarios comparés, avec validation et valeurs par défaut explicites.
- [ ] Garder le stockage, le partage, les graphiques et l'export indépendants du moteur de paie.
- [ ] Ajouter tests de non-régression des sauvegardes et des liens de partage.
- [ ] Auditer le poids du bundle, les performances, l'accessibilité, le fonctionnement hors ligne et la gestion d'erreur.
- [ ] Construire une matrice de parité représentative ; la parité avec l'API du même modèle est nécessaire mais pas une validation indépendante du droit.
- [ ] Générer les artefacts HTML autonomes uniquement sur la branche de migration jusqu'à approbation explicite.

## Fiscalité : principes de prudence

Le modèle `modele-social` expose des méthodes d'impôt au barème standard, au taux neutre et au taux personnalisé. La règle de calcul de l'impôt est marquée expérimentale dans le dépôt source ; il faut donc verrouiller la version, tester les règles et afficher la méthode utilisée.

- **Taux personnalisé** : saisir le taux connu de l'utilisateur. Ne pas le déduire de son salaire seul.
- **Taux neutre** : utile pour comparer une paie lorsque le taux personnalisé n'est pas transmis ; il ne reflète pas nécessairement l'impôt total du foyer.
- **Barème standard** : estimation dépendant de la situation familiale et des données prises en compte. Elle ne remplace pas la déclaration annuelle et ne peut pas automatiquement reproduire tous les revenus, crédits ou réductions.

Références :
- Modèle officiel : https://github.com/betagouv/mon-entreprise/tree/master/modele-social
- Méthodes de calcul Urssaf : https://mon-entreprise.urssaf.fr/documentation/imp%C3%B4t/m%C3%A9thode-de-calcul
- Prélèvement à la source — Service-Public : https://www.service-public.gouv.fr/particuliers/vosdroits/F34009

## Règle de mise en production

Pas de fusion vers `main), pas de remplacement du calculateur courant et pas de publication tant que :
1. la matrice de tests est verte ;
2. les différences importantes sont expliquées ;
3. les limites visibles dans l'interface correspondent aux limites réelles ;
4. l'audit des scénarios, du partage, des sauvegardes et de la génération autonome est terminé ;
5. l'utilisateur a explicitement approuvé la bascule.
