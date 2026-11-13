// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@/bootstrap/capabilities/work-item`
 * Purpose: RED's WorkItemCapability over the live Doltgres backlog and the markdown ports.
 * Scope: Capability composition only. The store, not this module, enforces the reason and cites.
 * Invariants:
 *   - PATCH_REASON_AND_CITES (task.0086): the required `reason` and the optional `cites` are forwarded to the Doltgres store, the one enforcer.
 *     The markdown fallback (development only) has no history, so it DROPS both reason and cites; the tool schema still requires a reason.
 *   - MOVES_READ_AT_READ_TIME (story.0033): a read that returns exactly one item (core__work_item_read) adds each move's baseline,
 *     current reading and verdict from `moveReadings`; a list read returns the stored moves only, so a page costs no metric lookup.
 *   - ONE_ITEM_ENVELOPE (task.0118): `read` is the single-item envelope: it also adds each move's metric, KPI and goal (`moveReadings.context`)
 *     and, on request, the first page of citation links (`links`); both through the package's `composeItemEnvelope`; `query` and `queryPage` never do.
 * Side-effects: none
 * @internal
 */

import { isPrivilegedPriority } from "@cogni/knowledge-store";
/** RED's tool capability uses the live backlog and released score/rank contracts. */
import type { WorkItemCapability, WorkItemInfo } from "@cogni/shared-ai-tools";
import { WorkItemPatchConflictError } from "@cogni/shared-ai-tools";
import type {
  WorkItem,
  WorkItemCommandPort,
  WorkItemQueryPort,
  WorkItemsContentPort,
  WorkQuery,
} from "@cogni/work-items";
import type {
  EnvelopeDegradedEvent,
  ItemLinksPort,
  MoveReadingPort,
} from "@cogni/work-items";
import {
  composeItemEnvelope,
  judgeMoveSummaries,
  toWorkItemDto,
  toWorkItemId,
} from "@cogni/work-items";

export interface WorkItemCapabilityDeps {
  readonly workItemQuery: WorkItemQueryPort;
  readonly workItemCommand: WorkItemCommandPort;
  /** Reads the metrics a single item moves; absent means no metrics service (every move reads `unknown`). */
  readonly moveReadings?: MoveReadingPort | undefined;
  /** First page of an item's citation links (`read` with `includeLinks`); absent reads `unavailable`. */
  readonly links?: ItemLinksPort | undefined;
  /** One event per degraded envelope part (chain or links). */
  readonly log?: ((event: EnvelopeDegradedEvent) => void) | undefined;
  readonly backlogReader?: Pick<WorkItemsContentPort, "get" | "list">;
  readonly backlogWriter?: {
    readonly patch: WorkItemsContentPort["patch"];
    readonly principalId: () => string;
  };
}
const toInfo: (item: WorkItem) => WorkItemInfo = toWorkItemDto;

/** The patch `set` without explicit-undefined keys (the route facade drops them the same way). */
const definedOnly = (set: object): object =>
  Object.fromEntries(Object.entries(set).filter(([, v]) => v !== undefined));
export function createWorkItemCapability(
  deps: WorkItemCapabilityDeps
): WorkItemCapability {
  const queryPage: NonNullable<WorkItemCapability["queryPage"]> = async (
    params
  ) => {
    const page = await (deps.backlogReader ?? deps.workItemQuery).list(
      params as WorkQuery
    );
    return {
      items: page.items.map(toInfo),
      ...(page.nextCursor && { nextCursor: page.nextCursor }),
    };
  };
  /** A one-item read gets each move judged from its observations (bounded: at most 3 moves). */
  const withMoveReadings = async (
    items: readonly WorkItemInfo[]
  ): Promise<readonly WorkItemInfo[]> => {
    const only = items.length === 1 ? items[0] : undefined;
    if (!only?.moves?.length) return items;
    return judgeMoveSummaries([only], deps.moveReadings);
  };
  return {
    /**
     * THE single-item envelope (task.0118), the same shape `GET /api/v1/work/items/{id}` serves: the
     * item with each move's readings, verdict and metric → KPI → goal chain, and with `includeLinks`
     * the first page of citation links.
     */
    read: async (id, options) => {
      const page = await (deps.backlogReader ?? deps.workItemQuery).list({
        ids: [toWorkItemId(id)],
        limit: 1,
      });
      const item = page.items.map(toInfo).find((entry) => entry.id === id);
      if (!item) return null;
      // ONE_COMPOSITION: the same `composeItemEnvelope` the HTTP facade calls.
      return composeItemEnvelope(
        item,
        { readings: deps.moveReadings, links: deps.links, log: deps.log },
        { includeLinks: options?.includeLinks === true }
      );
    },
    query: async (params) =>
      withMoveReadings((await queryPage(params)).items),
    queryPage,
    transitionStatus: async (input) => {
      const current = await deps.workItemQuery.get(toWorkItemId(input.id));
      if (!current) throw new Error(`Work item not found: ${input.id}`);
      const updated = await deps.workItemCommand.transitionStatus({
        id: current.id,
        expectedRevision: String(current.revision),
        toStatus: input.toStatus as WorkItem["status"],
        ...(input.reason && { reason: input.reason }),
      });
      return {
        id: updated.id,
        previousStatus: current.status,
        newStatus: updated.status,
        revision: Number(updated.revision),
      };
    },
    patch: async (input) => {
      if (
        input.set.priority != null &&
        isPrivilegedPriority(input.set.priority)
      )
        throw new Error(
          `authz_denied: priority ${input.set.priority} requires node admin — propose it instead`
        );
      if (deps.backlogWriter) {
        const principal = deps.backlogWriter.principalId();
        if (!principal)
          throw new Error("WorkItemCapability: authenticated actor required");
        return toInfo(
          await deps.backlogWriter.patch(
            {
              id: toWorkItemId(input.id),
              ...(input.expectedRevision !== undefined && {
                expectedRevision: input.expectedRevision,
              }),
              reason: input.reason,
              ...(input.cites !== undefined && { cites: input.cites }),
              set: definedOnly(input.set) as Parameters<
                WorkItemsContentPort["patch"]
              >[0]["set"],
            },
            principal
          )
        );
      }
      const current = await deps.workItemQuery.get(toWorkItemId(input.id));
      if (!current) throw new Error(`Work item not found: ${input.id}`);
      if (
        input.expectedRevision !== undefined &&
        input.expectedRevision !== Number(current.revision)
      )
        throw new WorkItemPatchConflictError(
          input.id,
          input.expectedRevision,
          Number(current.revision)
        );
      return toInfo(
        await deps.workItemCommand.patch({
          id: current.id,
          expectedRevision: String(current.revision),
          set: definedOnly(input.set) as NonNullable<
            Parameters<WorkItemCommandPort["patch"]>[0]["set"]
          >,
        })
      );
    },
  };
}
