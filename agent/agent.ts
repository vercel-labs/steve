import { openai } from "@ai-sdk/openai";
import { defineAgent } from "eve";

// Direct provider model object (NOT a gateway string id).
// This bypasses the Vercel AI Gateway entirely and reads OPENAI_API_KEY.
// Do not set AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN.
//
// gpt-5-mini is deliberately chosen: it is cheap enough for others to run the
// proofs themselves, yet reliably completes the multi-step tool loop (generate
// -> analyze -> summarize) with correct, sandbox-computed numbers. gpt-5.1 also
// works (in fewer steps); gpt-5-nano is cheaper but less reliable at the
// multi-step tool orchestration this demo needs.
export default defineAgent({
  model: openai("gpt-5-mini"),

  // Self-hosted durability: back session state, queues, hooks, and streams
  // with the Postgres Workflow world instead of Vercel Workflow.
  // eve resolves this package's `createWorld()` export and calls `start()`
  // automatically on host init (verified in eve 0.13.3 configure-world).
  // Credentials/options come from env (WORKFLOW_POSTGRES_URL), not here.
  experimental: {
    workflow: {
      world: "@workflow/world-postgres",
    },
  },

  // Keep the world package external in compiled output so its runtime
  // (graphile-worker, pg) is traced into the host bundle rather than inlined.
  build: {
    externalDependencies: ["@workflow/world-postgres"],
  },
});
