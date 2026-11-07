# goals

Red's Goals and KPI presentation. The measurement engine and wire contract (`GoalsProgressSchema`, `KpiAssessmentSchema`, `MetricHistorySchema`, `MetricDisplaySchema`) live in the published `@cogni-dao/metrics/contracts`; this feature only reads and renders them. Goals themselves come from red's own Dolt hub.

## UI invariants

- **Status only from `assessKpi`.** The read model carries each KPI's assessment; the UI never re-derives, estimates or ranks a status. Every status shows a symbol and a word (`STATUS_META`); color is redundant.
- **Unknown is "—", never 0.** No reading renders "—" (`aria-label="No reading"`); delayed and failing values are muted.
- **Gaps stay gaps.** Charts use `connectNulls={false}`; never bridge missing history or invent expected values, and never present stale readings as current.
- **Display comes from the read model** (`kpi.metric.display`). The UI never guesses a display type from units; adding or refining a metric or binding changes the board with no UI change.
- `GoalsBoard` is mounted on `/knowledge?mode=goals` (30s poll only while that tab is selected) and on goal entry pages with `goalId`.
- This feature must not import bootstrap, app or adapter code. The UI only reads; the worker refresh schedule computes.
