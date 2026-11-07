import { bindings, defineConfig, triggers } from "cf/config";

export default defineConfig({
  worker: {
    name: "hillen-league-refresh-fallback",
    entrypoint: "./worker.mjs",
    compatibilityDate: "2026-11-07",
    workersDev: false,
    previewUrls: false,
    env: {
      GITHUB_ACTIONS_TOKEN: bindings.secret(),
    },
    observability: {
      enabled: true,
      logs: { enabled: true },
      traces: { enabled: true },
    },
    // Each check is 20 minutes after its matching slot in refresh.yml.
    triggers: [
      triggers.scheduled({ schedule: "25 0 * * MON-FRI" }),
      triggers.scheduled({ schedule: "55 2 * * MON-FRI" }),
      triggers.scheduled({ schedule: "25 1,3,5,7,10,13,15 * * SAT,SUN" }),
    ],
  },
});
