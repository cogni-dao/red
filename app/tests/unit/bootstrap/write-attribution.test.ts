// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@tests/unit/bootstrap/write-attribution`
 * Purpose: A run's write records the run's actor and the run (task.0175); a route write records its caller only.
 * Scope: The host's real builders over the real launcher scope, with the write ports stubbed.
 * Invariants:
 *   - ACTOR_IS_THE_PRINCIPAL: a run write's actor is the run's actor and a run with none writes nothing.
 *   - UNKNOWN_RUN_NEVER_BLOCKS: a run with no kind writes without a `Run:` line.
 * Side-effects: none
 * @internal
 */

import { bindEdoToolCapability, type EdoCapability } from "@cogni/knowledge-store";
import {
  createWorkItemWriters,
  routeAttribution,
  type WriteAttribution,
} from "@cogni/work-items";
import { beforeEach, describe, expect, it, vi } from "vitest";

const attributionLog = vi.hoisted(() => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock("@/shared/observability", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/observability")>()),
  makeLogger: () => attributionLog,
}));

import { createWorkItemCapability } from "@/bootstrap/capabilities/work-item";
import {
  getExecutionScope,
  runInScope,
} from "@/adapters/server/ai/execution-scope";
import { runGraphWithScope } from "@/bootstrap/graph-executor.factory";
import { runAttribution } from "@/bootstrap/run-attribution";

const A = "node-ai-principal";
const S = "run-subject";
const RUN = { id: "run-42", kind: "system_scheduled" } as const;

/** Runs `fn` the way a graph tool call does: the real launcher builds the scope, and the tool guard binds the principal and subject (`runAs`). */
function inRun<T>(
  options: { actor?: string; subject?: string; runKind?: typeof RUN.kind },
  fn: () => T
): T {
  let result: T | undefined;
  runGraphWithScope({
    executor: {
      runGraph: () => {
        result = runInScope(
          {
            ...getExecutionScope(),
            ...(options.actor ? { principalId: options.actor } : {}),
            ...(options.subject ? { subjectUserId: options.subject } : {}),
          },
          fn
        );
        return {
          stream: (async function* () {})(),
          final: Promise.resolve({ ok: true }),
        } as never;
      },
    } as never,
    req: {
      runId: RUN.id,
      graphId: "langgraph:work-prioritizer",
      messages: [],
      modelRef: { providerKey: "platform", modelId: "m" },
    } as never,
    ctx: options.subject ? { actorUserId: options.subject } : {},
    billing: { billingAccountId: "b", virtualKeyId: "v" },
    llmService: {} as never,
    usageSource: "litellm",
    ...(options.runKind ? { runKind: options.runKind } : {}),
  });
  return result as T;
}

describe("write attribution", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a route write names its caller and nothing else", () => {
    expect(routeAttribution("caller-1")).toEqual({ actor: "caller-1" });
  });

  it("a run write names the run's actor and the run", () => {
    const attribution = inRun({ actor: A, runKind: RUN.kind }, () =>
      runAttribution()
    );
    expect(attribution).toEqual({ actor: A, run: RUN });
    expect(attributionLog.warn).not.toHaveBeenCalled();
  });

  it("a run with a subject records it as the requester, never the actor", () => {
    const attribution = inRun({ actor: A, subject: S, runKind: RUN.kind }, () =>
      runAttribution()
    );
    expect(attribution).toEqual({ actor: A, requestedBy: S, run: RUN });
  });

  it("a run with no kind still writes as the actor, with no Run line, and says so once", () => {
    const attribution = inRun({ actor: A }, () => runAttribution());
    expect(attribution).toEqual({ actor: A });
    expect(attributionLog.warn).toHaveBeenCalledTimes(1);
    expect(attributionLog.warn.mock.calls[0]?.[0]).toMatchObject({
      event: "work.items.attribution_run_missing",
      runId: RUN.id,
      hasRunKind: false,
    });
  });

  it("a run with no actor writes nothing", () => {
    expect(() => inRun({ runKind: RUN.kind }, () => runAttribution())).toThrow(
      "no acting principal"
    );
  });

  it("the EDO tool binding attributes each write from the run at call time", async () => {
    const seen: WriteAttribution[] = [];
    const edo = {
      hypothesize: vi.fn(async (_p: unknown, a: WriteAttribution) => {
        seen.push(a);
        return {} as never;
      }),
      decide: vi.fn(),
      recordOutcome: vi.fn(),
      getChain: vi.fn(),
    } as unknown as EdoCapability;
    const tool = bindEdoToolCapability(edo, runAttribution);
    await inRun({ actor: A, runKind: RUN.kind }, () =>
      tool.hypothesize({} as never)
    );
    expect(seen).toEqual([{ actor: A, run: RUN }]);
  });

  it("a tool's work-item patch reaches the store attributed to the run, and a run with no actor is refused and logged", async () => {
    const patched = {
      id: "task.0001",
      type: "task",
      title: "t",
      status: "needs_implement",
      priority: 2,
      rank: 0,
      estimate: 1,
      summary: "s",
      outcome: "",
      assignees: [],
      externalRefs: [],
      labels: [],
      specRefs: [],
      revision: 9,
      deployVerified: false,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-02",
    };
    const patch = vi.fn().mockResolvedValue(patched);
    const info = vi.fn();
    const { backlogWriter } = createWorkItemWriters({
      log: { info, warn: vi.fn() },
      scope: getExecutionScope,
      traceId: () => undefined,
      store: () => ({ patch }),
      artifacts: () => undefined,
    });
    const capability = createWorkItemCapability({
      workItemQuery: {} as never,
      workItemCommand: {} as never,
      backlogWriter,
    });
    const input = {
      id: "task.0001",
      expectedRevision: 8,
      reason: "triage",
      set: { rank: 2 },
    } as never;

    await inRun({ actor: A, runKind: RUN.kind }, () => capability.patch(input));
    expect(patch.mock.calls[0]?.[1]).toEqual({ actor: A, run: RUN });
    expect(info.mock.calls[0]?.[0]).toMatchObject({
      event: "work.items.patch_success",
      via: "tool",
      actor: A,
      runId: RUN.id,
      runKind: RUN.kind,
    });

    await expect(
      inRun({ runKind: RUN.kind }, () => capability.patch(input))
    ).rejects.toThrow("no acting principal");
    expect(patch).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[1]?.[0]).toMatchObject({
      event: "work.items.patch_refused",
      errorCode: "attribution_denied",
    });
  });
});
