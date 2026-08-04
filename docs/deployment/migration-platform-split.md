# Migration du serveur vers la plateforme seule

Cette procédure remplace l'ancien déploiement par le produit `platform/`
uniquement. Le serveur conserve trois conteneurs :

- `app` : front Next.js et API ;
- `postgres` : base de données ;
- `cloudflared` : tunnel public.

Tesseract, ADB, l'interface OCR et les captures brutes restent sur le poste OCR.

## Garanties sur les données

L'ancien et le nouveau fichier Compose déclarent tous les deux :

```yaml
name: archero-observer
volumes:
  postgres-data:
```

Sur le même hôte Docker, ils utilisent donc le même volume physique
`archero-observer_postgres-data`. Une reconstruction de `app` ne remplace ni
ce volume ni le dossier `data/`.

Ne jamais exécuter `docker compose down -v`, `docker volume rm` ou
`docker system prune --volumes` pendant cette migration.

## 1. Sauvegarder l'ancien serveur

Depuis l'ancienne copie du dépôt, avant le `git pull` :

```bash
cd /chemin/vers/archero-observer
old_commit="$(git rev-parse HEAD)"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="$PWD/backups/before-platform-split/$timestamp"
mkdir -p "$backup_dir"

docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker volume inspect archero-observer_postgres-data \
  --format '{{.Name}} {{.Mountpoint}}' | tee "$backup_dir/postgres-volume.txt"

docker compose --env-file .env.production -f docker-compose.prod.yml \
  exec -T postgres sh -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > "$backup_dir/postgres.dump"

docker compose --env-file .env.production -f docker-compose.prod.yml \
  exec -T postgres pg_restore --list \
  < "$backup_dir/postgres.dump" \
  > "$backup_dir/postgres.contents"

tar -czf "$backup_dir/data.tar.gz" data
tar -tzf "$backup_dir/data.tar.gz" >/dev/null
printf '%s\n' "$old_commit" > "$backup_dir/git-commit.txt"
(
  cd "$backup_dir"
  sha256sum postgres.dump postgres.contents data.tar.gz git-commit.txt \
    > SHA256SUMS
  sha256sum -c SHA256SUMS
)
```

Copier ensuite ce dossier vers un autre stockage avant de continuer. Le dump
et sa copie hors serveur sont le filet de sécurité ; le volume Docker seul
n'est pas un backup.

## 2. Arrêter l'ancien OCR du serveur

Si l'ancien agent OCR Docker existe encore, l'arrêter avant de mettre le dépôt
à jour :

```bash
if [ -f compose.ocr.yml ] && [ -f .env.ocr ]; then
  docker compose --env-file .env.ocr -f compose.ocr.yml down
fi
```

S'il existait un ancien timer de capture, le désactiver également :

```bash
sudo systemctl disable --now archero-observer.timer 2>/dev/null || true
sudo systemctl stop archero-observer.service 2>/dev/null || true
```

Ces commandes n'effacent ni captures ni outbox. Après validation de la
plateforme, les anciens fichiers OCR peuvent être archivés hors du serveur.

## 3. Installer la nouvelle version au même endroit

Conserver l'environnement de production, récupérer le code, puis le copier au
nouvel emplacement. Le fichier réel `.env.production`, ignoré par Git, reste
présent pendant le `pull` :

```bash
git pull --ff-only
install -m 600 .env.production platform/.env.production
```

Vérifier la configuration et la liste exacte des services :

```bash
docker compose --env-file platform/.env.production \
  -f platform/compose.yml config --services
```

La sortie attendue est :

```text
postgres
app
cloudflared
```

Déployer ensuite :

```bash
docker compose --env-file platform/.env.production \
  -f platform/compose.yml up -d --build --remove-orphans
docker compose --env-file platform/.env.production \
  -f platform/compose.yml ps
docker volume inspect archero-observer_postgres-data \
  --format '{{.Name}} {{.Mountpoint}}'
curl --fail http://127.0.0.1:5181/api/health
```

Le nom et le point de montage du volume doivent être identiques à ceux
enregistrés dans `postgres-volume.txt`. Vérifier ensuite visuellement les pages
Dashboard, Members, Activity et Admin, ainsi qu'un compte lecteur et un compte
administrateur.

## 4. Restaurer seulement sur une nouvelle VM ou un volume vide

Une migration en place ne nécessite pas de restauration : elle réutilise la
base. Pour une nouvelle VM, démarrer PostgreSQL seul puis restaurer le dump
avant l'application :

```bash
docker compose --env-file platform/.env.production \
  -f platform/compose.yml up -d postgres

docker compose --env-file platform/.env.production \
  -f platform/compose.yml exec -T postgres \
  sh -c 'pg_restore --clean --if-exists --no-owner --no-privileges \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < backups/before-platform-split/<timestamp>/postgres.dump

tar -xzf backups/before-platform-split/<timestamp>/data.tar.gz

docker compose --env-file platform/.env.production \
  -f platform/compose.yml up -d --build app cloudflared
```

`pg_restore --clean` est destructif : l'utiliser uniquement sur la nouvelle
base cible, jamais pour une mise à jour normale.

## Versions suivantes

Après cette migration, une livraison applicative se fait avec :

```bash
git pull --ff-only
make release
```

`make release` crée et vérifie d'abord un dump PostgreSQL et une archive de
`data/`, puis remplace uniquement le conteneur `app`. Il ne publie aucune
nouvelle donnée de guilde. Les nouvelles captures doivent venir du poste OCR
par l'API d'ingestion.

Pour revenir au code précédent, utiliser le commit enregistré dans
`git-commit.txt`, reconstruire `app`, et conserver le volume PostgreSQL. Une
restauration de dump n'est nécessaire que si une migration de schéma
irréversible a été exécutée.
