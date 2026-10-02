---
name: solve-ctf-challenges
description: Solve authorized capture-the-flag and sandbox security challenges with an evidence-led workflow that preserves artifacts, maps trust boundaries, controls experiments, builds the smallest viable exploit chain, and proves the real flag. Use for live CTF targets, challenge source archives, packet captures, opaque network services, web or agent-security puzzles, exploit-chain debugging, flag validation, and honest postmortems. Do not use for targets without explicit challenge authorization.
---

# Solve CTF Challenges

Treat a CTF as an evidence problem with a precise success predicate. Investigate only the
supplied challenge scope, maintain a live human-readable record, and do not call a primitive
or bundled test flag a win.

## Hard rules

1. Work only on the target, instance, artifacts, and accounts explicitly supplied for the
   challenge. Stop if authorization or target identity is genuinely ambiguous.
2. Never inspect unrelated browser history, personal accounts, credentials, or private host
   state to find a missing target. Ask for the target URL, spawn page, or artifact instead.
3. Prefer read-only discovery and the least-destructive exploit that proves the challenge.
   Do not delete, poison, reset, upload, or persist unless the path requires it and the effect
   stays inside the challenge instance.
4. Treat shared instances as shared mutable state. Establish one operator or isolated
   instances before making stateful changes.
5. Keep facts, inferences, hypotheses, and inconclusive results visibly distinct.
6. Continue until the defined success predicate is independently verified or a real external
   blocker is established. Activity alone is not progress.

## Start the evidence record first

Create `.context/<challenge>-progress.md` before substantive probing. Use
[references/progress-template.md](references/progress-template.md). The top of the file must
always contain, in this order:

1. a deliberately simple diagram of the challenge;
2. the exact win condition and current win status;
3. the top findings;
4. attempts and what each established;
5. prioritized TODOs.

Update those top sections whenever the working theory changes. Put commands, response
excerpts, packet identifiers, hashes, timestamps, and longer analysis below them. Never make
the reader reconstruct current state from a chronological transcript.

## Run the workflow

### 1. Define scope and proof

Record the supplied target, artifact names, account context, and restrictions. Write the
victory condition as an observable predicate before testing. Examples include a live service
returning a flag, an authoritative state object containing the required receipt, or a recovered
file whose complete flag and hash are verified.

Separate these states:

- **primitive proven**: one vulnerability or capability works;
- **chain proven**: the primitive reaches the intended final system;
- **won**: the live, scoped challenge satisfies the victory predicate;
- **independently verified**: a second read or clean reproduction confirms the result.

### 2. Preserve inputs and identify the target

For archives and captures, record filename, exact size, file type, and SHA-256 before analysis.
List archive members before safe extraction and preserve the original. Analyze a working copy.

For a live service, preflight its identity before sending an exploit: check the expected page,
protocol, title, route, banner, or other challenge-specific marker. TCP acceptance does not
prove the advertised protocol, and application silence does not prove an outage.

### 3. Build an evidence model

Map the shortest plausible route from attacker-controlled input to the winning state:

```text
INPUT -> PARSER/AGENT -> TRUST BOUNDARY -> PRIVILEGED SINK -> WIN PROOF
```

Maintain two compact tables:

- a capability ledger with `proven`, `inferred`, `unknown`, and `resolved` entries;
- an experiment matrix that changes one security-relevant variable per row.

For each privileged field, identify the component that owns its vocabulary or validation.
Extract accepted enum values from schemas, tool descriptions, source, or deliberate invalid
sentinels before guessing plausible names. Interrogate the boundary that creates the trusted
field, not merely the downstream consumer.

### 4. Choose discriminating probes

Rank candidate probes by expected information gain divided by cost and risk. Prefer a probe
that separates competing explanations over one that merely repeats a symptom.

After three misses on one branch:

1. restate the win predicate;
2. list the leading remaining explanations;
3. mark confounded results inconclusive;
4. stop equivalent low-information probes;
5. choose the smallest orthogonal experiment.

Do not name unobserved tools, endpoints, or fields inside exploit payloads. Guessed internals
can redirect a model or confound the result. Use a simple business payload and isolate
authorization-context manipulation from downstream content.

### 5. Escalate deliberately

Use this default order:

1. passive/source-assisted discovery;
2. clean stateless probes;
3. authoritative schema and vocabulary discovery;
4. controlled field or identity substitution;
5. minimal exploit-chain assembly;
6. persistent-state attacks, races, and replay only after clean paths are exhausted.

Before a persistent or destructive step, record why it is necessary, its expected effect, how
to recognize success, and whether rollback or a fresh instance exists.

Use [references/field-playbook.md](references/field-playbook.md) for source-assisted web,
opaque-service, packet-capture, and agent-security pivots.

### 6. Prove the real win

Assume flags bundled in source, fixtures, Docker images, or local development responses are
test data unless the challenge explicitly says otherwise. A flag-shaped string is not enough.

Before declaring victory:

1. run the chain against the live scoped target;
2. capture the complete flag from the authoritative output;
3. reject known placeholder, fake, or test flags;
4. independently re-read the state or reproduce the final step;
5. record exactly which operator found and verified it.

If a teammate wins, say **the team won**. Do not claim personal discovery of a path found by
someone else. Preserve failed and inconclusive attempts when they explain why the final route
was chosen.

## Finish and hand off

Leave the progress record with:

- the simple diagram updated to the final chain;
- `WON — independently verified` or a precise blocker;
- sanitized reproduction steps;
- artifact and recovered-object hashes where relevant;
- confidence-qualified attribution;
- failed branches worth avoiding;
- the smallest useful lesson for the next challenge.

Keep live secrets, credentials, target addresses, and flags in the gitignored `.context/`
record. When converting durable behavior into repo documentation or a skill, generalize it and
remove challenge-specific secrets.
