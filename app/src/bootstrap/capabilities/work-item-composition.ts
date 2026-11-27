// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/** One published composition: versioned content plus PostgreSQL coordination.
 * Deployment requires the parent-owned producer drain/expiry handoff first.
 * Content keeps its bridge lock until old content writers separately drain.
 */
export { withWorkItemLeases as composeWorkItemContent } from "@cogni/work-items";
