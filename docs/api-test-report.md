# Rapport de stabilisation API v1

Date : 2026-07-26

## Périmètre

Routes prioritaires pour le bot Discord :

- `GET /api/v1/health`
- `GET /api/v1/members`
- `GET /api/v1/members/resolve`
- `GET /api/v1/members/{playerId}`
- `GET /api/v1/members/{playerId}/history`
- `GET /api/v1/members/{playerId}/bosses`
- `GET /api/v1/violations`
- `GET /api/v1/rankings/members`
- `GET /api/v1/boss-results`
- `GET /api/v1/rankings/boss/{ranking}`

## Résultats automatiques

### Tests unitaires

50 tests réussis sur 50.

Ils couvrent notamment :

- authentification Bearer et `X-API-Key` ;
- pagination et filtres des membres ;
- normalisation et résolution approximative des noms ;
- calcul des violations ;
- classements ascendants et descendants ;
- historique des membres ;
- records et rangs par boss ;
- validation stricte des dates.

### Tests HTTP

24 scénarios réussis sur 24 contre le serveur Next.js réel.

Variantes testées :

- appels nominaux ;
- pagination ;
- recherche par nom ;
- membres anciens ;
- Player ID exact ;
- nom normalisé ;
- faute légère dans un nom ;
- query obligatoire absente ;
- membre inexistant ;
- filtres de sévérité ;
- métrique ou ordre invalide ;
- donations les plus faibles ;
- filtrage boss par date et joueur ;
- date syntaxiquement invalide ;
- date calendaire impossible ;
- intervalle de dates inversé ;
- semaine invalide ou ne commençant pas un lundi.

### Authentification HTTP

Vérification sur une instance séparée configurée avec `ARCHERO_API_KEYS` :

| Scénario | Résultat |
| --- | --- |
| `/health` sans token | `200` |
| `/members` sans token | `401` |
| `/members` avec le bon Bearer token | `200` |

Sur l’instance de développement principale, l’authentification reste volontairement désactivée lorsqu’aucune clé n’est configurée.

## Audit indépendant

Un agent a testé l’API en boîte noire avec uniquement la documentation et l’URL locale, sans consulter l’implémentation.

Problèmes confirmés puis corrigés :

- dates calendaires impossibles acceptées ;
- semaine non datée acceptée ;
- intervalle `from > to` non rejeté ;
- absence de résolution approximative d’un membre ;
- absence de classement ascendant pour les donations ;
- absence de profil boss individuel ;
- authentification indiquée à tort sur la route publique `/health`.

## Contrats stabilisés

### Résolution d’un membre

`GET /api/v1/members/resolve?q=Sendrok`

La résolution essaie, dans l’ordre :

- Player ID exact ;
- nom normalisé ;
- nom Discord ;
- ancien nom ;
- alias ;
- ressemblance orthographique.

En cas d’ambiguïté, l’API renvoie des suggestions au lieu de choisir silencieusement.

### Classements

`GET /api/v1/rankings/members` accepte maintenant :

- `metric`
- `order=asc|desc`
- `limit`

Le classement des donations les plus faibles utilise :

```text
?metric=contribution7d&order=asc
```

### Profil boss individuel

`GET /api/v1/members/{playerId}/bosses` retourne :

- record global ;
- classement de la semaine la plus récente ;
- meilleur résultat pour chaque boss ;
- rang du record parmi les membres actuels ;
- nombre de participations ;
- dernier résultat enregistré.

## Limites restantes

- Les tests utilisent actuellement la source locale, car PostgreSQL n’est pas connecté dans ce worktree.
- Les tokens restent configurés manuellement dans `ARCHERO_API_KEYS`; il n’existe pas encore de page d’administration pour les créer ou les révoquer.
- Il n’y a pas encore de limitation de débit.
- Les schémas OpenAPI peuvent encore être détaillés davantage pour générer automatiquement un client totalement typé.
