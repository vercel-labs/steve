import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { defineAgent } from "eve";

// Direct provider model object (NOT a gateway string id). Both branches call
// the provider directly and bypass the Vercel AI Gateway entirely.
// Do not set AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN.
//
// Provider selection (both read their own key directly):
//   - OpenAI by default (gpt-5-mini), reading OPENAI_API_KEY.
//   - Anthropic fallback (claude-haiku-4-5) when OPENAI_API_KEY is unset but
//     ANTHROPIC_API_KEY is set, so the demo runs with whichever key you have.
//
// The cheap models are deliberate: both reliably complete the multi-step tool
// loop (generate -> analyze -> summarize) with correct, sandbox-computed
// numbers, while staying inexpensive for others to run the proofs themselves.
export default defineAgent({
  model: selectModel(),

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

// Prefer OpenAI; fall back to Anthropic when only ANTHROPIC_API_KEY is set.
// If neither key is present, default to OpenAI so the failure surfaces as a
// clear provider auth error rather than a silent misconfiguration.
function selectModel() {
  if (!process.env.OPENAI_API_KEY && process.env.ANTHROPIC_API_KEY) {
    return anthropic("claude-haiku-4-5");
  }
  return openai("gpt-5-mini");
}
