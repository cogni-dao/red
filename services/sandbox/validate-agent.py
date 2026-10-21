#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2026 Cogni-DAO
"""Live Red agent exercise. No runtime credentials, grants or automatic retries."""

import argparse
import base64
import json
import os
from pathlib import Path
import re
import secrets
import time
import urllib.error
import urllib.request
import uuid

APP = "https://red-test.cognidao.org"
RUNTIME = "https://red-sandbox-test.cognidao.org"
EXEC = "core__sandbox_exec"
READ = "core__sandbox_read_file"
WRITE = "core__sandbox_write_file"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward an agent credential to another destination.


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sha", required=True)
    parser.add_argument("--credentials-file", type=Path)
    parser.add_argument("--preflight-only", action="store_true")
    parser.add_argument("--availability-only", action="store_true")
    parser.add_argument("--model", default="gpt-oss-120b")
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9a-f]{40}", args.sha):
        parser.error("--sha must be the full PR-head SHA")

    root = Path(".context") / ("sandbox-agent-" + uuid.uuid4().hex)
    root.mkdir(parents=True, mode=0o700)
    receipt = {"expectedSha": args.sha, "verdict": "UNPROVEN", "turns": []}
    key = ""
    opener = urllib.request.build_opener(NoRedirect)

    def save():
        raw = json.dumps(receipt, indent=2)
        if key:
            raw = raw.replace(key, "[redacted]")
        (root / "receipt.json").write_text(raw + "\n")

    def request(url, body=None):
        headers = {"User-Agent": "curl/8.7.1", "Accept": "application/json"}
        if body is not None:
            headers.update({"Authorization": "Bearer " + key,
                            "Content-Type": "application/json"})
        return urllib.request.Request(url, headers=headers,
                                      data=json.dumps(body).encode() if body else None)

    def turn(label, message, state=None):
        body = {"message": message, "messageId": uuid.uuid4().hex,
                "graphName": "red-solver",
                "modelRef": {"providerKey": "platform", "modelId": args.model}}
        if state:
            body["stateKey"] = state
        record = {"label": label, "messageId": body["messageId"], "events": []}
        receipt["turns"].append(record)
        save()  # Persist intent before the potentially side-effecting request.
        with opener.open(request(APP + "/api/v1/ai/chat", body), timeout=45) as response:
            record.update({"httpStatus": response.status,
                           "runId": response.headers.get("X-Run-Id"),
                           "stateKey": response.headers.get("X-State-Key"),
                           "requestId": response.headers.get("X-Request-Id")})
            save()  # Preserve the authoritative run ID if delivery is interrupted.
            assert record["runId"] and record["stateKey"], "Missing run/thread identity"
            assert state is None or record["stateKey"] == state, "Thread binding changed"
            assert "text/event-stream" in response.headers.get("Content-Type", ""), "Not SSE"
            deadline, size = time.monotonic() + 240, 0
            for line in response:
                size += len(line)
                assert size <= 2_000_000 and time.monotonic() < deadline, "Stream budget exceeded"
                if not line.startswith(b"data:"):
                    continue
                data = line[5:].strip()
                if data == b"[DONE]":
                    break
                event = json.loads(data)
                record["events"].append(event)
                save()
                if event.get("type") in ("finish", "error"):
                    break
        events = record["events"]
        assert any(e.get("type") == "finish" and e.get("finishReason") == "stop"
                   for e in events), "No successful terminal event; do not retry"
        assert not any(e.get("type") == "error" for e in events), "Agent execution error"
        outputs = {e["toolCallId"]: e.get("output") for e in events
                   if e.get("type") == "tool-output-available"}
        calls = [{"name": e["toolName"], "input": e.get("input", {}),
                  "output": outputs.get(e["toolCallId"])}
                 for e in events if e.get("type") == "tool-input-available"]
        record["calls"] = calls
        record["answer"] = "".join(e.get("delta", "") for e in events
                                   if e.get("type") == "text-delta")
        save()
        return record, calls

    def observed(calls, name, action=None):
        return [c for c in calls if c["name"] == name
                and (action is None or c["input"].get("action") == action)
                and isinstance(c["output"], dict) and c["output"].get("status") == "ok"]

    try:
        receipt["versions"] = {}
        for name, origin in [("app", APP), ("runtime", RUNTIME)]:
            with opener.open(request(origin + "/version"), timeout=15) as response:
                version = json.loads(response.read(4096))
            receipt["versions"][name] = version
            save()
            assert version.get("buildSha") == args.sha, name + " SHA differs from PR head"
        if args.preflight_only:
            receipt["verdict"] = "PREFLIGHT_ONLY"
            return

        credentials = {}
        if args.credentials_file:
            assert args.credentials_file.stat().st_mode & 0o077 == 0, "Credential file must be private (0600)"
            for line in args.credentials_file.read_text().splitlines():
                if "=" in line and not line.lstrip().startswith("#"):
                    name, value = line.split("=", 1)
                    credentials[name.strip()] = value.strip().strip("\"'")
        key = os.environ.get("COGNI_CANDIDATE_NODE_API_KEY") or credentials.get("COGNI_CANDIDATE_NODE_API_KEY", "")
        assert key, "Persisted candidate agent credential required; no registration or impersonation"
        if args.availability_only:
            _, calls = turn("availability", "Authorized scope: your own empty local sandbox fixture only. "
                            "Call core__sandbox_read_file once for aci-availability.txt and report its actual result. "
                            "Do not use shell, HTTP or fallback tools; do not invent a successful read.")
            receipt["verdict"] = "AVAILABILITY_PROBE_ONLY_NO_ACCEPTANCE"
            receipt["successfulReadObserved"] = bool(observed(calls, READ))
            return

        flag = "REDPOC{" + secrets.token_hex(16) + "}"
        nonce = secrets.token_hex(16)
        xor = secrets.randbelow(255) + 1
        cipher = base64.b64encode(bytes(b ^ xor for b in flag.encode())).decode()
        first, calls = turn("nonweb-solve", f"Authorized scope: self-owned local fixture only, no network. "
                            f"Single-byte XOR forensics challenge: base64 ciphertext {cipher}. "
                            "Recover the ASCII REDPOC{...} flag with tools, not a guessed answer. "
                            "Write solve.py with sandbox_write_file, brute-force the key with Python, "
                            "save the answer to answer.txt and read it with sandbox_read_file. "
                            f"Use sandbox_exec shell to export RED_POC_STATE={nonce}, then execute your solver. "
                            "Use separate shell calls to demonstrate persistence. Halt on unavailable or unknown; do not retry.")
        assert observed(calls, WRITE) and observed(calls, EXEC, "shell"), "Missing observed write/shell success"
        assert any(flag in c["output"].get("output", "") for c in observed(calls, READ)), "No observed recovered flag"
        assert flag in first["answer"], "Agent did not answer with the observed flag"
        second, calls = turn("reuse-background", "Same authorized local workspace; no network. "
                             "Do not recreate answer.txt or RED_POC_STATE. Read answer.txt, then print "
                             "$RED_POC_STATE using sandbox_exec shell. Start a bounded background command "
                             "with sandbox_exec start: python3 -c \"import time; print('bg-start',flush=True); "
                             "time.sleep(2); print('bg-finished',flush=True)\". Poll its commandId until exit, "
                             "then read retained logs with sandbox_exec logs. Report observed results. "
                             "Halt on unknown; never replay a start.", first["stateKey"])
        assert any(flag in c["output"].get("output", "") for c in observed(calls, READ)), "File reuse unproven"
        assert any(nonce in c["output"].get("output", "") for c in observed(calls, EXEC, "shell")), "Shell reuse unproven"
        assert not any(c["name"] == WRITE or flag in json.dumps(c["input"])
                       or nonce in json.dumps(c["input"]) for c in calls), "Reuse turn recreates known state"
        handles = {c["output"].get("commandId") for c in observed(calls, EXEC, "start")}
        assert handles and None not in handles, "Background start unproven"
        assert any(c["input"].get("commandId") in handles and c["output"].get("running") is False
                   and c["output"].get("exitCode") == 0 for c in observed(calls, EXEC, "poll")), "Background exit unproven"
        assert any(c["input"].get("commandId") in handles and "bg-finished" in c["output"].get("output", "")
                   for c in observed(calls, EXEC, "logs")), "Retained logs unproven"
        # A passing exercise is deliberately narrower than the full release gate.
        receipt["verdict"] = "ACI_EXERCISE_PASS_REQUIRES_LOKI_AND_CONTAINMENT_PROOF"
    except urllib.error.HTTPError as error:
        receipt["verdict"] = "FAIL_OR_UNKNOWN_DO_NOT_RETRY"
        receipt["failure"] = "HTTP " + str(error.code)
        receipt["httpFailure"] = {
            "status": error.code,
            "requestId": error.headers.get("X-Request-Id"),
            "cfRay": error.headers.get("CF-Ray"),
            "body": error.read(4096).decode(errors="replace"),
        }
        raise SystemExit(1) from None
    except Exception as error:
        receipt["verdict"] = "FAIL_OR_UNKNOWN_DO_NOT_RETRY"
        receipt["failure"] = type(error).__name__ + ": " + str(error)
        raise SystemExit(1) from None
    finally:
        save()
        print(json.dumps({"verdict": receipt["verdict"], "receipt": str(root / "receipt.json"),
                          "failure": receipt.get("failure")}))


if __name__ == "__main__":
    main()
