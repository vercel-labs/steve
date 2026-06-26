import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { observe } from "@open-observe/sdk";
import { defineInstrumentation } from "eve/instrumentation";

// Observability with two interchangeable backends, selected purely by env so
// the same code runs locally and in production with no edits:
//
//   1. Observe SDK -> local dashboard (dev default). Active when
//      OPEN_OBSERVE_OTLP_ENDPOINT is set. observe(...) registers its own OTel
//      providers, captures traces + logs + metrics, installs the AI SDK /
//      Workflow / Sandbox adapters, and ships everything to the local Observe
//      dashboard's OTLP ingest. Run it from the openobserve checkout:
//        pnpm --filter @open-observe/dashboard dev
//      then open http://localhost:3001/p/<projectId>.
//
//   2. Vanilla OTel -> self-hosted Jaeger (production). Active when
//      OPEN_OBSERVE_OTLP_ENDPOINT is unset and OTEL_EXPORTER_OTLP_ENDPOINT is
//      set (e.g. http://localhost:4318). Exports eve's AI SDK trace spans
//      (ai.eve.turn -> ai.streamText -> ai.toolCall) over OTLP/HTTP to Jaeger.
//      This is the deployed droplet's path; the deploy sets the OTEL endpoint
//      and leaves OPEN_OBSERVE_OTLP_ENDPOINT unset.
//
// If neither is configured, telemetry export is disabled and the agent runs
// normally (fail-open). The two backends are mutually exclusive: OpenObserve
// wins when its endpoint is set, so a dev box never accidentally double-exports.
export default defineInstrumentation({
  setup: async ({ agentName }) => {
    const openObserveEndpoint = process.env.OPEN_OBSERVE_OTLP_ENDPOINT;
    if (openObserveEndpoint) {
      await observe({
        serviceName: agentName,
        projectId: process.env.OPEN_OBSERVE_PROJECT_ID ?? "steve",
        otlp: {
          traces: { endpoint: openObserveEndpoint },
          logs: { endpoint: openObserveEndpoint },
          metrics: { endpoint: openObserveEndpoint, exportIntervalMillis: 5000 },
        },
      });
      return;
    }

    const jaegerEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    if (jaegerEndpoint) {
      const sdk = new NodeSDK({
        resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: agentName }),
        traceExporter: new OTLPTraceExporter({
          url: `${jaegerEndpoint.replace(/\/$/, "")}/v1/traces`,
        }),
      });
      sdk.start();
    }
  },
});
