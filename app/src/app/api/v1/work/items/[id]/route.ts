// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/work/items/[id]/route`
 * Purpose: HTTP endpoints for getting, patching, and retiring deletion of a single work item by ID.
 * Scope: Auth-protected GET (node-local Doltgres first, markdown fallback), PATCH (Doltgres only), and DELETE (authenticated HTTP 410).
 * Invariants: VALIDATE_IO, CONTRACTS_ARE_TRUTH, AUTH_VIA_GETSESSIONUSER, PATCH_ALLOWLIST, CANCELLATION_PRESERVES_HISTORY.
 * Write errors (bug.0063): `handleWorkItemPatch` from @cogni/work-items parses, answers every write-contract error and returns the one terminal event; this route keeps only auth, the actor, 403, 404, node-admin and backend-unavailable.
 * Moves (story.0033): `set.moves` with an unknown or deprecated metric id is HTTP400 `cite_unresolved` with an issue at `set.moves`; a bad list is HTTP400 `invalid input`; a non-empty list with no metric wiring is HTTP400 `moves_unsupported`; a resolver failure is HTTP503 `cite_resolver_unavailable`; a baseline failure is HTTP503 `metric_baseline_unavailable`. The client never sets a baseline: the server pins it. `workItemWriteErrorResponse` (@cogni/work-items) answers these.
 * Envelope (task.0118): GET returns each `moves` entry with its metric, KPI and goal; `?include=links,artifacts,history` adds the first page of citation links and of artifact and history refs, `?artifact=<id>` one artifact in full; an unknown include is HTTP400.
 * Read core (story.0085): `handleWorkItemGet` from @cogni/work-items parses `include`/`artifact`, refuses 400/404 and returns the one
 *   terminal event; this route keeps only auth and the store read.
 * Side-effects: IO (HTTP response, filesystem read via port, Doltgres read/write/delete)
 * Links: contracts/work.items.{get,patch,delete}.v1.contract
 * @public
 */

import {
  workItemsGetOperation,
  workItemsPatchOperation,
} from "@cogni/node-contracts";
import {
	handleWorkItemGet,
	handleWorkItemPatch,
	routeAttribution,
} from "@cogni/work-items";
import { NextResponse } from "next/server";

import {
  getWorkItem,
  patchWorkItem,
  WorkItemForbiddenError,
  WorkItemNotFoundError,
  NodeAdminRequiredError,
} from "@/app/_facades/work/items.server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/work/items/:id — Get a single work item by ID from node-local
 * Doltgres, falling back to the legacy markdown port when not imported.
 */
export const GET = wrapRouteHandlerWithLogging<{
  params: Promise<{ id: string }>;
}>(
  { routeId: "work.items.get", auth: { mode: "required", getSessionUser } },
  async (ctx, request, _sessionUser, context) => {
    if (!context) throw new Error("context required for dynamic routes");
    const { id } = await context.params;

    // The package owns the `include`/`artifact` parse, the 400/404/503/499 refusals and the one terminal event (story.0085).
    const result = await handleWorkItemGet(id, {
      searchParams: new URL(request.url).searchParams,
      signal: request.signal,
      read: (itemId, options) =>
        getWorkItem(itemId, { signal: request.signal, ...options }),
      toBody: (item) => workItemsGetOperation.output.parse(item),
    });
    ctx.log.info(result.event, result.event.event);
    return NextResponse.json(result.body, { status: result.status });
  }
);

/**
 * PATCH /api/v1/work/items/:id — Patch a work item (Doltgres only).
 *
 * The immutable authenticated principal must match the creator stamped when
 * the row was inserted. The path id remains authoritative over request data.
 */
export const PATCH = wrapRouteHandlerWithLogging<{
  params: Promise<{ id: string }>;
}>(
  { routeId: "work.items.patch", sameDoor: "core__work_item_update", auth: { mode: "required", getSessionUser } },
  async (ctx, request, sessionUser, context) => {
    if (!context) throw new Error("context required for dynamic routes");
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    // The package owns parse, refusals and the one terminal event (bug.0063); this route keeps auth, the actor and node errors.
    const attribution = routeAttribution(sessionUser.id);
    const result = await handleWorkItemPatch(id, {
      readJson: () => request.json(),
      parse: (body) => workItemsPatchOperation.input.safeParse(body),
      write: (input) =>
        patchWorkItem(
          input,
          {
            id: sessionUser.id,
            walletAddress: sessionUser.walletAddress,
          },
          attribution
        ),
      attribution,
      toBody: (patched) => workItemsPatchOperation.output.parse(patched),
      mapNodeError: (e) => {
        if (e instanceof WorkItemNotFoundError)
          return {
            status: 404,
            errorCode: "not_found",
            body: { error: e.message },
          };
        if (e instanceof WorkItemForbiddenError)
          return {
            status: 403,
            errorCode: "forbidden",
            body: { error: e.message },
          };
        if (e instanceof NodeAdminRequiredError)
          return {
            status: e.status,
            errorCode: e.errorCode,
            body: { error: e.message, errorCode: e.errorCode, action: e.action },
          };
        return undefined;
      },
    });
    ctx.log.info(result.event, result.event.event);
    return NextResponse.json(result.body, { status: result.status });
  }
);

/** Authenticated tombstone. Cancellation uses PATCH with reason and expectedRevision. */
export const DELETE = wrapRouteHandlerWithLogging<{
  params: Promise<{ id: string }>;
}>(
  {
    routeId: "work.items.delete",
    // This handler always refuses; it reads and writes no item and grants no capability.
    bearerWrite: "Retired endpoint: fixed HTTP 410 response only; no mutation",
    auth: { mode: "required", getSessionUser },
  },
  async (_ctx, _request, _sessionUser, _context) =>
    NextResponse.json(
      {
        error: "work_item_delete_removed",
        message: "Work items cannot be deleted. Read the current revision, then PATCH with reason, expectedRevision and set.status=cancelled; history and artifacts are retained.",
      },
      { status: 410, headers: { "cache-control": "no-store" } }
    )
);
