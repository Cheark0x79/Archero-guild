# OCR distant : PC BlueStacks vers pré-production ou production

## But

Tesseract, ADB et les captures restent sur le PC. Le serveur ne fait tourner que
le site Next.js, l'API d'ingestion et PostgreSQL. Une journée validée est envoyée
en JSON par HTTPS : aucun commit Git et aucun accès distant à PostgreSQL ne sont
nécessaires.

```text
BlueStacks / ADB
       |
       v
captures PNG sur le PC
       |
       v
conteneur OCR (Tesseract)
       |
       | 1. récupération du roster
       | 2. validation du lot JSON
       | 3. publication explicite
       v
API pré-prod ou prod ──> PostgreSQL ──> dashboard
```

Les images brutes restent sur le PC. Le serveur reçoit les valeurs OCR, le texte
brut, les noms reliés, la version de l'agent et le SHA-256 de chaque image.

## 1. Configurer le serveur

Dans le fichier `.env.production` de la pré-production ou de la production,
définir une clé dédiée :

```dotenv
ARCHERO_INGESTION_KEYS=une-cle-longue-aleatoire-dediee-a-ocr
```

Cette clé est différente du mot de passe admin, des clés API publiques et du mot
de passe PostgreSQL. Le service `app` reçoit cette variable depuis
`docker-compose.prod.yml`.

Redéployer ensuite l'application :

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build app
```

Le serveur expose trois routes protégées par cette clé :

- `GET /api/v1/imports/roster` : roster actif utilisé pour relier les noms ;
- `POST /api/v1/imports/validate` : contrôle sans écriture ;
- `POST /api/v1/imports` : publication transactionnelle dans PostgreSQL.

## 2. Configurer le PC OCR

Copier `.env.ocr.example` vers `.env.ocr` :

```dotenv
ARCHERO_TARGET_URL=https://preprod.archero.example.com
ARCHERO_INGESTION_TOKEN=la-meme-cle-que-sur-la-preprod
ARCHERO_AGENT_VERSION=2026.07.29
ARCHERO_CAPTURE_ROOT=./screenshots/raw
ARCHERO_OUTBOX_ROOT=./data/outbox
```

Le fichier `.env.ocr` est ignoré par Git. Créer un fichier différent pour
chaque environnement, par exemple `.env.ocr.preprod` et `.env.ocr.prod`, avec
des clés différentes.

Construire l'agent :

```powershell
docker compose --env-file .env.ocr -f compose.ocr.yml build
```

Le conteneur est éphémère : il libère CPU et RAM dès que la commande se termine.

État et arrêt explicite du projet OCR :

```powershell
docker compose --env-file .env.ocr -f compose.ocr.yml ps
docker compose --env-file .env.ocr -f compose.ocr.yml down
```

`down` supprime uniquement le conteneur et le réseau OCR. Il ne supprime ni
l’image Docker, ni les captures, ni les JSON de `data/outbox`.

## 3. Ranger les captures

Pour une journée, conserver cette structure :

```text
screenshots/raw/2026-07-28/
├── guild/
│   ├── members-001.png
│   └── ...
└── boss/
    ├── boss-001.png
    └── ...
```

La première image boss doit contenir le podium. Les autres images peuvent encore
montrer le podium : l'agent ne l'importe qu'une fois.

## 4. Valider sans publier

La commande sûre par défaut exécute l'OCR, écrit le lot dans `data/outbox`, puis
demande au serveur de le valider sans modifier PostgreSQL :

```powershell
docker compose --env-file .env.ocr -f compose.ocr.yml run --rm agent `
  --date 2026-07-28
```

Contrôler ensuite `data/outbox/2026-07-28.json` :

- `quality.status` doit être `pass` ;
- `coverage` et `completeness` doivent valoir `1` ;
- vérifier en priorité les `rawName`, `name`, `playerId`, donations et dégâts ;
- vérifier les lignes marquées en rouge dans OCR Lab/Check avant publication.

Une couverture à 100 % signifie que chaque champ existe, pas que chaque nom est
nécessairement correct. La validation humaine reste donc nécessaire.

## 5. Publier explicitement

Après validation humaine, publier le JSON exact qui vient d’être contrôlé avec
`--publish` :

```powershell
docker compose --env-file .env.ocr -f compose.ocr.yml run --rm agent `
  --date 2026-07-28 --publish
```

Avec `--publish`, l’agent ne relance pas Tesseract : il lit
`data/outbox/2026-07-28.json`. Le serveur revalide ce lot puis remplace la
journée dans une transaction. En cas d'erreur, l'ancienne journée reste visible.
La clé d'idempotence empêche un double clic ou une nouvelle tentative d'ajouter
des doublons.

Pour vérifier le résultat, ouvrir `/admin/check`, sélectionner la journée et
recharger la page.

## 6. Importer plusieurs journées historiques

Valider d'abord toutes les journées :

```powershell
$dates = @("2026-07-25", "2026-07-26", "2026-07-27", "2026-07-28")
foreach ($date in $dates) {
  docker compose --env-file .env.ocr -f compose.ocr.yml run --rm agent --date $date
  if ($LASTEXITCODE -ne 0) { throw "Validation OCR échouée pour $date" }
}
```

Après contrôle des fichiers dans `data/outbox`, remplacer la dernière commande
par `--date $date --publish`. Il est recommandé de publier du jour le plus
ancien au plus récent.

## 7. Pré-production puis production

Le chemin conseillé est :

1. envoyer vers la pré-production ;
2. contrôler `/admin/check` et les pages membres/boss ;
3. envoyer le même jour vers la production avec le fichier d'environnement
   production ;
4. vérifier le statut de l'import et le dashboard.

Les lots ne transitent pas par Git. Git contient uniquement le code et le contrat
JSON ; PostgreSQL contient les données publiées.

## Sécurité et sauvegardes

- utiliser uniquement HTTPS hors de `localhost` ;
- ne jamais exposer PostgreSQL sur Internet ;
- ne jamais committer `.env.ocr`, `.env.production` ou les vraies clés ;
- sauvegarder PostgreSQL avant une série d'imports historiques ;
- conserver sur le PC les captures brutes et `data/outbox` pour pouvoir auditer
  ou rejouer une journée ;
- utiliser des clés d'ingestion différentes en pré-production et production.

Les commandes exactes de sauvegarde et de restauration PostgreSQL sont
documentées dans [`production-homelab.md`](production-homelab.md#backups).

## Limite actuelle

`--publish` publie immédiatement après la validation automatique. La validation
humaine se fait donc entre la première commande sans option et la seconde avec
`--publish`. Une évolution future pourra stocker le lot en staging sur le
serveur et ajouter un bouton `Publier l'import` directement dans `/admin/check`.
