# CRM / Product Structure Gap Analysis

## The three surfaces (current)

| Surface | Code | State |
|---|---|---|
| Website / marketing | `BTLbroLanding (1).jsx` | ✅ Full static landing, no API calls |
| Webapp (lead capture) | `MarketingTool.jsx` → `QuickCheckout.jsx` / `CustomerForm.jsx` | 🟡 Working ordering + booking |
| CRM (internal team) | `AdminPanel.jsx` → Orders tab | 🔴 Not a real lead pipeline |

## Core problem

One concept — `orders` — plays **two roles** today:
1. **Webapp** creates an order (lead capture).
2. **Admin** re-tags it through a flat status: `pending → accepted → processed → paid`.

There is no separation between "a lead we're working" and "a won/paid job." It cannot support a real sales workflow.

## Concrete gaps (why it's not ready for every scenario)

1. **No lead lifecycle / stages.**
   Real CRM stages: `new → qualified → proposal → won / lost → job → billed`.
   Today only a flat status dropdown exists. No qualification, no won/lost, no "why lost."

2. **No follow-up / activity log.**
   No notes, calls, emails, reminders. The team can only flip a status, not *work* a lead.

3. **No ownership / assignment.**
   No per-salesperson assignment or pipeline-by-owner.

4. **No source tracking.**
   A lead from MarketingTool vs. CustomerForm vs. a manual walk-in is indistinguishable.

5. **No lead/revenue split.**
   `pending` leads and `paid` orders are the same record — can't report "pipeline" vs. "won revenue."

## Lazy recommended path (not a rewrite)

Architecture is sound — keep db.json, keep the API, keep the webapp untouched. Just promote `orders` into a proper CRM entity:

- Add fields on the order record: `stage`, `ownerId`, `notes[]`, `activities[]`, `source`, `value`.
- Map stages: `new → qualified → proposal → won` (won = the paid order) / `lost`.
- Convert AdminPanel's Orders tab into a stage pipeline (kanban/stages) — keep detail + edit.
- Webapp writes unchanged (creates `new` leads / `won` orders).

Because it's a JSON DB, this is additive fields on existing records — no migration pain.

## When to revisit

- Add the pipeline once the team is actively working multiple leads per day (beyond 1–2 people flipping statuses manually).
- Add team/assignment once >1 salesperson needs to own leads.
