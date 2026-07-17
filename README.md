# Archero Observer

Petit pipeline d'observation visuelle pour collecter des captures, extraire des classements par OCR, normaliser les donnees et les preparer pour PostgreSQL.

Le projet reste volontairement sur de l'automatisation visuelle classique via ADB/Appium et OCR. Il ne contient pas d'interception reseau, de modification du jeu ou de contournement de detection.

## Structure

```text
observer/
  automation/      Worker, ADB et machine a etats
  ocr/             Pretraitement OCR et validation
  pipeline/        Deduplication et normalisation
  storage/         Schema SQL
web/               Interface dashboard Next.js
config/            Configuration d'exemple
systemd/           Unit et timer
tests/             Tests unitaires
```

## Demarrage local

Les tests du coeur ne demandent aucune dependance externe:

```bash
python3 -m unittest discover -s tests
```

## Environnement Nix

Le projet fournit une `flake.nix` pour isoler les dependances de developpement et d'execution:

```bash
nix develop
```

Si le dossier n'est pas un depot Git initialise, utiliser temporairement:

```bash
nix develop path:.
```

Sinon, initialiser le depot et ajouter les fichiers visibles par Nix:

```bash
git init
git add .
```

Le shell contient:

```text
Python 3.12
pytesseract + Pillow
Tesseract OCR
ADB / android-tools
PostgreSQL client
Node.js 22
```

Commandes utiles:

```bash
nix flake check
nix build
nix run . -- --config config/observer.example.json
nix run .#dashboard
npm --prefix web run dev
```

Dans le shell:

```bash
python -B -m unittest discover -s tests
python -B -m observer.run --config config/observer.example.json
archero-capture guild-members
archero-capture guild-boss
archero-day 2026-07-16
archero-import 2026-07-16
node --test web/tests/*.test.mjs
npm --prefix web test
archero-dashboard
```

Le dashboard local est ensuite disponible sur:

```text
http://127.0.0.1:5181
```

Le port peut etre change avec:

```bash
ARCHERO_DASHBOARD_PORT=5190 archero-dashboard
```

Appium n'est pas inclus comme paquet direct car l'attribut n'est pas disponible dans le `nixpkgs` local teste. FastAPI/Uvicorn ne sont pas inclus dans le shell par defaut tant que l'API n'est pas implementee, afin d'eviter une dependance transitive actuellement instable dans ce `nixpkgs`.

OpenCV n'est pas inclus dans le shell par defaut: les attributs Python visibles dans ce canal ne fournissent pas un module `cv2` importable dans l'environnement realise. L'adaptateur OCR utilise donc Pillow + pytesseract pour le pretraitement numerique de base. Si OpenCV devient requis pour des traitements plus avances, il faudra ajouter une derivation OpenCV Python verrouillee et validee plutot qu'une installation globale.

Pour un environnement non Nix complet, installer les outils systeme et bibliotheques Python adaptees a la machine cible:

```text
Android Emulator + adb
Appium + UiAutomator2 si utilise
Tesseract OCR
Pillow + pytesseract
PostgreSQL
```

Les dependances Python de production ne sont pas declarees automatiquement ici afin de garder la decision explicite.

## Configuration

Copier `config/observer.example.json` vers un fichier prive, par exemple:

```text
/etc/archero-observer/config.json
```

Les secrets restent hors depot, par exemple:

```text
/etc/archero-observer/secrets.env
```

avec des droits restrictifs:

```bash
chmod 600 /etc/archero-observer/secrets.env
```

## Execution

Exemple avec une configuration locale:

```bash
python3 -m observer.run --config config/observer.example.json
```

Par defaut, la commande fonctionne en mode `dry_run`. Elle valide la configuration et simule les transitions sans piloter d'emulateur.

## Capture manuelle par date

Quand le telephone est deja ouvert sur le bon ecran, la capture brute peut etre prise sans navigation automatique:

```bash
archero-capture guild-members
archero-capture guild-boss
```

Quand les screenshots sont deja ranges dans le dossier du jour, lancer l'import du jour:

```bash
archero-day 2026-07-17
```

Sans date, `archero-day` utilise automatiquement la date du jour en Europe/Paris. La commande ne prend aucun screenshot: elle lit les fichiers existants, lance l'OCR/import, puis met a jour `web/sample-data.js`.

```text
lecture screenshots/raw/YYYY-MM-DD -> OCR/import du jour -> mise a jour web/sample-data.js
```

Les commandes `archero-capture ...` appellent uniquement:

```text
adb exec-out screencap -p
```

Les fichiers sont ranges automatiquement par date Europe/Paris:

```text
screenshots/raw/YYYY-MM-DD/guild/members-001.png
screenshots/raw/YYYY-MM-DD/guild/members-002.png
screenshots/raw/YYYY-MM-DD/boss/boss-001.png
```

Pour verifier le prochain nom sans appeler ADB:

```bash
archero-capture guild-members --dry-run
```

Si plusieurs appareils ADB sont connectes:

```bash
archero-capture guild-members --serial DEVICE_SERIAL
```

Pour importer une journee capturee et rafraichir les metadonnees du dashboard:

```bash
archero-import 2026-07-16
```

Cette premiere version cree un rapport dans `data/imports/YYYY-MM-DD.json`, detecte les lignes visibles des screenshots de guilde, inventorie les captures boss, et met a jour la date/source de capture dans `web/sample-data.js`. Elle ne remplace pas encore les valeurs OCR des membres tant que l'OCR complet n'est pas branche.

## Normalisation des screenshots

Les captures brutes doivent rester separees des images pretraitees:

```text
screenshots/raw/          sortie ADB originale
screenshots/normalized/   PNG normalises avant OCR
screenshots/failed/       captures ou crops a revoir
```

La normalisation produit des PNG deterministes:

- taille cible fixe;
- crop optionnel par region;
- conversion RGB ou niveaux de gris;
- autocontraste optionnel;
- seuillage optionnel pour les champs OCR numeriques;
- hash SHA-256 de l'artefact genere.

L'objectif est qu'une meme capture, traitee avec le meme profil, donne toujours le meme fichier et le meme hash. Les alertes OCR et les imports doivent donc s'appuyer sur les images normalisees, pas directement sur les screenshots bruts.

## Base de donnees

Le schema initial est dans `observer/storage/schema.sql`. `docker-compose.yml` fournit uniquement PostgreSQL pour le developpement local. Le mot de passe inclus est un exemple de developpement et ne doit pas etre reutilise en production.
