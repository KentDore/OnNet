# Onnet

**Le brut promet. Le net décide.**

Onnet est un simulateur brut → net pour salaires français. Il permet de comparer plusieurs salaires côte à côte — poste actuel, offre reçue, augmentation en négociation — et de voir immédiatement ce qui atterrit vraiment sur le compte en banque.

Application 100 % autonome : un seul fichier HTML, aucune dépendance à installer, aucun serveur, aucune donnée envoyée où que ce soit.

## Utilisation

Ouvrir `Onnet-1.0.3.html` (ou le fichier `.html` à la version la plus récente) directement dans un navigateur. Aucune installation n'est nécessaire.

## Versions

Le nom de fichier suit le [versionnage sémantique](https://semver.org/lang/fr/) `MAJEUR.MINEUR.CORRECTIF` :
- **MAJEUR** — refonte ou changement important dans la façon d'utiliser l'outil
- **MINEUR** — nouvelle fonctionnalité (rétrocompatible)
- **CORRECTIF** — correction de bug ou ajustement visuel/ergonomique sur l'existant

## Fonctionnalités

- **Comparaison multi-salaires** — ajoutez autant de salaires que nécessaire et comparez-les côte à côte
- **Calcul détaillé des cotisations** — tranche 1 / tranche 2, CSG/CRDS, retraite complémentaire, calculées ligne par ligne selon le statut (non-cadre, cadre, fonction publique, taux forfaitaire)
- **Titres restaurant** — avec vérification des seuils (part patronale 50–60 %, plafond par titre) et alerte en cas de réintégration dans l'assiette de cotisations
- **Heures supplémentaires** — bascule 35h / 39h avec calcul de la majoration et de la réduction de cotisations
- **Prélèvement à la source** — estimation du net après impôt à partir du taux personnel renseigné
- **Salaire horaire** — comparaison du taux horaire brut et net, utile pour comparer des volumes horaires différents
- **Modules d'augmentation et d'absence** — simulez une hausse de salaire (en % ou en €) ou une absence (congés payés, arrêt de travail) et ajoutez le résultat comme nouveau salaire à comparer
- **Graphique de répartition** — visualisation en colonnes de la ventilation brut → cotisations → mutuelle/titres restaurant → net, avec sélection du salaire de référence en un clic
- **Impression / export PDF** — mise en page dédiée pour imprimer ou exporter le comparatif

## Limites

Cet outil reste une estimation. Ne sont pas modélisés : la régularisation progressive du plafond de sécurité sociale en cours d'année, le temps partiel, la prévoyance, les régimes Alsace-Moselle, la réduction générale de cotisations patronales, et le barème progressif de l'impôt sur le revenu (le taux de prélèvement à la source utilisé est celui renseigné par l'utilisateur, il n'est pas recalculé). L'estimation d'arrêt de travail est une simplification qui ne reproduit pas le calcul réel des indemnités journalières de sécurité sociale (IJSS).

Pour un chiffre exact, se référer au bulletin de paie ou à un expert-comptable / service RH.

## Stack technique

- HTML / CSS / JavaScript vanilla — aucune dépendance externe hormis les polices Google Fonts (Fraunces, Inter, IBM Plex Mono)
- Aucun build, aucun framework — un seul fichier, ouvrable directement dans n'importe quel navigateur

## Paramètres légaux

Les taux de cotisations, plafonds (PMSS/PASS) et paramètres légaux sont définis en début de script (objet `P`) et correspondent aux règles 2026. Ils devront être mis à jour chaque année.
