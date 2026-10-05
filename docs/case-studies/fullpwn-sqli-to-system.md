---
id: case-study.fullpwn-sqli-system
type: case-study
title: Evidence-led Fullpwn from SQL injection to Windows SYSTEM
status: draft
trust: draft
summary: Sanitized lessons from an authorized two-flag Windows Fullpwn investigation.
read_when: Planning or reviewing an authorized Windows web-to-SYSTEM CTF chain.
owner: derekg1729
created: 2026-10-05
verified: 2026-10-05
tags: [ctf, windows, sqli, mssql, seimpersonate]
---

# Evidence-led Fullpwn from SQL injection to Windows SYSTEM

This is a sanitized case study from an authorized, team-exclusive HTB CTF instance. The complete
target address, VPN profile, requests, flags, and proof hashes remain in a gitignored `.context`
record. They are intentionally absent from this public repository.

## Outcome

Both live flag files were read from the scoped target and independently hashed. The final chain was:

```text
event VPN -> web SQL injection -> MSSQL sysadmin -> OS command execution
          -> service account with SeImpersonatePrivilege -> SYSTEM -> both live flags
```

## What established each link

| Link | Decisive evidence |
| --- | --- |
| Network placement | The target subnet routed through the HTB tunnel, while the VPN server itself routed through the physical interface. |
| Initial access | A controlled login input changed authentication failure to success. |
| Data-layer control | An authenticated search input accepted a four-column `UNION` and returned server-selected values. |
| Database privilege | The application connection resolved to SQL Server `sa`/`dbo` with the `sysadmin` role. |
| OS execution | Temporarily enabled `xp_cmdshell` returned the MSSQL service identity and host privilege list. |
| Escalation primitive | The service token had enabled `SeImpersonatePrivilege`. |
| SYSTEM execution | A token-impersonation helper returned `NT AUTHORITY\SYSTEM` before launching the proof command. |
| Win proof | Each flag was read from the live target and checked again with an on-target SHA-256 calculation. |

The user-level flag was readable from a public user profile. The SYSTEM flag required access to the
Administrator profile, so database command execution alone did not satisfy the two-flag win
condition.

## The shortest successful path

1. Establish the correct event VPN route before interpreting service behavior.
2. Fingerprint only a focused service set; identify IIS, MSSQL, SMB/RPC, and WinRM.
3. Use the login injection to obtain the application session expected by the account-search API.
4. Use a typed `UNION` probe to map result columns and prove the database identity and role.
5. Enable `xp_cmdshell` only after proving SQL `sysadmin`; capture commands through a temporary
   table so every result remains visible in the existing web response.
6. Read and hash the user flag.
7. Inspect the service token, observe `SeImpersonatePrivilege`, and use the compatible impersonation
   primitive to launch a single SYSTEM proof command.
8. Read and separately hash the SYSTEM flag.
9. Remove staged binaries and the temporary SQL table, then disable both `xp_cmdshell` and advanced
   options and verify their effective values returned to zero.

## Dead ends worth preserving

- A commercial VPN remained the default route. The HTB client appeared connected, but its outer UDP
  session was nested through the commercial tunnel and stopped passing traffic after a few minutes.
  Verifying both the target route and the VPN server's outer route exposed the conflict.
- A reused private IP was not evidence that an unrelated public write-up or static flag belonged to
  this instance. Only the live target could prove the flags.
- TCP acceptance and a tunnel interface were not enough to prove correct network placement. Route
  ownership and a target identity marker were required.
- One impersonation implementation found the privilege but timed out while triggering its named-pipe
  path. A second implementation compatible with the target OS acquired SYSTEM immediately.
- Recursive filesystem searches consumed time and added little information. Known Windows flag paths
  and bounded directory checks were more discriminating.

## Reusable lessons

- Write the exact two-flag success predicate before probing; a foothold or one flag is not a win.
- Keep routing evidence separate from application evidence.
- Prove SQL type shape with `NULL` before inserting metadata expressions into a `UNION`.
- Database `sysadmin` is a capability boundary, not automatically SYSTEM; inspect the service token.
- When a privilege primitive fails, preserve its exact failure and change implementation, not the
  underlying hypothesis.
- Independently verify live flags and clean up every configuration or file introduced by the exploit.

For the operational VPN procedure, see
[Connect macOS to an HTB CTF Fullpwn VPN](../guides/htb-fullpwn-vpn-macos.md). For the investigation
record structure and proof standard, use the repository's `solve-ctf-challenges` skill.
