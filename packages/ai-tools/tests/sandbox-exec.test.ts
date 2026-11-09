// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@cogni/ai-tools/tests/sandbox-exec`
 * Purpose: Unit tests for the core__sandbox_exec tool contract and implementation.
 * Scope: Contract shape, input validation, capability mapping, no-throw error path, unavailable default.
 * Invariants: No network calls; the SandboxExecCapability is a stub.
 * Side-effects: none
 * Links: src/tools/sandbox-exec.ts, src/capabilities/sandbox.ts
 * @internal
 */

import { describe, expect, it, vi } from "vitest";

import type { SandboxExecCapability } from "../src/capabilities/sandbox";
import {
  SANDBOX_EXEC_NAME,
  SandboxExecOutputSchema,
  createSandboxExecImplementation,
  sandboxExecContract,
  sandboxExecUnavailableImplementation,
} from "../src/tools/sandbox-exec";

describe("core__sandbox_exec contract", () => {
  it("has the namespaced tool id", () => {
    expect(sandboxExecContract.name).toBe("core__sandbox_exec");
    expect(SANDBOX_EXEC_NAME).toBe("core__sandbox_exec");
  });

  it("is an external side effect with a non-empty allowlist", () => {
    expect(sandboxExecContract.effect).toBe("external_side_effect");
    expect(sandboxExecContract.allowlist).toContain("stdout");
    expect(sandboxExecContract.allowlist).toContain("exitCode");
    expect(sandboxExecContract.allowlist).toContain("status");
  });

  describe("inputSchema", () => {
    it("accepts a bounded command", () => {
      const parsed = sandboxExecContract.inputSchema.parse({ command: "id" });
      expect(parsed.command).toBe("id");
    });

    it("rejects an empty command", () => {
      expect(() =>
        sandboxExecContract.inputSchema.parse({ command: "" })
      ).toThrow();
    });

    it("rejects an over-long command", () => {
      expect(() =>
        sandboxExecContract.inputSchema.parse({ command: "a".repeat(16385) })
      ).toThrow();
    });

    it("rejects a timeout below the floor", () => {
      expect(() =>
        sandboxExecContract.inputSchema.parse({ command: "id", timeoutMs: 10 })
      ).toThrow();
    });

    it("rejects a timeout above the ceiling", () => {
      expect(() =>
        sandboxExecContract.inputSchema.parse({
          command: "id",
          timeoutMs: 900001,
        })
      ).toThrow();
    });
  });
});

describe("createSandboxExecImplementation", () => {
  it("maps a capability result to an ok output", async () => {
    const cap: SandboxExecCapability = {
      exec: vi.fn(async () => ({
        exitCode: 0,
        stdout: "uid=0(root)",
        stderr: "",
        truncated: false,
        errorName: null,
      })),
    };
    const impl = createSandboxExecImplementation({ sandboxExecCapability: cap });

    const out = await impl.execute({ command: "id", timeoutMs: 5000 });

    expect(cap.exec).toHaveBeenCalledWith({ command: "id", timeoutMs: 5000 });
    expect(out).toMatchObject({
      status: "ok",
      exitCode: 0,
      stdout: "uid=0(root)",
      truncated: false,
    });
    expect(out.message).toBeUndefined();
    expect(() => SandboxExecOutputSchema.parse(out)).not.toThrow();
  });

  it("surfaces an execd error name as a message while staying ok", async () => {
    const cap: SandboxExecCapability = {
      exec: async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "boom",
        truncated: false,
        errorName: "CommandExecError",
      }),
    };
    const impl = createSandboxExecImplementation({ sandboxExecCapability: cap });

    const out = await impl.execute({ command: "false" });

    expect(out.status).toBe("ok");
    expect(out.exitCode).toBe(1);
    expect(out.message).toContain("CommandExecError");
  });

  it("returns a structured error instead of throwing on transport failure", async () => {
    const cap: SandboxExecCapability = {
      exec: async () => {
        throw new Error("sandbox /command failed with HTTP 502");
      },
    };
    const impl = createSandboxExecImplementation({ sandboxExecCapability: cap });

    const out = await impl.execute({ command: "id" });

    expect(out.status).toBe("error");
    expect(out.exitCode).toBe(-1);
    expect(out.message).toContain("502");
    expect(() => SandboxExecOutputSchema.parse(out)).not.toThrow();
  });
});

describe("sandboxExecUnavailableImplementation", () => {
  it("returns a structured unavailable result without throwing", async () => {
    const out = await sandboxExecUnavailableImplementation.execute({
      command: "id",
    });
    expect(out.status).toBe("unavailable");
    expect(out.exitCode).toBe(-1);
    expect(out.message).toMatch(/not configured/i);
    expect(() => SandboxExecOutputSchema.parse(out)).not.toThrow();
  });
});
