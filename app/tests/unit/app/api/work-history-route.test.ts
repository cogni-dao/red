// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/** History route against the released history reader, with only the store stubbed. */
import { HistoryOutputSchema, HistoryRefsPageSchema } from "@cogni/work-items";
import { expect, it, vi } from "vitest";

vi.mock("@/bootstrap/http", () => ({
  wrapRouteHandlerWithLogging: (_options: unknown, handler: unknown) => handler,
}));
vi.mock("@/app/_lib/auth/session", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/bootstrap/container", () => ({ getContainer: vi.fn() }));

import { GET } from "@/app/api/v1/work/items/[id]/history/route";
import { getContainer } from "@/bootstrap/container";

type Handler = (
  ctx: unknown,
  request: Request,
  user: unknown,
  context: unknown,
) => Promise<Response>;

it("serves the first and older refs pages and preserves legacy history", async () => {
  const entries = Array.from({ length: 21 }, (_, i) => ({
    version: String(21 - i),
    commit: (21 - i).toString(16).padStart(32, "0"),
    at: "2026-11-01T00:00:00.000Z",
    actor: null,
    reason: "Change",
    cites: [],
    changed: ["title"],
    diff: { title: { before: "old", after: "new", truncated: false } },
  }));
  const historyPage = vi.fn(
    async (_id: string, options: { cursor?: string; limit: number }) => {
      const start = options.cursor
        ? entries.findIndex((e) => e.commit === options.cursor) + 1
        : 0;
      const page = entries.slice(start, start + options.limit);
      return {
        entries: page,
        nextCursor:
          start + options.limit < entries.length ? page.at(-1)?.commit : null,
      };
    },
  );
  vi.mocked(getContainer).mockReturnValue({
    doltgresWorkItems: {
      get: vi.fn().mockResolvedValue({}),
      history: vi.fn().mockResolvedValue(entries),
      historyPage,
    },
  } as never);
  const get = (query: string) =>
    (GET as unknown as Handler)(
      { log: { info: vi.fn(), warn: vi.fn() }, reqId: "req", routeId: "test" },
      new Request(
        `http://localhost/api/v1/work/items/task.0199/history${query}`,
      ),
      { id: "user" },
      { params: Promise.resolve({ id: "task.0199" }) },
    );
  const first = await get("?view=refs");
  expect(first.status).toBe(200);
  const firstPage = HistoryRefsPageSchema.parse(await first.json());
  expect(firstPage.refs).toHaveLength(20);
  expect(firstPage.refs[0]).not.toHaveProperty("diff");
  expect(firstPage.nextCursor).toBe(entries[19]?.commit);
  const older = await get(`?view=refs&cursor=${firstPage.nextCursor}`);
  expect(older.status).toBe(200);
  const olderPage = HistoryRefsPageSchema.parse(await older.json());
  expect(olderPage.refs.map((ref) => ref.commit)).toEqual([
    entries[20]?.commit,
  ]);
  expect(olderPage.nextCursor).toBeNull();
  expect(historyPage).toHaveBeenLastCalledWith("task.0199", {
    cursor: firstPage.nextCursor,
    limit: 20,
  });
  const legacy = await get("");
  expect(legacy.status).toBe(200);
  expect(HistoryOutputSchema.parse(await legacy.json()).items).toEqual(entries);
});
