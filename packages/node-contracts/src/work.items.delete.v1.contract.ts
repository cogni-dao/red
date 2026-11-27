// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/work.items.delete.v1.contract`
 * Purpose: Tombstone contract for the removed work-item DELETE API.
 * Scope: Provides Zod schema and types for work item delete wire format. Does not contain business logic.
 * Invariants:
 *   - Contract remains stable; breaking changes require new version
 *   - All consumers use z.infer types
 *   - NO_MUTATION: cancel with a reasoned, revision-bound PATCH instead
 *   - AUTHOR_ATTRIBUTED: author handle embedded in the dolt_log commit message
 * Side-effects: none
 * Links: /api/v1/work/items/[id] route, https://github.com/cogni-dao/cogni/blob/2321821e61dd12aa0cf75d235bd668ff65739109/docs/spec/work-items-port.md
 * @internal
 */

import { z } from "zod";

export const workItemsDeleteOperation = {
  id: "work.items.delete.v1",
  summary: "Work-item deletion is retired",
  description:
    "Returns HTTP 410. Read the current revision, then PATCH with reason, expectedRevision and set.status=cancelled. History and artifacts are retained.",
  input: z.object({
    id: z.string(),
  }),
  output: z.object({
    error: z.literal("work_item_delete_removed"),
    message: z.string(),
  }),
} as const;

export type WorkItemsDeleteInput = z.infer<
  typeof workItemsDeleteOperation.input
>;
export type WorkItemsDeleteOutput = z.infer<
  typeof workItemsDeleteOperation.output
>;
