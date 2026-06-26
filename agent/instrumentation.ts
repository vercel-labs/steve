import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { defineInstrumentation } from "eve/instrumentation";

// `@open-observe/sdk` is only used for the LOCAL OpenObserve backend. It is a
// `link:` dependency to a local checkout, so it is NOT present in production
// (the droplet uses Jaeger). Import it lazily and only on the OpenObserve
// branch so the built server (`eve start`) never tries to resolve it in prod.
// The import is also guarded so a missing module fails open rather than
// crashing the host. The spelled-out specifier in a variable keeps bundlers /
// type-checkers from eagerly resolving it at build time on machines that don't
// have the linked package.
const OPEN_OBSERVE_SDK_MODULE = "@open-observe/sdk";

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
      try {
        const mod: { observe: (opts: unknown) => Promise<unknown> } =
          await import(/* @vite-ignore */ OPEN_OBSERVE_SDK_MODULE);
        await mod.observe({
          serviceName: agentName,
          projectId: process.env.OPEN_OBSERVE_PROJECT_ID ?? "steve",
          otlp: {
            traces: { endpoint: openObserveEndpoint },
            logs: { endpoint: openObserveEndpoint },
            metrics: { endpoint: openObserveEndpoint, exportIntervalMillis: 5000 },
          },
        });
      } catch (err) {
        // Fail open: if the optional Observe SDK isn't installed, log and fall
        // through to the Jaeger/OTLP branch (or no-op) rather than crashing.
        console.warn(
          "[steve] OPEN_OBSERVE_OTLP_ENDPOINT is set but @open-observe/sdk could not be loaded; skipping OpenObserve:",
          err instanceof Error ? err.message : err,
        );
      }
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
