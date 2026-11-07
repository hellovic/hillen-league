import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "./worker.mjs";

const saturdayCheck = { scheduledTime: Date.parse("2026-11-07T01:25:00Z") };
const env = { GITHUB_ACTIONS_TOKEN: "test-token" };

test("dispatches for Saturday's 09:05 HKT slot when it has no run", async (t) => {
  const request = t.mock.method(globalThis, "fetch", async (url, options) => {
    const endpoint = new URL(url);
    if (endpoint.pathname.endsWith("/runs")) {
      assert.equal(endpoint.searchParams.get("branch"), "main");
      assert.equal(endpoint.searchParams.get("created"), ">=2026-11-07T01:05:00.000Z");
      return Response.json({ workflow_runs: [] });
    }
    assert.equal(endpoint.pathname, "/repos/hellovic/hillen-league/actions/workflows/refresh.yml/dispatches");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.Authorization, "Bearer test-token");
    assert.deepEqual(JSON.parse(options.body), {
      ref: "main",
      inputs: { scheduled_slot: "2026-11-07T01:05:00.000Z" },
    });
    return Response.json({ workflow_run_id: 100 });
  });
  await worker.scheduled(saturdayCheck, env);
  assert.equal(request.mock.callCount(), 2);
});

for (const run of [
  { id: 100, status: "queued", conclusion: null },
  { id: 101, status: "in_progress", conclusion: null },
  { id: 102, status: "completed", conclusion: "success" },
]) {
  test(`skips dispatch when a run is ${run.conclusion ?? run.status}`, async (t) => {
    const request = t.mock.method(globalThis, "fetch", async () => Response.json({ workflow_runs: [run] }));
    await worker.scheduled(saturdayCheck, env);
    assert.equal(request.mock.callCount(), 1);
  });
}

test("dispatches when the only run in the slot failed", async (t) => {
  const request = t.mock.method(globalThis, "fetch", async (url) => url.endsWith("/dispatches")
    ? new Response(null, { status: 204 })
    : Response.json({ workflow_runs: [{ id: 100, status: "completed", conclusion: "failure" }] }));
  await worker.scheduled(saturdayCheck, env);
  assert.equal(request.mock.callCount(), 2);
});

test("fails without dispatching when GitHub cannot list runs", async (t) => {
  const request = t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 503 }));
  await assert.rejects(worker.scheduled(saturdayCheck, env), /Could not list refresh runs \(GitHub HTTP 503\)/);
  assert.equal(request.mock.callCount(), 1);
});

test("reports a rejected dispatch", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => url.endsWith("/dispatches")
    ? new Response(null, { status: 403 })
    : Response.json({ workflow_runs: [] }));
  await assert.rejects(worker.scheduled(saturdayCheck, env), /Could not dispatch the refresh \(GitHub HTTP 403\)/);
});
