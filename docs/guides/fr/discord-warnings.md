# Guide rapide — API des warnings Archero Guild

Ce guide explique comment consulter les warnings de la guilde depuis un bot
Discord ou un autre outil.

> Statut : guide opérateur en français. Le contrat canonique reste
> [`../../api.md`](../../api.md) et [`../../openapi.yaml`](../../openapi.yaml).

## Accès à l’API

URL de base :

```text
https://archero.cheark0x79.com
```

Toutes les routes ci-dessous nécessitent une clé API :

```http
Authorization: Bearer VOTRE_CLE_API
Accept: application/json
```

La clé doit rester privée et être utilisée uniquement côté serveur. Elle ne
doit jamais être placée dans un bot public, une page web ou un dépôt Git.

## Types de warnings

| Type technique | Signification |
| --- | --- |
| `game_absence` | Le membre ne s’est pas connecté depuis la durée autorisée |
| `low_contribution` | Les donations du membre sont sous le minimum demandé |
| `low_progression` | La progression de puissance est sous le minimum demandé |
| `missed_boss` | Le membre n’a pas effectué le nombre demandé d’essais de boss |

Les seuils actuels peuvent être consultés avec :

```http
GET /api/v1/rules
```

## 1. Warnings actuels

Retourne uniquement les membres ayant actuellement au moins un warning.

```bash
curl \
  -H "Authorization: Bearer VOTRE_CLE_API" \
  -H "Accept: application/json" \
  "https://archero.cheark0x79.com/api/v1/warnings"
```

Exemple de réponse :

```json
{
  "data": {
    "summary": {
      "totalMembers": 2,
      "warningCountsByType": {
        "game_absence": 1,
        "missed_boss": 2
      }
    },
    "members": [
      {
        "playerId": "120015103",
        "name": "ExampleMember",
        "lastSeenAt": "2026-07-29",
        "evaluation": {
          "status": "Absent",
          "warnings": [
            {
              "type": "game_absence",
              "label": "Game absence"
            },
            {
              "type": "missed_boss",
              "label": "Missed boss"
            }
          ]
        }
      }
    ]
  },
  "meta": {
    "apiVersion": "v1",
    "source": "database",
    "dataMode": "live",
    "partial": false
  }
}
```

Filtrer par type :

```http
GET /api/v1/warnings?type=missed_boss
```

## 2. Classement des warnings

Retourne les membres classés selon leur nombre de warnings.

```bash
curl \
  -H "Authorization: Bearer VOTRE_CLE_API" \
  -H "Accept: application/json" \
  "https://archero.cheark0x79.com/api/v1/rankings/warnings?scope=history&limit=10"
```

Exemple de réponse :

```json
{
  "data": {
    "totalMembers": 19,
    "rankings": [
      {
        "rank": 1,
        "playerId": "119960803",
        "name": "ExampleMember",
        "totalWarnings": 6,
        "warningCountsByType": {
          "game_absence": 2,
          "low_contribution": 2,
          "missed_boss": 2
        },
        "lastWarningAt": "2026-07-29"
      }
    ]
  }
}
```

Paramètres utiles :

- `scope=current` : uniquement les warnings actuels ;
- `scope=history` : historique complet ;
- `type=missed_boss` : filtre sur un type ;
- `from=2026-07-01&to=2026-07-31` : filtre par période ;
- `order=desc` : membres avec le plus de warnings en premier ;
- `limit=10` : nombre maximum de membres retournés.

## 3. Historique d’un membre

Retourne les warnings d’un membre précis.

```bash
curl \
  -H "Authorization: Bearer VOTRE_CLE_API" \
  -H "Accept: application/json" \
  "https://archero.cheark0x79.com/api/v1/members/120015103/warnings?scope=history&limit=100"
```

Exemple de réponse :

```json
{
  "data": {
    "playerId": "120015103",
    "name": "ExampleMember",
    "summary": {
      "totalWarnings": 2,
      "warningCountsByType": {
        "game_absence": 1,
        "missed_boss": 1
      },
      "lastWarningAt": "2026-07-29"
    },
    "warnings": [
      {
        "date": "2026-07-29",
        "type": "game_absence",
        "label": "Game absence",
        "value": 1,
        "threshold": 1
      },
      {
        "date": "2026-07-29",
        "type": "missed_boss",
        "label": "Missed boss",
        "value": 0,
        "threshold": 2
      }
    ],
    "pagination": {
      "limit": 100,
      "totalWarnings": 2,
      "hasMore": false
    }
  }
}
```

## Ignorer manuellement un warning

Cette action se fait depuis le site avec un compte administrateur :

1. ouvrir **Members** ;
2. sélectionner le membre ;
3. descendre jusqu’à **Automatic warning history** ;
4. cliquer sur **Ignore warning**.

Un warning ignoré :

- reste visible dans l’historique administratif ;
- ne compte plus dans la liste des warnings actuels ;
- ne compte plus dans le classement ;
- peut être réactivé avec **Restore warning**.

## Codes HTTP

| Code | Signification |
| --- | --- |
| `200` | Requête réussie |
| `400` | Paramètre incorrect |
| `401` | Clé API absente ou incorrecte |
| `404` | Membre introuvable |
| `429` | Trop de requêtes |
| `503` | API, base de données ou règles temporairement indisponibles |
