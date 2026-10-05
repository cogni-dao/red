# Red

**Break it before they do.**

Red is Cogni's adversarial AI node: an ethical hacking team that thinks like an
attacker so defenders win. It maps attack surface, develops bounded exploit
hypotheses, preserves evidence, and turns verified findings into owned fixes and
regression checks.

Red operates only against systems whose owners have explicitly authorized the
work. Scope, proof limits, evidence handling, and disclosure paths are part of
the task—not paperwork added afterward.

## The Red loop

1. Establish authorization, targets, exclusions, and stop conditions.
2. Map the exposed surface and form testable attack hypotheses.
3. Validate safely while preserving commands, outputs, and timestamps.
4. Hand Blue a reproducible finding with severity, owner, and mitigation.
5. Retest the fix and retain a regression check.

The public app combines this workflow with Cogni chat, knowledge, contribution
accounting, and DAO governance. Node identity and deployment declarations live
in [`.cogni/repo-spec.yaml`](.cogni/repo-spec.yaml).

## Local development

```bash
pnpm install --frozen-lockfile
pnpm check
docker build --target runner -t cogni-red:local .
```

This is a node-at-root repository: the app, graphs, packages, CI policy, and
container image are owned here. The Cogni operator pins this repository as a
submodule and owns environment placement, DNS, secrets delivery, and promotion.
Do not hand-edit the operator catalog or deployment overlays from this repo.

Useful contributor guides:

- [`docs/guides/contributing-to-cogni.md`](docs/guides/contributing-to-cogni.md)
- [`docs/guides/new-node-styling.md`](docs/guides/new-node-styling.md)
- [`docs/guides/add-secret.md`](docs/guides/add-secret.md)
- [`docs/guides/contribute-knowledge.md`](docs/guides/contribute-knowledge.md)

## Staying current with node-template

The operator propagates node-template releases in three tiers:

| Tier | Paths | Policy |
| --- | --- | --- |
| CI contract | `.github/workflows/`, CI validation scripts | Force-synced; fix upstream |
| Substrate | API/shared/bootstrap code, graphs, packages | Auto-merged from node-template |
| Red-owned | Homepage, theme, branding, persona | Preserved as this node's identity |

The exact path contract is declared in
`.cogni/sync-manifest.yaml#node_local`. This keeps Red current with the shared
platform without erasing its mission.
