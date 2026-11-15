# Architecture du calcul salarial

Le calculateur principal utilise l’API REST officielle Mon-entreprise / Urssaf (`POST /api/v1/evaluate`). Il transmet les données nécessaires au scénario choisi après validation explicite de l’utilisateur. Il n’existe aucun moteur local de secours lorsque l’API est indisponible.

## Paramètres couverts

- Salaire brut mensuel et durée hebdomadaire de 35 h ou 39 h.
- Commune de l’établissement.
- Parts salariale et employeur de la mutuelle.
- Nombre, valeur et répartition des titres-restaurant.
- Date du calcul, nécessaire à l’évaluation des règles en vigueur.

Le scénario 39 h est construit à partir d’une base de 35 h et de quatre heures supplémentaires hebdomadaires. Le moteur officiel reconstitue le brut total ; OnNet vérifie que le résultat correspond au brut saisi.

## Résultats

L’application restitue le brut calculé, le net mensuel calculé, les cotisations, les heures supplémentaires, la mutuelle et les éléments liés aux titres-restaurant.

## Prototype de contrôle local

`src/publicodes-adapter.mjs` et `test/publicodes.test.js` conservent un adaptateur de développement basé sur `modele-social` / Publicodes. Il sert uniquement à tester des scénarios sociaux et à comparer les comportements du modèle local avec l’API. Il n’est jamais utilisé par l’application publiée et ne constitue pas un repli hors ligne.

Les comparaisons automatisées sont regroupées dans `scripts/compare-urssaf-api.mjs`, et les contrôles de cohérence des réponses API dans `scripts/smoke-urssaf-api.mjs`.

## Limites

Le périmètre est limité au CDI privé non-cadre en métropole, à temps plein, selon les hypothèses standard précisées dans le README. Certaines conventions collectives et situations particulières ne sont pas couvertes. Les résultats restent des estimations et ne remplacent pas un bulletin de paie vérifié.
