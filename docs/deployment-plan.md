# Plan de deploiement homelab

> **Document historique.** La cible monolithique décrite ci-dessous est
> remplacée par les deux produits autonomes `platform/` et `ocr/`. Pour le
> déploiement actuel, utiliser
> [`production-homelab.md`](production-homelab.md) et
> [`ocr-distant.md`](ocr-distant.md). Le serveur ne doit plus exécuter ADB,
> Tesseract, les captures ou le timer `systemd/archero-observer`.

Ce document decrit la cible de deploiement pour Archero Observer sur une VM dediee dans le homelab Proxmox, ainsi que le workflow d'exploitation: provisioning, configuration, publication via Cloudflare, backups, monitoring, securite et mises a jour.

## Objectifs

- Isoler l'application dans une VM dediee plutot que sur l'hote Proxmox.
- Rendre l'installation reproductible avec une couche IaC pour la VM et une couche de configuration serveur.
- Publier le dashboard de maniere controlee a des utilisateurs externes.
- Sauvegarder les donnees critiques: PostgreSQL, configuration, captures brutes, images normalisees et rapports d'import.
- Avoir un chemin clair pour deployer une nouvelle version et revenir en arriere.
- Garder les secrets hors Git.

## Architecture cible

```text
Internet
  |
  v
Cloudflare DNS / WAF / Access / Tunnel
  |
  v
cloudflared dans la VM
  |
  +--> 127.0.0.1:5181  dashboard Next.js
  +--> 127.0.0.1:8080  future API interne si ajoutee

Proxmox
  |
  v
VM archero-observer
  |
  +--> systemd timers/services
  |     +--> observer Python: ADB, capture, OCR, import
  |     +--> dashboard Next.js
  |
  +--> PostgreSQL local
  |
  +--> filesystem applicatif
        +--> /var/lib/archero-observer/screenshots/raw
        +--> /var/lib/archero-observer/screenshots/normalized
        +--> /var/lib/archero-observer/data/imports
        +--> /etc/archero-observer/config.json
        +--> /etc/archero-observer/secrets.env
```

La premiere cible recommandee est une seule VM avec PostgreSQL local. C'est plus simple a sauvegarder, auditer et restaurer. Si l'usage grossit, PostgreSQL et le stockage images pourront etre externalises.

## Decisions initiales

| Sujet | Decision proposee | Raison |
| --- | --- | --- |
| Virtualisation | VM Proxmox dediee `archero-observer` | Isolation, snapshots, ressources controlees |
| OS | Debian stable ou NixOS | Debian si l'on veut rester classique; NixOS si l'on veut tout declarer |
| Base de donnees | PostgreSQL 16 local dans la VM | Deja present en dev, robuste, backup simple |
| Images/captures | Fichiers locaux sous `/var/lib/archero-observer` | Le projet manipule deja des chemins de screenshots |
| Exposition publique | Cloudflare Tunnel + Cloudflare Access | Pas d'ouverture directe de port entrant |
| Auth externe | Cloudflare Access devant le dashboard | Evite de coder un login applicatif tant que le besoin est simple |
| Services | systemd | Deja amorce dans `systemd/` |
| Build | Nix pour le worker Python; build Next.js pour le dashboard | Aligne avec `flake.nix` et `web/package.json` |

Points a valider avant implementation: OS final, nom de domaine, methode de stockage long terme, outil de configuration exact si "Montcible" designe Ansible ou un autre orchestrateur.

## Couches d'automatisation

### 1. Terraform pour Proxmox

Terraform doit provisionner uniquement l'infrastructure:

- VM `archero-observer`;
- CPU, RAM, disque systeme et eventuel disque data;
- reseau, VLAN, IP statique ou reservation DHCP;
- cloud-init;
- utilisateur admin SSH;
- tags Proxmox et description;
- eventuellement stockage dedie pour `/var/lib/archero-observer`.

Arborescence proposee:

```text
infra/
  terraform/
    proxmox/
      main.tf
      variables.tf
      outputs.tf
      versions.tf
      terraform.tfvars.example
  config/
    ansible/
      inventory.example.yml
      playbook.yml
      roles/
        archero_observer/
        postgresql/
        cloudflared/
        backups/
        monitoring/
```

Le state Terraform ne doit pas etre stocke en clair dans le depot. Pour un homelab, options acceptables:

- backend local chiffre et sauvegarde;
- backend S3 compatible MinIO avec versioning;
- Terraform Cloud si l'on accepte le SaaS.

### 2. Configuration serveur

La configuration serveur doit installer et maintenir:

- paquets systeme: `postgresql`, `nodejs` ou runtime Nix, `tesseract`, `android-tools`, `cloudflared`, outils de backup;
- utilisateur systeme `archero-bot`;
- dossiers avec permissions:
  - `/opt/archero-observer` pour le code courant;
  - `/var/lib/archero-observer` pour les donnees;
  - `/etc/archero-observer` pour config et secrets;
- services systemd:
  - `archero-observer.service` pour la capture/import planifiee;
  - `archero-observer.timer` pour l'execution quotidienne;
  - `archero-dashboard.service` pour le dashboard;
  - `cloudflared.service` pour l'exposition Cloudflare;
  - timers de backup.

Les secrets seront fournis hors Git via fichier protege, age/sops, Vaultwarden, 1Password CLI ou secret manager equivalent.

## Runtime applicatif

### Worker d'observation

Le worker Python est lance par systemd. La commande actuelle vise:

```text
python -m observer.run --config /etc/archero-observer/config.json
```

Le service doit tourner avec un utilisateur non-root, sans shell interactif, avec acces limite aux dossiers de donnees et a ADB si necessaire.

### Dashboard

Le dashboard Next.js doit ecouter uniquement en local:

```text
127.0.0.1:5181
```

L'acces externe passe par Cloudflare Tunnel. Le dashboard ne doit pas etre expose directement sur le LAN sauf besoin explicite.

### Base de donnees

PostgreSQL tourne localement et n'ecoute que:

```text
127.0.0.1:5432
```

Le compte applicatif doit avoir des droits limites a la base `archero_observer`. Le mot de passe de dev dans `docker-compose.yml` ne doit jamais etre reutilise en production.

## Stockage des images et donnees

Structure cible:

```text
/var/lib/archero-observer/
  screenshots/
    raw/YYYY-MM-DD/...
    normalized/YYYY-MM-DD/...
    failed/YYYY-MM-DD/...
  data/
    imports/YYYY-MM-DD.json
  backups/
    staging/
```

Regles:

- les captures brutes sont immuables apres creation;
- les images normalisees sont regenerables, mais utiles pour audit OCR;
- les imports JSON sont conserves comme artefacts d'audit;
- la base contient les donnees structurees;
- les chemins stockes en base doivent rester relatifs a `/var/lib/archero-observer` si possible pour faciliter une restauration sur une nouvelle VM.

Evolution possible: pousser `screenshots/` et `data/imports/` vers un stockage objet S3 compatible, par exemple MinIO homelab, Backblaze B2, Cloudflare R2 ou Hetzner Object Storage. Dans ce cas, la VM garde un cache local recent et les sauvegardes longues vivent dans l'objet storage.

## Backups et restauration

### Donnees a sauvegarder

- dump PostgreSQL logique quotidien;
- base PostgreSQL via backup physique si le volume grossit;
- `/etc/archero-observer/config.json`;
- secrets via coffre separe, pas dans l'archive applicative;
- `/var/lib/archero-observer/screenshots/raw`;
- `/var/lib/archero-observer/screenshots/normalized`;
- `/var/lib/archero-observer/data/imports`;
- version de l'application deployee.

### Politique proposee

```text
Toutes les nuits:
  pg_dump custom format
  archive des fichiers applicatifs critiques
  upload vers stockage backup
  verification de presence et taille

Retention:
  7 sauvegardes quotidiennes
  4 sauvegardes hebdomadaires
  12 sauvegardes mensuelles
```

Outils possibles:

- `restic` vers S3/B2/R2/MinIO;
- `borgbackup` vers un NAS ou serveur SSH;
- Proxmox Backup Server pour snapshot VM, en complement, pas comme seul backup applicatif.

La restauration doit etre testee regulierement sur une VM temporaire. Un backup non teste doit etre considere comme non prouve.

## Securite et acces

### Acces public

Flux recommande:

```text
Utilisateur -> Cloudflare Access -> Cloudflare Tunnel -> dashboard local
```

Cloudflare Access gere:

- login par email, Google, GitHub ou autre IdP;
- allowlist d'utilisateurs ou groupes;
- MFA cote fournisseur d'identite;
- logs d'acces;
- politique differente pour admin et lecture seule si necessaire.

Tant que le dashboard ne gere pas de permissions fines, Cloudflare Access suffit comme premiere barriere. Si l'application gagne des actions sensibles, ajouter ensuite un login applicatif et des roles internes.

### Durcissement VM

- SSH par cle uniquement;
- desactiver login root SSH;
- firewall local: autoriser SSH depuis le LAN/admin, refuser le reste, pas de port HTTP entrant public;
- services bindes sur `127.0.0.1`;
- mises a jour securite OS automatisees ou cadence mensuelle explicite;
- secrets en `0600`, proprietaire root ou utilisateur de service selon besoin;
- utilisateur `archero-bot` sans privileges sudo;
- logs systemd persistants avec retention bornee.

### Secrets

Secrets probables:

- mot de passe PostgreSQL applicatif;
- token Cloudflare Tunnel;
- credentials backup;
- eventuels tokens de notification monitoring.

Ils doivent etre exclus du depot et injectes via `/etc/archero-observer/secrets.env` ou via un mecanisme chiffre type `sops`.

## Monitoring et alerting

Surveillance minimale:

- etat des services systemd;
- succes/echec du timer `archero-observer.timer`;
- age de la derniere capture/import;
- nombre d'echecs OCR recents;
- espace disque sur `/var/lib/archero-observer`;
- taille et duree des backups;
- disponibilite HTTP du dashboard via tunnel;
- charge CPU/RAM de la VM;
- statut PostgreSQL.

Stack simple:

- Prometheus node exporter + Grafana si deja present dans le homelab;
- Uptime Kuma pour verifier le dashboard et le tunnel;
- journald pour logs locaux;
- alertes Discord, email ou ntfy.

Un endpoint de health applicatif sera utile quand une API existe. En attendant, le monitoring peut verifier la page Next.js et les timers systemd.

## Workflow de deploiement

### Premiere installation

1. Creer la VM avec Terraform.
2. Appliquer la configuration serveur.
3. Creer les dossiers et secrets.
4. Installer PostgreSQL et appliquer `observer/storage/schema.sql`.
5. Deployer le code dans `/opt/archero-observer/releases/<version>`.
6. Construire le dashboard Next.js.
7. Activer les services systemd.
8. Configurer Cloudflare Tunnel et Access.
9. Lancer un dry-run puis une capture controlee.
10. Declencher un backup initial et tester une restauration minimale.

### Mise a jour applicative

Workflow recommande:

```text
local/CI:
  tests Python
  tests web
  build Nix
  build Next.js
  artefact versionne

serveur:
  upload nouvelle release
  installation dans /opt/archero-observer/releases/<version>
  migration DB si necessaire
  switch symlink /opt/archero-observer/current
  restart services
  health checks
```

Les releases doivent etre atomiques:

```text
/opt/archero-observer/
  current -> releases/2026-07-18T120000Z-gitsha
  releases/
    2026-07-18T120000Z-gitsha/
    previous-version/
```

Rollback:

1. arreter les services;
2. repointer `current` vers la release precedente;
3. restaurer la base seulement si une migration irreversible a ete appliquee;
4. redemarrer;
5. verifier dashboard, timer et logs.

Avant toute migration destructive, faire un dump PostgreSQL et noter explicitement la commande de rollback.

## Environnements

| Environnement | Role | Donnees |
| --- | --- | --- |
| Local dev | Developpement et tests | donnees exemples |
| Staging VM ou namespace | Test de deploy avant prod | dump anonymise ou petit jeu de donnees |
| Production VM | Service reel | donnees reelles |

Si une seule VM est disponible au debut, creer au minimum un mode staging logique avec ports, base et dossiers separes. Ne pas tester les migrations directement sur la base de production sans dump recent.

## Plan de mise en oeuvre

### Phase 1: cadrage

- Valider OS VM: Debian ou NixOS.
- Valider outil de configuration: Ansible, Montcible si outil specifique, ou module NixOS.
- Choisir domaine Cloudflare.
- Choisir cible de backup: NAS, PBS, S3 compatible ou combinaison.
- Definir taille initiale VM: par exemple 2 vCPU, 4 Go RAM, 40 Go systeme, disque data extensible.

### Phase 2: IaC et VM

- Ajouter `infra/terraform/proxmox`.
- Creer une VM reproductible via cloud-init.
- Sortir IP, hostname et informations utiles en outputs Terraform.
- Documenter la creation du token Proxmox sans le commiter.

### Phase 3: configuration serveur

- Ajouter roles de configuration.
- Installer PostgreSQL, tesseract, android-tools, runtime Node/Nix.
- Creer users, dossiers, permissions et services systemd.
- Ajouter service dashboard manquant.
- Configurer firewall local.

### Phase 4: donnees et backups

- Ecrire scripts `backup` et `restore-check`.
- Automatiser `pg_dump`.
- Sauvegarder fichiers applicatifs.
- Ajouter monitoring du dernier backup reussi.
- Tester une restauration sur VM temporaire ou dossier temporaire.

### Phase 5: exposition securisee

- Configurer Cloudflare Tunnel.
- Mettre Cloudflare Access devant le dashboard.
- Definir allowlist utilisateurs.
- Verifier qu'aucun port web public n'est ouvert sur la VM.

### Phase 6: deploiement versionne

- Definir format des releases.
- Ajouter script de deploy.
- Ajouter check post-deploy.
- Ajouter procedure rollback.
- Brancher CI si besoin.

### Phase 7: monitoring

- Ajouter checks services systemd.
- Ajouter check age de derniere capture/import.
- Ajouter alertes disque et backups.
- Ajouter dashboard Grafana/Uptime Kuma selon la stack homelab existante.

## Questions ouvertes

- "Montcible" designe-t-il Ansible, un outil interne, ou un autre gestionnaire de configuration?
- Le serveur Proxmox dispose-t-il deja de Proxmox Backup Server ou d'un NAS?
- Les utilisateurs externes doivent-ils etre seulement lecteurs, ou pourront-ils declencher des actions?
- La capture ADB utilisera-t-elle un telephone physique branche a la VM, un emulateur, ou une autre machine de capture?
- Faut-il conserver toutes les captures indefiniment ou appliquer une retention sur les images brutes?
- Le homelab a-t-il deja Prometheus/Grafana/Uptime Kuma/ntfy?
