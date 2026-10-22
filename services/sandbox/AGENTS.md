# sandbox · AGENTS.md

## Metadata

- **Owners:** @Cogni-DAO
- **Status:** draft

## Purpose

Red-owned toolbox on a separate operator-managed sandbox workload. The workload
is not an app sidecar or a qualified multi-tenant runtime.

## Pointers

- [Runtime and validation](README.md)
- [Node contract](../../.cogni/repo-spec.yaml)

## Boundaries

Image, entrypoint and self-owned validation fixtures only. No infrastructure
provisioning, operator controller code, node-template deployment defaults, or
committed secret values.

## Public Surface

- `Dockerfile`, `entrypoint.sh`: execd PID 1, non-root, token required
- `validate.sh`, `validate-client.ts`: local transport checks through ToolRunner (not agent E2E proof)
- `Caddyfile`, `execd.toml`: exact-SHA front door and upstream hardening floor

## Responsibilities

Pin upstream execd by release digest. Keep app/substrate keys outside the lease.
Document workspace-directory and egress limitations accurately. Never retry an
ambiguous command. Do not equate a local fixture pass with candidate validation.
Shared identity/OpenFGA/ToolRunner adoption is approved in story.0002; Operator
extends its existing facade for execution. Never reopen that decision, copy its
private package, project raw OpenFGA authority, or enable a local caller allowlist.
