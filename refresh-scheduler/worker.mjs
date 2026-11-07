const workflow = "https://api.github.com/repos/hellovic/hillen-league/actions/workflows/refresh.yml";
const branch = "main";
const graceMs = 20 * 60 * 1000;

export default {
  async scheduled({ scheduledTime }, env) {
    if (!env.GITHUB_ACTIONS_TOKEN) {
      throw new Error("Missing GITHUB_ACTIONS_TOKEN secret");
    }

    const slot = new Date(scheduledTime - graceMs).toISOString();
    const headers = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.GITHUB_ACTIONS_TOKEN}`,
      "User-Agent": "Hillen-League-Refresh-Fallback",
      "X-GitHub-Api-Version": "2026-03-10",
    };
    const params = new URLSearchParams({ branch, created: `>=${slot}`, per_page: "20" });
    const runs = await fetch(`${workflow}/runs?${params}`, {
      headers,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (!runs.ok) {
      throw new Error(`Could not list refresh runs (GitHub HTTP ${runs.status})`);
    }

    const { workflow_runs } = await runs.json();
    const covered = workflow_runs.find((run) => run.status !== "completed" || run.conclusion === "success");
    if (covered) {
      console.log(JSON.stringify({ action: "skip", slot, runId: covered.id, status: covered.status }));
      return;
    }

    const dispatch = await fetch(`${workflow}/dispatches`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ ref: branch, inputs: { scheduled_slot: slot } }),
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (!dispatch.ok) {
      throw new Error(`Could not dispatch the refresh (GitHub HTTP ${dispatch.status})`);
    }

    const result = dispatch.status === 204 ? {} : await dispatch.json();
    console.log(JSON.stringify({ action: "dispatch", slot, runId: result.workflow_run_id }));
  },
};
