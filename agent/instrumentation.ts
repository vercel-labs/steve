import { observe } from "@open-observe/sdk";
import { defineInstrumentation } from "eve/instrumentation";

// Local-first observability via the Observe SDK (@open-observe/sdk), replacing
// the previous vanilla-OTel -> Jaeger pipeline. `observe(...)` registers its
// own OpenTelemetry providers and OTLP exporters, captures console logs, and
// installs the AI SDK / Workflow / Sandbox adapters, then ships traces, logs,
// and metrics to the local Observe dashboard over OTLP/HTTP.
//
// Run the dashboard alongside this agent:
//   pnpm --filter @open-observe/dashboard dev   (in the openobserve checkout)
// then open http://localhost:3001/p/<projectId> to inspect sessions, traces,
// logs, and metrics.
//
// Fail-open: if no endpoint is configured the agent still runs. The default
// endpoint targets the dashboard's local OTLP ingest at http://localhost:3001.
export default defineInstrumentation({
  setup: async ({ agentName }) => {
    const endpoint =
      process.env.OPEN_OBSERVE_OTLP_ENDPOINT ?? "http://localhost:3001";

    await observe({
      serviceName: agentName,
      projectId: process.env.OPEN_OBSERVE_PROJECT_ID ?? "steve",
      otlp: {
        traces: { endpoint },
        logs: { endpoint },
        metrics: { endpoint, exportIntervalMillis: 5000 },
      },
    });
  },
});
