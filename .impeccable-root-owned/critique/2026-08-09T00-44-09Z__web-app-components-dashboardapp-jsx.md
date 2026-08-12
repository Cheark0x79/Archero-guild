---
target: Dashboard Web Archero Guild
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-08-09T00-44-09Z
slug: web-app-components-dashboardapp-jsx
---
# Critique Impeccable — Dashboard Web Archero Guild

## Design Health Score

| # | Heuristique | Score | Problème principal |
|---|---|---:|---|
| 1 | Visibilité de l’état du système | 3/4 | Chargement et fraîcheur visibles, mais sans traduire la conséquence opérationnelle. |
| 2 | Correspondance avec le monde réel | 3/4 | Le vocabulaire guilde est adapté, mais « captures » et plusieurs dénominateurs restent ambigus. |
| 3 | Contrôle et liberté | 3/4 | Navigation réversible, mais peu de métriques permettent d’ouvrir directement les membres concernés. |
| 4 | Cohérence et standards | 4/4 | Tokens, espacements, composants et interactions sont très cohérents. |
| 5 | Prévention des erreurs | 3/4 | Peu de risques destructifs, mais les données partielles ne disent pas si une décision est sûre. |
| 6 | Reconnaissance plutôt que rappel | 3/4 | Les libellés aident, mais les relations entre snapshot, roster et participation doivent être déduites. |
| 7 | Flexibilité et efficacité | 2/4 | Pas de vue exceptions, de plage mémorisée, de cross-filter ni de raccourci vers les problèmes. |
| 8 | Esthétique et minimalisme | 2/4 | Plusieurs couches répètent membres, roster, captures et boss sans hiérarchie décisive. |
| 9 | Diagnostic et récupération d’erreur | 2/4 | Retry présent, mais indisponible, incomplet et périmé sont confondus. |
| 10 | Aide et documentation | 2/4 | Les agrégations, dénominateurs et seuils ne sont pas expliqués dans le contexte. |
| **Total** | | **27/40** | **Acceptable, fondation solide mais améliorations importantes nécessaires.** |

## Verdict de spécificité

Le vocabulaire est propre à Archero 2, mais l’expression visuelle reste interchangeable avec un dashboard SaaS : sidebar sombre, cartes neutres, accent bleu et trois graphiques de poids égal. La page paraît fiable et cohérente, mais pas encore conçue comme un poste de commandement de guilde. L’opportunité principale est de passer d’un écran qui décrit les données à un écran qui aide immédiatement un officier à agir.

Le scan déterministe a trouvé une seule alerte `overused-font` dans `web/app/api-docs/api-docs.module.css:16` pour `Inter`. Elle est réelle mécaniquement mais hors de la surface Dashboard ; elle est donc classée comme faux positif contextuel pour cette critique.

## Impression générale

La base est propre, responsive et disciplinée. L’œil ne sait toutefois pas où commencer : snapshot, raccourcis, KPIs et graphiques ont presque la même autorité. L’absence d’une file « Needs attention » fait perdre le bénéfice opérationnel promis par le Dashboard.

## Ce qui fonctionne

- Le système visuel est cohérent : tokens, espacements, rayons, titres et contrôles se répètent de manière prévisible.
- Les états de base sont soignés : skeleton, état vide, retry, rôle et réduction des animations.
- Le responsive évite correctement le débordement horizontal et empile les graphiques proprement.

## Problèmes prioritaires

### P1 — Aucune couche opérationnelle « Needs attention »

**Pourquoi :** l’officier doit interpréter plusieurs totaux avant de savoir qui ou quoi nécessite une action.

**Correction :** placer sous l’en-tête une file compacte d’exceptions : capture incomplète, membres sous les seuils, boss non réalisé, donnée périmée et capacité. Chaque ligne doit fournir sévérité, nombre concerné, action recommandée et lien vers une vue filtrée.

**Commande :** `$impeccable clarify`

### P1 — Navigation mobile trop longue avant le contenu

**Pourquoi :** à 390 px, la sidebar complète occupe environ 461 px de hauteur avant le Dashboard.

**Correction :** remplacer la sidebar mobile par un en-tête sticky compact avec identité de guilde, page active, rôle et bouton ouvrant un drawer accessible et focus-managed.

**Commande :** `$impeccable adapt`

### P1 — Contrôles et sens des graphiques insuffisamment accessibles

**Pourquoi :** les plages n’exposent pas `aria-pressed`, leurs groupes ont tous le même nom, les boutons font environ 28 px de haut, et le SVG ne donne pas la série complète au lecteur d’écran.

**Correction :** ajouter un label propre à chaque graphique, `aria-pressed`, un focus ring explicite, des cibles tactiles de 40–44 px et une synthèse textuelle ou table accessible des dates/valeurs. Annoncer poliment les changements de plage.

**Commande :** `$impeccable harden`

### P2 — Couches récapitulatives redondantes

**Pourquoi :** snapshot, tuiles d’action et KPIs répètent roster, membres, capture et boss avec des dénominateurs différents.

**Correction :** conserver une bande fraîcheur/complétude, une bande d’exceptions/action et une seule rangée KPI. Employer des libellés explicites comme « Roster 28/30 », « Membres capturés 27/28 » et « Participants boss 21/28 ».

**Commande :** `$impeccable distill`

### P2 — Identité visuelle trop générique

**Pourquoi :** les mots portent presque toute l’identité Archero ; le traitement pourrait appartenir à une application CRM ou financière.

**Correction :** faire du boss actuel un point focal sobre, utiliser le blason/monogramme de guilde et une hiérarchie d’accent plus affirmée, tout en gardant tableaux et outils Admin neutres.

**Commande :** `$impeccable colorize`

## Red flags par persona

**Alex, utilisateur avancé :** pas de file d’exceptions, de filtre croisé, de plage mémorisée ni de raccourci KPI → membres affectés. Il contournera probablement le Dashboard pour ouvrir directement Members ou Boss.

**Sam, utilisateur clavier/lecteur d’écran :** plages non exposées programmatiquement, labels génériques, série graphique inaccessible, focus parfois réduit à un changement de fond, et 18 contrôles sur 20 sous 44 px sur au moins une dimension.

**Maya, officier mobile :** la navigation complète et la longue colonne de cartes repoussent l’information urgente ; vérifier la guilde pendant une fenêtre boss demande trop de défilement.

## Observations mineures

- « Last update » et « Checkpoint » semblent dupliquer le même timestamp.
- Le hover des cartes non interactives peut faire croire qu’elles sont cliquables.
- « Boss » est trop vague pour une tuile ; « Today’s boss » serait plus précis.
- « Weekly donation peak » n’indique pas clairement s’il s’agit d’un cumul, d’un maximum ou d’un checkpoint.
- Les trois graphiques ont le même poids alors que la participation au boss courant est plus urgente.
- Deux réponses 503 de `/api/data/rules` ont été observées dans le navigateur, sans pageerror ni requête réseau considérée comme échouée par le runner.

## Questions à considérer

- Si un officier n’avait que dix secondes avant la fermeture du boss, quelle décision unique le Dashboard doit-il permettre ?
- Les viewers et les officiers doivent-ils réellement recevoir la même composition ?
- Le mot « capture » est-il utile à un membre, ou expose-t-il une notion technique interne ?
- Que perdrait-on en supprimant la moitié des cartes — et la réponse deviendrait-elle plus claire ?
