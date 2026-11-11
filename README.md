# OnNet

**Le brut promet. Le net décide.**

OnNet est un simulateur de salaire brut → net pour le secteur privé français. Il compare plusieurs offres ou scénarios, y compris les différences d'horaires, de primes et de mensualités.

L'application fonctionne dans le navigateur, sans compte ni serveur de calcul. Les scénarios sont enregistrés localement dans le navigateur. Elle n'envoie pas automatiquement les données à un serveur.

**Attention aux liens de partage :** les données choisies sont encodées dans le fragment de l'URL. Ce n'est ni chiffré ni protégé par mot de passe ; toute personne qui reçoit le lien peut lire les données incluses. N'incluez les détails de paie et la situation fiscale que si nécessaire.

## Utilisation

- Ouvrir `Onnet-2.1.2.html` pour utiliser la version autonome hors ligne.
- `index.html` correspond à la version publiée sur GitHub Pages.
- Aucune installation n'est nécessaire pour utiliser l'application.

## Version 2.1.2

- **Repères salariaux cohérents** : les écarts au SMIC et au salaire médian sont désormais calculés en net avant impôt, sur une base de 35 h. Le salaire net estimé après impôt affiché pour l'utilisateur reste inchangé.
- **SMIC** : affichage du brut mensuel à 35 h, du taux horaire brut correspondant et d'une estimation du net avant impôt.
- **Salaire médian** : utilisation directe du repère de 2 190 € net avant impôt (INSEE 2024), sans reconstitution artificielle ni application du taux fiscal individuel.

## Version 2.1.0

- **Mutuelle distincte** : saisie de la part salariale et de la part employeur. La part employeur est réintégrée au net imposable ; la part salariale réduit le net payé, mais n'est pas déduite du revenu imposable.
- **13ᵉ/14ᵉ mois** : option pour préciser si les heures supplémentaires sont incluses dans la mensualité supplémentaire d'un contrat à 39 h.
- **Foyer fiscal** : distinction entre personne seule, imposition commune des personnes mariées/pacsées et concubinage avec déclarations séparées ; ajout du cas parent isolé (case T). La résidence alternée n'est pas modélisée.
- **Partage maîtrisé** : sélection des salaires à inclure, avec options séparées pour les détails de paie et la situation fiscale.
- **Comparaison et ergonomie** : l'insight suit la métrique sélectionnée, le panneau des repères salariaux utilise les couleurs du thème, et les événements du bouton d'ajout et des modales sont sécurisés contre les erreurs de démarrage et les courses d'animation.
- Synchronisation de `index.html` et du fichier autonome versionné avec les sources de développement.

## Fonctionnalités

- Comparaison multi-salaires et réorganisation des cartes par glisser-déposer ou au clavier.
- Saisie mensuelle ou annuelle, primes, nombre de mensualités (1 à 24, avec 12/13/14 comme cas usuels) et choix de base pour le 13ᵉ/14ᵉ mois.
- Calcul estimatif des cotisations du régime non-cadre du secteur privé : CSG/CRDS, vieillesse, retraite complémentaire, réduction sur les heures supplémentaires.
- Titres-restaurant avec vérification des limites de participation employeur et du plafond d'exonération.
- Impôt sur le revenu estimé au barème 2026 applicable aux revenus 2025, ou calcul au taux de prélèvement à la source saisi par l'utilisateur.
- Net horaire, net annuel, net après impôt, graphique de répartition, comparaison au SMIC estimé et à un repère national de salaire médian.
- Modules d'augmentation et d'absence, impression et export PDF via le navigateur.

## Limites à connaître

OnNet fournit une **estimation**, pas un bulletin de paie. Le moteur modélise uniquement un salarié non-cadre du secteur privé. Il ne couvre pas notamment le temps partiel, la régularisation progressive des plafonds en cours d'année, la prévoyance et les régimes Alsace-Moselle.

- **Mutuelle** : les valeurs par défaut sont des exemples de 30 € côté salarié et 30 € côté employeur ; remplacez-les par les montants du bulletin de paie. Les anciennes sauvegardes sans part employeur distincte conservent une hypothèse d'égalité avec la part salariale.
- **Absences** : congés et arrêts sont simplifiés ; l'arrêt ne reproduit pas le calcul réel des IJSS, de l'ancienneté et de la convention collective.
- **Heures supplémentaires** : la part de net imposable qui leur est attribuable est estimée au prorata du brut.
- **Impôt** : le montant affiché est le supplément d'impôt imputable au salaire comparé, pas l'impôt total du foyer. Ne sont pas intégrés les crédits/réductions d'impôt, revenus fonciers ou de capitaux, pensions, taux neutre ou individualisé, acomptes, régularisations et contribution exceptionnelle sur les hauts revenus. Le barème 2027 applicable aux revenus 2026 n'étant pas encore connu, l'estimation de ces revenus restera approximative.
- **Parent isolé** : le cas de la résidence alternée et les situations fiscales particulières non décrites dans l'interface ne sont pas modélisés.
- **Repères salariaux** : le salaire médian est une référence nationale du privé (INSEE 2024), pas un repère spécifique au métier ou à la région. Le net du SMIC est estimé par le simulateur.

Le coût employeur n'est pas calculé : une majoration forfaitaire du brut donnerait une estimation trompeuse, notamment autour du SMIC.

## Dernière correction — 2.1.4

Les deux cartes de repères affichent le net mensuel avant impôt en valeur principale et le taux horaire net en complément. Le brut mensuel est affiché pour le SMIC ; il n'est pas inventé pour le salaire médian INSEE, dont la donnée utilisée est uniquement nette.

## Développement et versionnage

Les sources de développement sont dans `src/`. Le script génère un fichier HTML autonome contenant les styles et les scripts :

```sh
node scripts/build.js 2.1.0
node scripts/build.js 2.1.0 index.html
```

La première commande génère `Onnet-2.1.0.html` ; la seconde reconstruit la page `index.html` publiée. Les deux fichiers doivent rester identiques.

Le versionnage suit [SemVer](https://semver.org/lang/fr/) : majeur pour une rupture importante, mineur pour une nouvelle fonctionnalité rétrocompatible, correctif pour une correction ou un ajustement visuel.

## Tests

```sh
node --test test/calc.test.js
node --test test/build.test.js
node --test test/ui.test.js
```

Les tests navigateur nécessitent Playwright et Chromium. La CI les installe automatiquement. Les tests vérifient aussi que `index.html` et le fichier autonome versionné correspondent exactement aux sources.

Les paramètres légaux sont regroupés au début de `src/calc.js` et doivent être revalidés chaque année.
