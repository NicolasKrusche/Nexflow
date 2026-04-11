# Common Issues and Fixes

This file tracks recurring problems that were resolved during this collaboration, with the exact fix and where it was applied.

## 1) Browse page fork failed

Symptom:
- Forking a program from `/browse` failed with generic errors.

Root cause:
- Forking logic was strict against legacy schema variants and had weak error surfacing.

Fix:
- Hardened fork endpoint logic and schema normalization before validation.
- Added safer connection-name extraction and improved API error responses.
- Improved browse client error parsing to show real server messages.

Files changed:
- `apps/web/app/api/browse/[id]/fork/route.ts`
- `apps/web/app/(app)/browse/browse-client.tsx`

## 2) Runtime token retrieval failed with HTTP 404 and HTML body

Symptom:
- Runtime failed to fetch OAuth token with errors like:
  `Could not retrieve token ... (HTTP 404)`
  and an HTML response body.

Root cause:
- `NEXTJS_INTERNAL_URL` can include a path segment (for example `/browse`), producing invalid internal API URLs.

Fix:
- Runtime now builds endpoint candidates and falls back to origin-only internal routes.
- Added clearer per-attempt error diagnostics for both OAuth token and API key fetches.
- Fallback now triggers on redirects and 404 (`301/302/307/308/404`).

Files changed:
- `apps/runtime/engine/executor.py`

## 3) Loop step failed after empty-email filter

Symptom:
- Run failed at loop node with:
  `Expression 'data['emails']' failed: KeyError: 'emails'`.

Root cause:
- Filter node returned an empty output when condition failed, but the executor still enqueued downstream nodes.
- Loop then ran without expected flat keys.

Fix:
- Filter now returns an explicit marker (`__filtered_out__`) when condition fails.
- Executor checks this marker and does not enqueue downstream nodes for that filtered branch.

Files changed:
- `apps/runtime/engine/executor.py`

## 4) Local startup reliability notes (operational)

Symptom:
- Root `npm run dev` failed in this Windows environment due runtime dev command behavior and process/reload constraints.

Fix applied during session:
- Started services directly (web and runtime) with explicit commands.
- Runtime was run without `--reload` when reload mode caused Windows named-pipe permission failures.

Files changed:
- No persistent code change required for this specific operational workaround.

## 5) Filtered branches showed downstream nodes as pending

Symptom:
- Runs looked like they did not continue after a filter node.
- Upstream nodes were completed, run status was completed, but downstream nodes stayed `pending`.

Root cause:
- When a filter short-circuited (`__filtered_out__`), executor stopped enqueuing that branch but did not update descendant node execution states.

Fix:
- Added branch skip propagation in runtime executor.
- Descendants of a filtered node are now marked `skipped` and completed in `node_executions`.
- This keeps UI state consistent with actual run outcome.

Files changed:
- `apps/runtime/engine/executor.py`

## Quick verification checklist

After pulling these fixes:
1. Start web and runtime.
2. Re-run a previously failing `/browse` fork.
3. Re-run a flow that needs internal token fetch.
4. Re-run the Gmail -> filter -> loop flow with zero emails to confirm it exits cleanly.
5. Verify filtered branches show downstream nodes as `skipped` (not `pending`).
