# Review stabilite applicative avant deploiement

Date de review: 2026-07-20

## Objectif

Stabiliser l'application avant le deploiement: verifier le front, le back, la securite des flux de donnees, les risques de doublons, les erreurs d'import, et le suivi d'une synchronisation lancee depuis le front mais executee cote backend.

## Notes

| Surface | Avant | Apres | Commentaire |
| --- | ---: | ---: | --- |
| Front data/update | 6/10 | 8/10 | Le front retrouve maintenant le job serveur apres reload, poll toutes les 5s pendant une synchro, et affiche les doublons upload clairement. |
| Backend import job | 6/10 | 8/10 | Un seul job actif, etat public nettoye, historique borne, snapshot persiste dans `data/import-jobs/state.json`. |
| Integrite data locale | 6/10 | 8/10 | Tests anti-doublons roster, coherence latest snapshots/raw rows, ranks boss uniques. |
| Securite API data | 5/10 | 7.5/10 | Headers d'action verifies, dates validees, logs/tracebacks retires des reponses publiques, upload PNG borne en taille. |
| Visuel admin data | 6/10 | 7/10 | Le bloc synchro est plus clair, avec etats visuels `queued/running/succeeded/failed`; pas de refonte globale faite. |
| Pret pour deploiement | 5/10 | 7.5/10 | Base plus stable, runtime Nix avec `psycopg`, mais il reste a valider contre une vraie DB disponible et a decider si une vraie queue persistante est necessaire. |

## Changements effectues

- Jobs d'import:
  - status serveur consultable via `/api/data/import/status`;
  - progression publique sans `stdout`, `stderr`, `stderrTail` ni stack trace;
  - snapshot persiste best-effort dans `data/import-jobs/state.json`;
  - jobs actifs restaures apres redemarrage marques comme interrompus, pour eviter de mentir au front.

- Upload screenshots:
  - validation signature PNG;
  - limite de taille `15 MiB`;
  - hash SHA-256;
  - detection d'un doublon exact pour le meme type/date avant creation d'un nouveau fichier.

- Import data:
  - ecriture atomique des rapports JSON et de `web/sample-data.js`;
  - correction d'une incoherence locale sur `119960803`;
  - tests d'integrite sur les donnees sample.

- Front admin data:
  - libelle `Synchronize data`;
  - bouton `Refresh status`;
  - polling toutes les 5s pendant un job actif;
  - message explicite quand aucun job serveur n'est connu;
  - upload doublon affiche comme warning.

## Points securite verifies

- Les routes d'action refusent une requete sans `x-archero-dashboard-action: 1`.
- Les dates d'import sont limitees au format `YYYY-MM-DD`.
- Les screenshots servis restent sous `screenshots/raw`.
- Les erreurs internes de l'export DB ne sont plus renvoyees au client.
- Les logs process d'import ne sont pas exposes dans l'objet job public.
- Les uploads non PNG ou trop gros sont rejetes avant ecriture.
- Le runtime Nix de production inclut `psycopg` pour le mode PostgreSQL.

## Limites restantes

- Le job continue si le navigateur reload ou quitte la page, tant que le serveur Next reste vivant.
- Si le serveur Next redemarre pendant un import, le process enfant est considere perdu et le job restaure est marque `failed/interrupted`; une vraie queue worker serait necessaire pour reprendre automatiquement.
- Le mode PostgreSQL complet doit encore etre valide contre une DB disponible avec donnees reelles ou staging.
- Pas de capture visuelle automatisee produite dans cet environnement faute de navigateur headless disponible.

## Commandes de verification

```bash
python3 -B -m unittest discover -s tests
npm --prefix web test
npm --prefix web run build
nix flake check
```
