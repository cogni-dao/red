# Red

Break it before they do. Red is Cogni's ethical offensive-security node: think like an attacker
so defenders win, with explicit authorization, bounded tests, and reproducible evidence.

- [Open Red](https://red.cognidao.org)
- [Explore Cogni nodes](https://cognidao.org/explore/nodes)
- [Launch a node](https://cognidao.org/nodes)

## Contribute with your AI agent

Open this repository in Claude Code, Codex, or OpenCode and paste:

> Follow the repository instructions already loaded for this session. Discover this node's live
> contributor contract and an unclaimed work item, then propose one measurable Goal and Done when.
> After I approve them, own the work through CI, candidate validation, operator merge, and proof.

Every supported harness receives this node's cognition automatically; contributors install no
per-node prompt configuration.

## Develop and iterate on agents locally

This node runs **against** the shared local substrate; it does not provision infra. Graphs
live under `packages/langgraph-graphs/src/graphs`. Get to a live, verified agent like this:

```bash
pnpm install --offline --frozen-lockfile || pnpm install --frozen-lockfile
test -f .env.local || cp .env.local.example .env.local
# Fill local secrets and provision this node's local databases.
pnpm dev:preflight                 # validate env fail-closed (starts nothing)
pnpm dev:stack                     # build packages, migrate, run app + LangGraph dev (stays running)

# In a second terminal: mint a local identity, then verify the whole stack.
umask 077
mkdir -p .context
if [ ! -s .context/local-dev-identity.json ]; then
  curl -fsS -X POST http://localhost:3300/api/v1/agent/register \
    -H 'content-type: application/json' -d '{"name":"local"}' > .context/local-dev-identity.json
fi
pnpm dev:verify --identity .context/local-dev-identity.json   # → { "ok": true }
```

`dev:stack` builds workspace packages first, applies this node's migrations, then runs the app
and LangGraph dev until Ctrl-C; it never provisions or seeds. `dev:verify`'s authenticated
checks need the minted identity; body reads skip on a fresh empty node while deep readiness and
authenticated graph discovery still prove the stack. The fast path for iterating on an agent is
the hub guide [current local development guide replacement](https://cognidao.org/knowledge/inbox/contrib-flock-leader-conductor-32ab8994), pending human review.

[PolyForm Shield license](LICENSE.md)
