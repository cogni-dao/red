// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/work/items/route`
 * Purpose: HTTP endpoints for listing and creating work items.
 * Scope: Auth-protected GET (list — markdown ∪ node-local Doltgres) and POST (create — node-local Doltgres only).
 * Invariants: VALIDATE_IO, CONTRACTS_ARE_TRUTH, AUTH_VIA_GETSESSIONUSER, NODE_STORE_IS_LOCAL.
 * Moves (story.0033): POST accepts `moves`; an unknown or deprecated new metric id is HTTP400 `cite_unresolved` at `moves`; a baseline failure is HTTP503 `metric_baseline_unavailable` (`workItemWriteErrorResponse`, @cogni/work-items).
 * Side-effects: IO (HTTP response, filesystem read via port, Doltgres read/write)
 * Links: contracts/work.items.{list,create}.v1.contract
 * @public
 */

import {
  workItemsCreateOperation,
  workItemsListOperation,
} from "@cogni/node-contracts";
import { workItemWriteErrorResponse } from "@cogni/work-items";
import { NextResponse } from "next/server";

import {
  createWorkItem,
  InvalidCursorError,
  listWorkItems,
  WorkItemsBackendNotReadyError,
  WorkItemScoresInvalidError,
  WorkItemWriteOutcomeUnknownError,
  NodeAdminRequiredError,
} from "@/app/_facades/work/items.server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { EVENT_NAMES } from "@/shared/observability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/work/items — List work items with optional query filters.
 *
 * Query params: types, statuses (comma-separated), text, projectId, node (single
 * or comma-separated), limit. Lists span both legacy markdown items and
 * Doltgres-allocated items (≥5000) — their ID ranges are disjoint.
 */
export const GET = wrapRouteHandlerWithLogging(
  { routeId: "work.items.list", auth: { mode: "required", getSessionUser } },
  async (ctx, request) => {
    const url = new URL(request.url);

    const typesParam = url.searchParams.get("types");
    const statusesParam = url.searchParams.get("statuses");
    const textParam = url.searchParams.get("text");
    const actorParam = url.searchParams.get("actor");
    const projectIdParam = url.searchParams.get("projectId");
    const nodeParam = url.searchParams.get("node");
    const limitParam = url.searchParams.get("limit");
    const cursorParam = url.searchParams.get("cursor");

    const input = workItemsListOperation.input.parse({
      types: typesParam ? typesParam.split(",") : undefined,
      statuses: statusesParam ? statusesParam.split(",") : undefined,
      text: textParam ?? undefined,
      actor: actorParam ?? undefined,
      projectId: projectIdParam ?? undefined,
      node: nodeParam
        ? nodeParam.includes(",")
          ? nodeParam.split(",")
          : nodeParam
        : undefined,
      limit: limitParam ? Number(limitParam) : undefined,
      cursor: cursorParam ?? undefined,
    });

    let result: Awaited<ReturnType<typeof listWorkItems>>;
    try {
      result = await listWorkItems(input);
    } catch (e) {
      if (e instanceof InvalidCursorError) {
        return NextResponse.json({ error: "invalid cursor" }, { status: 400 });
      }
      if (e instanceof WorkItemsBackendNotReadyError) {
        return NextResponse.json({ error: e.message }, { status: 503 });
      }
      throw e;
    }

    ctx.log.info({ count: result.items.length }, "work.items.list_success");

    return NextResponse.json(workItemsListOperation.output.parse(result));
  }
);

/**
 * POST /api/v1/work/items — Create a new work item in Doltgres.
 *
 * Server allocates an ID in this node's own store. Author is derived from
 * `getSessionUser` and embedded in
 * the dolt_log commit message (AUTHOR_ATTRIBUTED).
 */
export const POST = wrapRouteHandlerWithLogging(
  { routeId: "work.items.create", auth: { mode: "required", getSessionUser } },
  async (ctx, request, sessionUser) => {
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    // Every refusal ends in ONE registered terminal event with its errorCode (task.0122): ids and codes, never the body.
    const refuse = (
      status: number,
      errorCode: string,
      body: unknown
    ): NextResponse => {
      ctx.log.info(
        {
          event: EVENT_NAMES.WORK_ITEMS_CREATE_REFUSED,
          routeId: "work.items.create",
          outcome: "refused",
          status,
          errorCode,
        },
        EVENT_NAMES.WORK_ITEMS_CREATE_REFUSED
      );
      return NextResponse.json(body, { status });
    };

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return refuse(400, "invalid_json", { error: "invalid JSON body" });
    }

    const parseResult = workItemsCreateOperation.input.safeParse(body);
    if (!parseResult.success) {
      return refuse(400, "invalid_input", {
        error: "invalid input",
        issues: parseResult.error.issues,
      });
    }

    try {
      const created = await createWorkItem(parseResult.data, {
        id: sessionUser.id,
        walletAddress: sessionUser.walletAddress,
      });
      ctx.log.info(
        {
          event: EVENT_NAMES.WORK_ITEMS_CREATE_SUCCESS,
          routeId: "work.items.create",
          outcome: "success",
          status: 201,
          workItemId: created.id,
          node: created.node,
        },
        EVENT_NAMES.WORK_ITEMS_CREATE_SUCCESS
      );
      return NextResponse.json(workItemsCreateOperation.output.parse(created), {
        status: 201,
      });
    } catch (e) {
      if (e instanceof NodeAdminRequiredError) {
        return refuse(e.status, e.errorCode, {
          error: e.message,
          errorCode: e.errorCode,
          action: e.action,
        });
      }
      if (e instanceof WorkItemWriteOutcomeUnknownError)
        return refuse(500, e.code, {
          error: e.message,
          errorCode: e.code,
          retryable: false,
          receipt: e.receipt,
          operationId: e.operationId,
          branch: e.branch,
          commitHash: e.commitHash ?? null,
          itemId: e.itemId ?? null,
        });
      if (e instanceof WorkItemScoresInvalidError)
        return refuse(400, e.code, {
          error: "invalid input",
          errorCode: e.code,
          issues: e.issues,
        });
      if (e instanceof WorkItemsBackendNotReadyError) {
        return refuse(503, "backend_unavailable", { error: e.message });
      }
      if ((e as Error)?.name === "WorkItemAlreadyExistsError") {
        return refuse(409, "already_exists", { error: (e as Error).message });
      }
      // The package owns the moves answers (unknown metric, bad list, unsupported, resolver and baseline failures).
      const mapped = workItemWriteErrorResponse(e, "create");
      if (mapped) return refuse(mapped.status, mapped.errorCode, mapped.body);
      throw e;
    }
  }
);
