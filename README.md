# Onnet

**Le brut promet. Le net décide.**

Onnet est un simulateur brut → net pour salaires français. Il permet de comparer plusieurs salaires côte à côte — poste actuel, offre reçue, augmentation en négociation — et de voir immédiatement ce qui atterrit vraiment sur le compte en banque.

Application 100 % autonome : un seul fichier HTML, aucune dépendance à installer, aucun serveur, aucune donnée envoyée où que ce soit.

## Utilisation

Ouvrir `Onnet-1.4.1.html` (ou le fichier `.html` à la version la plus récente) directement dans un navigateur. Aucune installation n'est nécessaire.

## Versions

Le nom de fichier suit le [versionnage sémantique](https://semver.org/lang/fr/) `MAJEUR.MINEUR.CORRECTIF` :
- **MAJEUR** — refonte ou changement important dans la façon d'utiliser l'outil
- **MINEUR** — nouvelle fonctionnalité (rétrocompatible)
- **CORRECTIF** — correction de bug ou ajustement visuel/ergonomique sur l'existant

## Fonctionnalités

- **Comparaison multi-salaires** — ajoutez autant de salaires que nécessaire et comparez-les côte à côte
- **Calcul détaillé des cotisations** — tranche 1 / tranche 2, CSG/CRDS, retraite complémentaire, calculées ligne par ligne selon le statut (non-cadre, cadre, fonction publique, taux forfaitaire)
- **Titres restaurant** — avec vérification des seuils (part patronale 50–60 %, plafond par titre) et alerte en cas de réintégration dans l'assiette de cotisations
- **Heures supplémentaires** — bascule 35h / 39h avec calcul de la majoration, de la réduction de cotisations salariales et de l'exonération d'impôt sur le revenu (plafonnée à 7 500 € de net imposable par an)
- **Impôt sur le revenu** — net après impôt calculé au barème 2026 (abattement de 10 %, quotient familial plafonné, décote), à partir du foyer fiscal renseigné : seul ou en couple, personnes à charge, autres revenus du foyer
- **Salaire horaire** — comparaison du taux horaire brut et net, utile pour comparer des volumes horaires différents
- **Modules d'augmentation et d'absence** — simulez une hausse de salaire (en % ou en €) ou une absence (congés payés, arrêt de travail) et ajoutez le résultat comme nouveau salaire à comparer
- **Graphique de répartition** — visualisation en colonnes de la ventilation brut → cotisations → mutuelle/titres restaurant → net, avec sélection du salaire de référence en un clic
- **Impression / export PDF** — mise en page dédiée pour imprimer ou exporter le comparatif

## Limites

Cet outil reste une estimation. Ne sont pas modélisés : la régularisation progressive du plafond de sécurité sociale en cours d'année, le temps partiel, la prévoyance et les régimes Alsace-Moselle. L'estimation d'arrêt de travail est une simplification qui ne reproduit pas le calcul réel des indemnités journalières de sécurité sociale (IJSS).

Trois approximations assumées méritent d'être connues :

- **Fonction publique** — un taux salarial global de 20,63 % est appliqué (retenue pour pension 11,10 % + CSG/CRDS). Le RAFP et la distinction entre traitement indiciaire et primes ne sont pas modélisés.
- **Exonération d'IR sur les heures supplémentaires** — la part de net imposable attribuable aux heures supplémentaires est estimée au prorata du brut, les cotisations déductibles n'étant pas ventilables exactement entre heures normales et heures supplémentaires.
- **Impôt sur le revenu** — le montant affiché est le *supplément* d'impôt imputable au salaire, c'est-à-dire l'écart entre l'impôt du foyer avec et sans lui. C'est la bonne grandeur pour comparer deux salaires, mais ce n'est pas l'impôt du foyer entier. Ne sont pas pris en compte : crédits et réductions d'impôt, revenus fonciers ou de capitaux mobiliers, pensions, taux neutre ou individualisé, acomptes, régularisations en cours d'année et contribution exceptionnelle sur les hauts revenus. En couple, les autres revenus du foyer doivent être renseignés, sans quoi l'impôt est très sous-estimé — une alerte le signale dans la carte tant qu'ils sont à zéro.

Onnet ne calcule **que le côté salarié**. La métrique « Coût employeur » a été retirée en v1.3.0 : elle appliquait un forfait de +42 % sur le brut, en ignorant la réduction générale dégressive des cotisations patronales — laquelle s'applique jusqu'à 3 SMIC (5 469 €/mois en 2026) et ramène le coût réel au niveau du SMIC à environ +7 % au lieu de +42 %. La métrique était donc fausse pour la majorité des salaires, et l'écart entre deux salaires l'était aussi puisque la réduction est dégressive. Mieux valait la retirer que la laisser induire en erreur en négociation.

Pour un chiffre exact, se référer au bulletin de paie ou à un expert-comptable / service RH.

## Tests

Le moteur de calcul est couvert par une suite de non-régression sans dépendance :

```
node --test test/calc.test.js
```

Les tests extraient le bloc de calcul directement du fichier HTML (entre les marqueurs `ONNET_CALC_START` / `ONNET_CALC_END`) et s'exécutent donc sur le code réellement livré, pas sur une copie. Ils reprennent automatiquement le fichier `Onnet-X.Y.Z.html` à la version la plus élevée.

Les valeurs attendues signalées « calculé à la main » ont été posées indépendamment du programme, à partir des taux légaux. **Elles ne doivent pas être régénérées depuis la sortie du code** : elles n'ont de valeur que parce qu'elles en sont indépendantes.

## Stack technique

- HTML / CSS / JavaScript vanilla — aucune dépendance externe hormis les polices Google Fonts (Fraunces, Inter, IBM Plex Mono)
- Aucun build, aucun framework — un seul fichier, ouvrable directement dans n'importe quel navigateur

## Paramètres légaux

Les taux de cotisations, plafonds (PMSS/PASS) et paramètres légaux sont définis en début de script (objet `P`) et correspondent aux règles 2026. Ils devront être mis à jour chaque année.
