# Station OCR locale vers préproduction et production

## Architecture

La plateforme distante et la station OCR sont deux produits indépendants :

```text
PC Windows / WSL                         VM Proxmox
BlueStacks + captures                    Next.js + API
Interface locale :5190  --- HTTPS --->   PostgreSQL
Tesseract + outbox JSON                  Cloudflare Tunnel
```

Les images ne quittent pas le PC. Seul un lot JSON relu, versionné et validé est
publié. La plateforme ne possède ni Tesseract, ni ADB, ni montage de captures.

## 1. Configurer la plateforme

Créer `platform/.env.production` depuis `platform/.env.example` et définir une
clé dédiée :

```dotenv
ARCHERO_INGESTION_KEYS=une-cle-longue-aleatoire-dediee-a-ocr
```

Déployer la plateforme :

```bash
docker compose --env-file platform/.env.production -f platform/compose.yml up -d --build
```

Les routes machine-à-machine sont :

- `GET /api/v1/imports/roster` ;
- `POST /api/v1/imports/validate` ;
- `POST /api/v1/imports`.

Si Cloudflare Access protège le domaine, créer une politique `Service Auth` et
un Service Token. L’interface OCR enverra ses deux en-têtes Cloudflare en plus
de la clé d’ingestion propre à l’application.

## 2. Configurer la station OCR

Depuis Windows :

```powershell
Copy-Item ocr/.env.example ocr/.env
Copy-Item ocr/targets.example.json ocr/targets.json
```

La cible `Local test (offline)` fonctionne immédiatement sans réseau : elle
extrait les captures, écrit le JSON dans `data/outbox` et permet sa revue, mais
son bouton Publish reste désactivé.

Dans l'étape `Destination` de l'interface, utiliser `Add destination` pour
enregistrer un nom, l'URL de l'application et sa clé d'ingestion. L'identifiant
interne est généré depuis le nom. Les champs Cloudflare Access restent dans les
options avancées et ne sont nécessaires que si une politique Service Auth
protège les routes d'ingestion.

Utiliser ensuite `Synchronize IDs` pour récupérer explicitement le roster via
`GET /api/v1/imports/roster`. Les IDs sont mis en cache sur le PC et peuvent
être réutilisés hors ligne. Une extraction locale ne déclenche jamais cet appel
à distance implicitement.

Les destinations, leurs secrets et le cache du roster restent locaux et sont
ignorés par Git.

## 3. Démarrer et arrêter

Depuis PowerShell :

```powershell
.\ocr\control.ps1 start
.\ocr\control.ps1 status
.\ocr\control.ps1 logs
.\ocr\control.ps1 stop
```

Ou directement depuis WSL :

```bash
docker compose --env-file ocr/.env -f ocr/compose.yml up -d --build --wait ui
docker compose --env-file ocr/.env -f ocr/compose.yml down
```

Ouvrir ensuite `http://127.0.0.1:5190`.

L’arrêt préserve :

- `screenshots/raw` ;
- `data/outbox` ;
- les images Docker.

Il libère les CPU, la RAM et les processus du conteneur OCR.

## 4. Traiter une journée

Dans l’interface :

1. choisir la date de capture ;
2. choisir `Guild members` ou `Guild boss` ;
3. uploader les PNG exportés depuis BlueStacks ;
4. sélectionner la préproduction ;
5. lancer `Run OCR and validate` ;
6. vérifier les noms détectés et reliés, rôles, puissances, donations, activités,
   tentatives de boss, rangs et dégâts ;
7. vérifier une couverture et une complétude à 100 % ;
8. saisir la confirmation affichée ;
9. publier.

Le scan écrit `data/outbox/YYYY-MM-DD.json`. La publication réutilise exactement
ce fichier et ne relance jamais Tesseract.

## 5. Promotion préproduction vers production

Pour chaque date, de la plus ancienne à la plus récente :

1. publier en préproduction ;
2. contrôler Members, Boss, Activity, Admin et l’API ;
3. sauvegarder PostgreSQL en production ;
4. sélectionner `Production` dans l’interface OCR ;
5. publier le même outbox ;
6. vérifier les mêmes écrans en production.

La clé d’idempotence empêche une répétition identique d’ajouter des doublons.
L’import serveur est transactionnel : un lot refusé ne remplace pas la journée
déjà présente.

## Sécurité

- l’interface locale écoute uniquement sur `127.0.0.1` ;
- les requêtes cross-origin du navigateur sont refusées ;
- seuls les PNG décodables de moins de 15 MB et 12 mégapixels sont acceptés ;
- PostgreSQL ne doit jamais être exposé à Internet ;
- les clés préprod et prod doivent être différentes ;
- les captures et l’outbox doivent être sauvegardés avec la base de production.
