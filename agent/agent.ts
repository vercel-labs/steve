import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { defineAgent } from "eve";

// Direct provider model object (NOT a gateway string id). Both branches call
// the provider directly and bypass the Vercel AI Gateway entirely.
// Do not set AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN.
//
// Provider selection (both read their own key directly):
//   - OpenAI by default (gpt-5-mini), reading OPENAI_API_KEY.
//   - Anthropic fallback (claude-sonnet-5) when OPENAI_API_KEY is unset but
//     ANTHROPIC_API_KEY is set, so the demo runs with whichever key you have.
//
// The smaller models keep the reference deployment inexpensive while still
// completing the tool-driven analysis loop reliably.
export default defineAgent({
  model: selectModel(),

  // Bound accidental or adversarial sessions. Eve pauses interactive sessions
  // at these limits and asks the caller whether to continue.
  limits: {
    maxInputTokensPerSession: 200_000,
    maxOutputTokensPerSession: 20_000,
  },

  // Self-hosted durability: back session state, queues, hooks, and streams
  // with the Postgres Workflow world instead of Vercel Workflow.
  // Credentials/options come from WORKFLOW_POSTGRES_URL at runtime.
  experimental: {
    workflow: {
      world: "@workflow/world-postgres",
    },
  },

  // Keep the world package external so graphile-worker and pg remain normal
  // runtime dependencies in the compiled host.
  build: {
    externalDependencies: ["@workflow/world-postgres"],
  },
});

// Prefer OpenAI; fall back to Anthropic when only ANTHROPIC_API_KEY is set.
// If neither key is present, default to OpenAI so the failure surfaces as a
// clear provider auth error rather than a silent misconfiguration.
function selectModel() {
  if (!process.env.OPENAI_API_KEY && process.env.ANTHROPIC_API_KEY) {
    return anthropic("claude-sonnet-5");
  }
  return openai("gpt-5-mini");
}
