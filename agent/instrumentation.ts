import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { defineInstrumentation } from "eve/instrumentation";

// ───────────────────────────────────────────────────────────────────────────
// LOCAL OpenObserve toggle.
//
// `@open-observe/sdk` is a `link:` dependency to a local checkout and is NOT
// published to npm, so it is NOT present in production (the droplet uses Jaeger).
// It also ships raw TS, so it only loads when transpiled by eve's dev loader /
// the bundler — a plain `eve start` / `next build` on a box without the linked
// package would fail to resolve it.
//
// To use OpenObserve LOCALLY:
//   1. Comment out the committed `const resolveObserve = () => undefined;` line.
//   2. Uncomment the `import { observe }` + the `resolveObserve = ... observe`
//      lines just below it.
// Then set OPEN_OBSERVE_OTLP_ENDPOINT in .env. Reverse both to return to the
// committed (prod-safe) default, which never references the unpublished SDK.

type ObserveFn = (opts: unknown) => Promise<unknown>;

// --- PROD-SAFE DEFAULT (committed): OpenObserve disabled --------------------
const resolveObserve = (): ObserveFn | undefined => undefined;

// --- LOCAL OpenObserve (uncomment the import + swap resolveObserve below) ---
// import { observe } from "@open-observe/sdk";
// const resolveObserve = (): ObserveFn | undefined => observe as unknown as ObserveFn;
// ───────────────────────────────────────────────────────────────────────────

const OBSERVE: ObserveFn | undefined = resolveObserve();

// Observability with two interchangeable backends. Jaeger is env-only; the
// OpenObserve path additionally requires the import toggle above (since its SDK
// is an unpublished local link:). The committed default is Jaeger-or-nothing:
//
//   1. Observe SDK -> local dashboard. Active when the `observe` import above is
//      uncommented AND OPEN_OBSERVE_OTLP_ENDPOINT is set. observe(...) registers
//      its own OTel providers, captures traces + logs + metrics, installs the
//      AI SDK / Workflow / Sandbox adapters, and ships everything to the local
//      Observe dashboard's OTLP ingest. Run it from the openobserve checkout:
//        pnpm --filter @open-observe/dashboard dev
//      then open http://localhost:3001/p/<projectId>.
//
//   2. Vanilla OTel -> self-hosted Jaeger (production). Active when the
//      OpenObserve path is not taken and OTEL_EXPORTER_OTLP_ENDPOINT is set
//      (e.g. http://localhost:4318). Exports eve's AI SDK trace spans
//      (ai.eve.turn -> ai.streamText -> ai.toolCall) over OTLP/HTTP to Jaeger.
//      This is the deployed droplet's path; the deploy sets the OTEL endpoint
//      and leaves OPEN_OBSERVE_OTLP_ENDPOINT unset.
//
// If neither is configured, telemetry export is disabled and the agent runs
// normally (fail-open). The two backends are mutually exclusive: OpenObserve
// wins when available, so a dev box never accidentally double-exports.
export default defineInstrumentation({
  setup: async ({ agentName }) => {
    const openObserveEndpoint = process.env.OPEN_OBSERVE_OTLP_ENDPOINT;
    if (OBSERVE && openObserveEndpoint) {
      await OBSERVE({
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
