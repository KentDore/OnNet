# Feuille de route — calcul salarial OnNet

Ce document résume les choix structurants de la migration vers l’API Mon-entreprise / Urssaf. Pour le périmètre actuellement livré et les limites connues, le [README](../README.md) fait foi.

## Architecture retenue

Le calculateur principal appelle l’API REST officielle `POST /api/v1/evaluate`. OnNet ne substitue pas de calcul local lorsque le service est indisponible : une erreur est affichée plutôt qu’un résultat non confirmé.

La construction des entrées, la validation des réponses et le cache sont séparés dans des modules dédiés. Les tests navigateur utilisent des réponses simulées ; les contrôles réseau réels sont lancés séparément afin de limiter les appels au service.

## Périmètre fonctionnel

- Comparaison de plusieurs offres et scénarios de rémunération.
- Salaire brut mensuel, durée de travail de 35 h ou 39 h et commune d’établissement.
- Net calculé, cotisations salariales et employeur, heures supplémentaires.
- Mutuelle avec parts salariale et employeur.
- Titres-restaurant avec valeur, nombre et répartition des participations.
- Repères SMIC et salaire médian.
- Sauvegarde locale, partage par URL, impression et export PDF.

## Contrôles à maintenir

- Refuser les entrées invalides et les situations qui ne sont pas prises en charge.
- Bloquer l’affichage lorsque l’API renvoie une valeur essentielle absente, non numérique ou une erreur bloquante.
- Afficher les avertissements et valeurs par défaut signalés par le moteur.
- Contrôler les scénarios 35 h et 39 h, les heures supplémentaires, la mutuelle et les titres-restaurant.
- Vérifier le rendu desktop/mobile et la génération du HTML autonome après chaque évolution de structure.
- Ne pas assimiler une cohérence de calcul automatisée à une validation indépendante d’un bulletin de paie.

## Limites connues

Le périmètre standard ne couvre pas toutes les conventions collectives, les cadres, le temps partiel, la fonction publique ou certains régimes particuliers. Les règles et paramètres pris en compte sont détaillés dans le README et doivent être revus lors des mises à jour de l’API.
