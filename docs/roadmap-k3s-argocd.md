# Proxmox, K3s, and Argo CD deployment roadmap

Status: **deferred**

This document records the longer-term target architecture. The currently
supported deployment remains Docker Compose behind Cloudflare Tunnel, as
documented in [`production-homelab.md`](production-homelab.md).

## Target architecture

```text
Proxmox
└── Linux VM
    └── Single-node K3s
        ├── Argo CD
        ├── Archero application and API
        ├── PostgreSQL
        ├── cloudflared
        └── persistent volumes
```

## Phase 1: infrastructure

- Create a Debian or Ubuntu Server VM in Proxmox.
- Assign a fixed local IP address.
- Install and harden SSH.
- Install single-node K3s.
- Create the `argocd` and `archero` namespaces.
- Install Argo CD.
- Configure Proxmox backups.
- Select persistent storage: `local-path`, NFS, or Longhorn.

## Phase 2: GitOps

- Publish images to GHCR with immutable Git SHA tags.
- Create Kubernetes manifests with Kustomize or Helm.
- Define Deployments, Services, ConfigMaps, Secrets, and PVCs.
- Run PostgreSQL as a StatefulSet or on a separate VM.
- Add startup, readiness, and liveness probes.
- Create the Argo CD Application.
- Enable automated synchronization, `selfHeal`, and `prune`.
- Document rollback for both application and schema changes.

## Phase 3: Cloudflare

- Deploy `cloudflared` inside K3s.
- Store the tunnel token in an encrypted Secret.
- Publish only the internal application Service.
- Do not expose a public `NodePort` or router port forwarding.
- Protect the application with Cloudflare Access and MFA.
- Keep application-level authentication for administrative functions.

## Phase 4: secrets and backups

- Encrypt GitOps secrets with SOPS and Age.
- Store the Age private key outside the cluster.
- Automate PostgreSQL backups.
- Back up `data` and `screenshots`.
- Copy backups outside the VM.
- Test complete restoration regularly.

## Entry criteria

Before implementing this architecture:

1. Validate the current Docker deployment in staging.
2. Finalize human review of imported data.
3. Complete account, role, and permission decisions.
4. Document database migration and rollback procedures.
5. Select and test persistent storage.
6. Select an off-VM backup destination.
7. Define monitoring and alert ownership.
8. Complete a final security review.

Once these conditions are met, use this roadmap to build the K3s and Argo CD
layer without changing the public API contract.
