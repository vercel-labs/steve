import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { defineInstrumentation } from "eve/instrumentation";

// Portable observability WITHOUT @vercel/otel or the Vercel Agent Runs
// dashboard. We register the vanilla OpenTelemetry Node SDK and export AI SDK
// spans over OTLP/HTTP to a local Jaeger (docker-compose `observability`
// profile). This proves eve's trace data is fully portable.
//
// Disabled unless OTEL_EXPORTER_OTLP_ENDPOINT is set, so the agent runs without
// a tracing backend by default.
export default defineInstrumentation({
  setup({ agentName }) {
    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    if (!endpoint) return;

    const sdk = new NodeSDK({
      resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: agentName }),
      traceExporter: new OTLPTraceExporter({
        url: `${endpoint.replace(/\/$/, "")}/v1/traces`,
      }),
    });
    sdk.start();
  },
});
