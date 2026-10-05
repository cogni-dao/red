# Evidence-led CTF field playbook

Load only the section matching the challenge surface. These are pivot patterns, not a checklist
that must be exhausted.

## Private lab or VPN target

1. Confirm that the profile belongs to the exact event or lab that issued the target. A valid
   profile for a different HTB product can connect successfully while installing the wrong routes.
2. Verify the target route independently of the client's green status. On macOS, use
   `route -n get <target-ip>` and require the expected `utun` interface and lab gateway.
3. Verify the VPN server's outer route too. It should use the physical network interface; if it
   uses another commercial VPN tunnel, the nested connection may flap or silently black-hole.
4. Disconnect competing VPNs through their normal UI, then reconnect the lab profile. Do not kill
   helpers, delete routes, or approve unexpected privilege prompts merely to force the state.
5. Distinguish routing from service reachability: a correct route is proof of network placement;
   ping or one closed port is not proof that the target is down.
6. Keep one OpenVPN session active. Repeated disconnects, extra tunnel interfaces, or stale routes
   justify a clean client reconnect before more target probing.

## Source-assisted web or service challenge

1. Inventory routes, trust boundaries, workers, backing services, secrets flow, and privileged
   sinks from source before fuzzing.
2. Draw source-to-sink paths for every attacker-controlled field.
3. Distinguish what is validated in the frontend, API, queue, worker, and final sink.
4. Reproduce locally to prove a primitive, but preserve environment differences.
5. Preflight the live target's identity before exploitation.
6. Build one minimal chain and verify its final output through an authoritative route.

When dependencies are stale, prefer a local compatibility shim or isolated harness. Do not
modify challenge source merely to make the exploit appear successful.

## Opaque or silent network service

1. Distinguish transport reachability from application response.
2. Try a small set of genuinely different standard handshakes and record raw behavior.
3. Stop repeating HTTP/TLS variants after they cease adding information.
4. Use full service/version detection or derive the protocol from supplied artifacts.
5. Once identified, use a protocol-native client with the least-destructive command.

Silence is a protocol clue, not proof that the service is dead.

## Packet capture or forensic artifact

1. Hash the original, inspect the archive manifest, and work on a copy.
2. Establish capture duration, truncation, protocol hierarchy, endpoints, and conversations.
3. Rank flows by fan-out, repeated failures, unusual volume, and trust-boundary crossings.
4. Reassemble decisive streams and cite packet/stream identifiers for each claim.
5. Extract complete raw fields; formatted or verbose displays may truncate ciphertext or blobs.
6. Validate recovered objects locally by format, parser, cryptographic check, or hash.
7. Derive the remote service and use of any credential from evidence; never spray recovered
   material across unrelated protocols.
8. State tool attribution with calibrated confidence when the executable is not directly shown.

## Agent, workflow, or prompt-injection challenge

1. Identify which agent/tool constructs each authorization-bearing field.
2. Obtain exact schemas and enums from that owner through source, description disclosure, or an
   invalid sentinel that elicits validation output.
3. Keep a fixed, ordinary business payload while varying one authorization field.
4. Record requested fields, actual serialized fields, selected tools, final sink inputs, and
   authoritative state separately.
5. Never infer an enum is invalid from a probe that also changed tool instructions or payload
   semantics.
6. Delay stored prompt injection until clean stateless variants are exhausted; persistent
   context can contaminate every later result.
7. Treat stochastic model behavior and deterministic tool enforcement as separate boundaries.

## Exploit-chain verification

Use a chain table:

| Link | Input | Expected output | Proof | Status |
|---|---|---|---|---|
| 1 | controlled input | parser behavior | request/trace | proven |
| 2 | transformed data | privileged primitive | log/state | proven |
| 3 | primitive | live final action | authoritative output | unknown |
| 4 | final action | complete flag | second read | unknown |

Do not skip an unknown link by narrating that it probably works. Exercise it or mark the chain
incomplete.

## Failure review

For each expensive dead end, capture:

- the hypothesis;
- the exact probe;
- which variables changed;
- the observed result;
- whether the result was conclusive;
- the next probe that would have separated the alternatives.

The goal is not to celebrate every attempt. It is to prevent the same uninformative branch from
consuming the next challenge.
