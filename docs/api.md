# API Archero Observer

Cette première version fournit une API HTTP JSON en lecture seule, stable et adaptée à un bot Discord. Son préfixe est `/api/v1`.

La spécification exploitable par Swagger UI, Postman ou un générateur de client se trouve dans [`openapi.yaml`](./openapi.yaml).

Lorsque le dashboard fonctionne, une version directement consultable est disponible à l'adresse `/api-docs` et la spécification téléchargeable à `/openapi.yaml`.

## Ce qu'il est pertinent d'exposer

| Donnée | Usage Discord | Exposée en v1 |
| --- | --- | --- |
| État et fraîcheur de la collecte | Informer si les données sont à jour | Oui |
| Résumé de guilde | Commande `/guild` | Oui |
| Membres et métriques vérifiées | `/member`, recherche et listes | Oui |
| Évaluation selon les règles | Alertes et modération assistée | Oui |
| Classements boss | `/boss`, `/top` | Oui |
| Liaison Discord | Indiquer si une liaison existe | Booléen seulement |
| Notes d'officier, raisons d'absence | Données privées | Non |
| Captures et résultats OCR bruts | Débogage interne | Non |
| Import, upload, suppression | Administration | Non |

L'API ne doit pas devenir une porte d'entrée vers les routes existantes sous `/api/data`. Ces routes déclenchent des actions locales et restent réservées au dashboard.

## Authentification

Définir une ou plusieurs clés, séparées par des virgules :

```env
ARCHERO_API_KEYS=une-cle-longue-et-aleatoire,cle-de-rotation
```

Le bot envoie ensuite l'un de ces en-têtes :

```http
Authorization: Bearer une-cle-longue-et-aleatoire
```

ou :

```http
X-API-Key: une-cle-longue-et-aleatoire
```

Sans `ARCHERO_API_KEYS`, l'authentification est désactivée afin de faciliter le développement local. En production, une clé doit toujours être configurée et transmise uniquement via HTTPS. La route `/api/v1/health` reste publique.

## Routes disponibles

### `GET /api/v1/health`

Test de disponibilité, sans authentification.

### `GET /api/v1/guild`

Résumé compact : effectif, places libres, membres à surveiller, liaisons Discord et dates de collecte/import.

### `GET /api/v1/rules`

Règles publiques utilisées pour évaluer l’activité, la contribution, la progression et les essais boss.

### `GET /api/v1/members`

Liste paginée des membres.

Paramètres :

- `q` : recherche insensible à la casse et aux accents sur le nom ou le Player ID ;
- `status` : `active` (défaut), `former` ou `all` ;
- `limit` : 1 à 100, défaut 25 ;
- `offset` : défaut 0.

Exemple :

```bash
curl -H "Authorization: Bearer $ARCHERO_BOT_API_KEY" \
  "https://example.org/api/v1/members?q=alice&limit=10"
```

### `GET /api/v1/members/{playerId}`

Détail public d'un membre. La recherche exacte par Player ID évite les collisions de pseudonymes.

### `GET /api/v1/members/resolve`

Résout un membre avec `q` (obligatoire) depuis un Player ID, un nom normalisé, un alias ou une faute légère. `limit` est optionnel, compris entre 1 et 10, avec une valeur par défaut de 5.

### `GET /api/v1/members/{playerId}/history`

Historique quotidien des métriques d’un membre. Chaque journée contient aussi les alertes métier calculées (`game_absence`, `low_contribution`, `low_progression`, `missed_boss`), leur suivi d’officier dans `action`, et la réponse fournit `warningSummary`. Les statuts de suivi sont `pending`, `noted`, `contacted`, `excused` et `resolved`. Les paramètres `from` et `to` utilisent le format `YYYY-MM-DD`.

### `GET /api/v1/members/{playerId}/bosses`

Retourne le record global, le classement hebdomadaire et, pour chaque boss, le meilleur dégât, le rang dans la guilde, le nombre de participations et le dernier résultat.

### `GET /api/v1/violations`

Retourne séparément la watchlist actuelle (`members`) et l’historique des alertes automatiques (`history`). Une alerte marquée `excused` ou `resolved` disparaît de la watchlist actuelle mais reste dans l’historique avec sa date, la note et le statut de suivi. Filtres : `severity=warning|danger`, `flag`, `playerId`, `from`, `to` et `limit` (1 à 1000, 200 par défaut). `historyPagination` indique le total et s’il reste des résultats.

### `GET /api/v1/rankings/members`

Classement général avec `metric=power|contribution7d|powerDelta|contributionDelta|bossAttacks|activity`, `order=asc|desc` et `limit`. L’ordre par défaut est `desc`, sauf pour `activity` qui utilise `asc`.

### `GET /api/v1/bosses`

Catalogue des sept boss avec nombre de joueurs enregistrés, record et détenteur du record.

### `GET /api/v1/boss-results`

Résultats journaliers comprenant rang, joueur, dégâts numériques et texte affiché dans le jeu. Filtres : `date`, `boss`, `playerId` et `limit`.

### `GET /api/v1/rankings/boss/all-time?limit=10`

Meilleur score historique de chaque membre.

### `GET /api/v1/rankings/boss/weekly?week=YYYY-MM-DD&limit=10`

Totaux de la semaine dont la date fournie est le lundi. Sans `week`, retourne la semaine la plus récente disponible.

### `GET /api/v1/rankings/boss/by-boss?boss=fire-dragon&limit=10`

Meilleurs scores par boss. Sans `boss`, retourne les sept groupes.

## Format des réponses

Succès :

```json
{
  "data": {},
  "meta": {
    "apiVersion": "v1",
    "generatedAt": "2026-07-26T12:00:00.000Z",
    "source": "database"
  }
}
```

Erreur :

```json
{
  "error": {
    "code": "member_not_found",
    "message": "No member matches this player ID."
  },
  "meta": {
    "apiVersion": "v1",
    "generatedAt": "2026-07-26T12:00:00.000Z"
  }
}
```

Codes attendus : `200`, `400`, `401` et `404`. `meta.source` vaut `database` ou `local`. Une éventuelle `meta.warning` signifie que PostgreSQL était indisponible et que les données locales de démonstration ont servi de repli.

## Intégration dans un bot Discord

Le bot doit garder la clé côté serveur, appeler l'API uniquement lors d'une interaction et présenter `meta.warning` aux administrateurs. Un cache de 15 à 60 secondes côté bot suffit pour les classements. Il ne faut jamais copier la clé dans une commande, un embed ou un journal public.

Correspondance de commandes conseillée :

| Commande Discord | Appel API |
| --- | --- |
| `/guild` | `GET /api/v1/guild` |
| `/member player_id:123` | `GET /api/v1/members/123` |
| `/member-search name:alice` | `GET /api/v1/members?q=alice` |
| `/boss mode:weekly` | `GET /api/v1/rankings/boss/weekly` |
| `/boss boss:fire-dragon` | `GET /api/v1/rankings/boss/by-boss?boss=fire-dragon` |

## Prochaines évolutions

Après validation de ces contrats :

1. ajouter une vraie liaison `discord_user_id` administrable, sans exposer le nom Discord ;
2. ajouter limitation de débit et journalisation des accès ;
3. exposer un historique membre paginé ;
4. ajouter des webhooks signés pour notifier une fin d'import ou un nouveau classement ;
5. supprimer le repli vers les données de démonstration en production.
