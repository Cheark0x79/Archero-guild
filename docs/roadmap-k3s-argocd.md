# Roadmap de déploiement Proxmox, K3s et Argo CD

Statut : **différé**.

Ce document conserve le plan de déploiement cible. Il ne constitue pas la
priorité actuelle : nous devons d'abord mettre à jour, fiabiliser et préparer
l'application et son API.

## Architecture cible

```text
Proxmox
└── VM Linux
    └── K3s mono-nœud
        ├── Argo CD
        ├── application Archero et API
        ├── PostgreSQL
        ├── cloudflared
        └── volumes persistants
```

## Phase différée : infrastructure

- Créer une VM Debian ou Ubuntu Server dans Proxmox.
- Attribuer une IP locale fixe.
- Installer et sécuriser SSH.
- Installer K3s en mono-nœud.
- Configurer les namespaces `argocd` et `archero`.
- Installer Argo CD.
- Configurer les sauvegardes Proxmox.
- Choisir le stockage persistant : `local-path`, NFS ou Longhorn.

## Phase différée : GitOps

- Publier les images dans GHCR avec un tag correspondant au SHA Git.
- Créer les manifests Kubernetes avec Kustomize ou Helm.
- Créer les Deployments, Services, ConfigMaps, Secrets et PVC.
- Déployer PostgreSQL avec un StatefulSet ou sur une VM séparée.
- Ajouter les probes de démarrage, disponibilité et fonctionnement.
- Créer l'Application Argo CD.
- Activer la synchronisation automatique, `selfHeal` et `prune`.
- Prévoir une stratégie de rollback.

## Phase différée : Cloudflare

- Déployer `cloudflared` dans K3s.
- Stocker le token du tunnel dans un Secret chiffré.
- Publier uniquement le Service interne de l'application.
- N'utiliser ni `NodePort` public ni redirection de ports sur la box.
- Protéger l'application avec Cloudflare Access et MFA.
- Maintenir la seconde authentification interne pour les fonctions admin.

## Phase différée : secrets et sauvegardes

- Chiffrer les secrets GitOps avec SOPS et Age.
- Sauvegarder la clé Age hors du cluster.
- Automatiser les sauvegardes PostgreSQL.
- Sauvegarder également `data` et `screenshots`.
- Copier les sauvegardes hors de la VM.
- Tester régulièrement une restauration complète.

## Priorité actuelle

Avant de commencer cette infrastructure :

1. Stabiliser les données et l'import.
2. Finaliser la validation humaine des données.
3. Versionner et sécuriser l'API.
4. Terminer les comptes, rôles et permissions.
5. Réduire la dette technique du front.
6. Compléter les tests automatiques.
7. Vérifier le fonctionnement dans l'image Docker.
8. Documenter les migrations et les procédures de restauration.
9. Préparer la publication automatique de l'image.
10. Faire une dernière revue de sécurité avant le déploiement.

Une fois ces points suffisamment avancés, reprendre ce document pour construire
la couche K3s/Argo CD.
