import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { defineInstrumentation } from "eve/instrumentation";

// Portable observability WITHOUT @vercel/otel or the Vercel Agent Runs
// dashboard. Registers the vanilla OpenTelemetry Node SDK and exports eve's AI
// SDK trace spans (ai.eve.turn -> ai.streamText -> ai.toolCall) over OTLP/HTTP.
//
// Two supported destinations, in precedence order; if neither is configured,
// telemetry export is disabled and the agent runs normally (fail-open):
//
//   1. Axiom (https://axiom.co) — set AXIOM_TOKEN (+ optional AXIOM_DATASET,
//      AXIOM_DOMAIN). Traces go to https://<domain>/v1/traces with the Axiom
//      auth + dataset headers.
//   2. Generic OTLP/HTTP — set OTEL_EXPORTER_OTLP_ENDPOINT (e.g. local Jaeger
//      at http://localhost:4318). Traces go to <endpoint>/v1/traces.
//
// Console logs (stdout/stderr) are shipped to Axiom separately by Vector; see
// vector.toml and docker-compose.yml. eve emits no OTel logs signal, so logs
// are collected at the process level, not here.
export default defineInstrumentation({
  setup({ agentName }) {
    const exporter = resolveTraceExporter();
    if (!exporter) return;

    const sdk = new NodeSDK({
      resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: agentName }),
      traceExporter: exporter,
    });
    sdk.start();
  },
});

function resolveTraceExporter(): OTLPTraceExporter | undefined {
  const axiomToken = process.env.AXIOM_TOKEN;
  if (axiomToken) {
    const domain = process.env.AXIOM_DOMAIN ?? "api.axiom.co";
    const dataset = process.env.AXIOM_DATASET ?? "steve";
    return new OTLPTraceExporter({
      url: `https://${domain}/v1/traces`,
      headers: {
        Authorization: `Bearer ${axiomToken}`,
        "X-Axiom-Dataset": dataset,
      },
    });
  }

  const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (otlpEndpoint) {
    return new OTLPTraceExporter({
      url: `${otlpEndpoint.replace(/\/$/, "")}/v1/traces`,
    });
  }

  return undefined;
}
