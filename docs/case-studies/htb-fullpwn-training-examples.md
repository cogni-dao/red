---
id: case-study.htb-fullpwn-training
type: case-study
title: Evidence-led HTB CTF Fullpwn training examples
status: draft
trust: draft
summary: Sanitized lessons from three authorized two-flag Fullpwn investigations.
read_when: Planning or reviewing an authorized HTB CTF web-to-root or web-to-SYSTEM chain.
owner: derekg1729
created: 2026-10-05
verified: 2026-10-05
tags: [ctf, fullpwn, web, routing, linux, windows]
---

# Evidence-led HTB CTF Fullpwn training examples

These sanitized examples come from authorized, team-exclusive HTB CTF instances. Complete target
addresses, VPN material, requests, credentials, flags, and proof hashes remain in gitignored
`.context` records. They are intentionally absent from this public repository.

Every example used the same success predicate: read both live flag files from the scoped target and
independently verify them. A vulnerability, privileged shell, or first flag alone was not a win.

## The three training chains

| Example | Initial boundary | Privileged pivot | Final boundary |
| --- | --- | --- | --- |
| SQL injection to Windows SYSTEM | Web login and authenticated search SQL injection | MSSQL `sysadmin`, OS command execution, token impersonation | `NT AUTHORITY\SYSTEM` |
| Router foothold to host root | Exposed Git history and command injection | Controlled BGP interception of a plaintext protocol | Root SSH on the host |
| Unsafe pickle to Linux root | Unsigned serialized dashboard cookie | Code execution as the app user, then vulnerable SUID `pkexec` | Root shell |

## Example 1: SQL injection to Windows SYSTEM

### Outcome

```text
event VPN -> web SQL injection -> MSSQL sysadmin -> OS command execution
          -> service account with SeImpersonatePrivilege -> SYSTEM -> both live flags
```

### What established each link

| Link | Decisive evidence |
| --- | --- |
| Network placement | The target subnet routed through the HTB tunnel, while the VPN server itself routed through the physical interface. |
| Initial access | A controlled login input changed authentication failure to success. |
| Data-layer control | An authenticated search input accepted a four-column `UNION` and returned server-selected values. |
| Database privilege | The application connection resolved to SQL Server `sa`/`dbo` with the `sysadmin` role. |
| OS execution | Temporarily enabled `xp_cmdshell` returned the MSSQL service identity and host privilege list. |
| Escalation primitive | The service token had enabled `SeImpersonatePrivilege`. |
| SYSTEM execution | A compatible token-impersonation helper returned `NT AUTHORITY\SYSTEM`. |
| Win proof | Each flag was read from the live target and checked again with an on-target SHA-256 calculation. |

The user-level flag was readable from a public user profile. The SYSTEM flag required the
Administrator profile, so database command execution alone did not satisfy the two-flag condition.

### Shortest successful path

1. Establish the correct event VPN route before interpreting service behavior.
2. Fingerprint a focused service set and identify IIS, MSSQL, SMB/RPC, and WinRM.
3. Use login injection to obtain the session expected by the account-search API.
4. Use a typed `UNION` probe to map result columns and prove database identity and role.
5. Enable `xp_cmdshell` only after proving SQL `sysadmin`; capture command output through a
   temporary table so it remains visible in the existing web response.
6. Read and hash the user flag.
7. Inspect the service token and use its enabled impersonation privilege for one SYSTEM proof.
8. Read and hash the SYSTEM flag.
9. Remove staged binaries and the temporary table, then disable the SQL options and verify their
   effective values returned to zero.

## Example 2: Router foothold, BGP interception, and host root

### Outcome

```text
event VPN -> exposed Git history -> recovered application credential
          -> health-check command injection -> root inside edge-router container
          -> filtered more-specific BGP advertisements -> plaintext credential interception
          -> credential reuse over host SSH -> host root -> both live flags
```

### What established each link

| Link | Decisive evidence |
| --- | --- |
| Source disclosure | Loose Git objects reconstructed both current source and a deleted database from history. |
| Authentication | A credential recovered from the deleted database produced a valid application session. |
| Command execution | A newline bypassed a malformed health-check blacklist and returned uid 0. |
| Container boundary | `/.dockerenv`, cgroup data, and bind mounts proved that uid 0 belonged to a router container rather than the host. |
| Network role | Quagga configuration and the BGP RIB showed one attacker-controlled AS between two customer networks. |
| Controlled interception | A server `/32` was advertised only toward the client-side peer and a client `/32` only toward the server-side peer. |
| Credential recovery | A narrowly filtered capture observed a successful plaintext application login crossing the controlled router. |
| Host root | The recovered identity authenticated to the Docker bridge host over SSH and returned uid 0. |
| Win proof | Both live flags were read and independently SHA-256 hashed. |

The first uid 0 shell was a capability, not the final privilege boundary. The decisive pivot was
recognizing that the compromised workload was a network appliance and that its routing authority—not
its container filesystem—was the intended bridge to the host.

### Why the BGP filters mattered

Advertising both endpoint `/32`s to both peers could have sent an endpoint's own traffic back toward
the attacker-controlled router and created a loop. The safe experiment used three controls:

1. Install one static `/32` toward each endpoint's legitimate router so intercepted packets still
   had a valid onward path.
2. Deny the client `/32` toward the client-side router and deny the server `/32` toward the
   server-side router.
3. Confirm per-neighbor advertised routes before waiting for traffic.

Only the relevant plaintext control protocol and the two known endpoint addresses were captured.
After proof, the advertisements, static routes, prefix lists, route-map entries, capture, and
temporary authentication files were removed; the original running configuration was rechecked.

## Example 3: Unsafe Python pickle and PwnKit

### Outcome

```text
event VPN -> Flask signup/login -> unsigned pickle cookie -> app-user command execution
          -> vulnerable SUID pkexec -> root -> both live flags
```

### What established each link

| Link | Decisive evidence |
| --- | --- |
| Application identity | The web root redirected to a named Flask virtual host with signup, login, dashboard, and logout routes. |
| Serialized object | The authenticated dashboard issued a short base64 cookie that safely disassembled to a Python application class instance. |
| Deserialization execution | A pickle containing `time.sleep(4)` caused a four-second response before the expected application error. |
| User shell | A second reducer invoked one callback command and returned the application service identity. |
| User flag | The live user flag was read, represented as exact bytes, and SHA-256 hashed. |
| Escalation candidate | SUID enumeration found `pkexec`; its installed package was an unpatched build affected by PwnKit. |
| Root execution | A minimal temporary gconv payload and launcher returned uid 0. |
| Root flag | The live root file was read, inspected for trailing whitespace, and hashed over its exact bytes. |

### Shortest successful path

1. Register and authenticate a normal account rather than guessing privileged credentials.
2. Base64-decode and use `pickletools.dis` to inspect the cookie without loading it locally.
3. Prove server-side execution with a low-impact timing reducer before requesting a callback shell.
4. Read and hash the user flag from the application account.
5. Check sudo, SUID programs, file capabilities, scheduled jobs, and package versions directly;
   avoid deploying a broad enumeration script when a focused inventory is sufficient.
6. Compile the smallest known PwnKit primitive in a dedicated temporary directory and verify uid 0.
7. Read the root flag twice: once for the visible value and once as exact bytes so trailing whitespace
   cannot create an incorrect proof hash.
8. Delete the temporary application account and exploit build, then close the callback process.

## Dead ends worth preserving

- A connected VPN UI did not prove the target subnet used the right route. Both the target route and
  the VPN server's outer route had to be checked.
- A reused private address did not identify a challenge or validate an unrelated public write-up.
  Only the live scoped target could prove a flag.
- Recursive filesystem searches produced less information than source review, process ownership,
  routing state, SUID inventory, and bounded directory checks.
- Container root and database `sysadmin` were intermediate capabilities, not final host privilege.
- The first packet-capture launch failed because a restricted command environment could not resolve
  the binary; using its absolute path fixed the experiment without changing the hypothesis.
- The first PwnKit invocation supplied ordinary process arguments and therefore did not trigger the
  out-of-bounds environment behavior. A minimal launcher with a null argument vector did.
- Long-lived callbacks froze when the event VPN stalled. Short evidence batches and clean callbacks
  reduced repeated work.

## Reusable lessons

- Write the exact two-flag predicate before probing and keep every trust boundary explicit.
- Prefer source or object-format inspection over blind fuzzing when the application exposes either.
- Prove a dangerous primitive with the smallest observable side effect before building the full chain.
- Treat container root, database admin, and network control as capabilities whose downstream reach
  must be demonstrated.
- When changing routes, verify advertisements per peer and design rollback before applying them.
- Verify package versions before selecting a local privilege-escalation implementation.
- Hash the authoritative live files, and inspect exact bytes when whitespace is ambiguous.
- Remove accounts, captures, routes, binaries, tables, and configuration changes introduced during
  the solve.

For the operational VPN procedure, see
[Connect macOS to an HTB CTF Fullpwn VPN](../guides/htb-fullpwn-vpn-macos.md). For the investigation
record structure and proof standard, use the repository's `solve-ctf-challenges` skill.
