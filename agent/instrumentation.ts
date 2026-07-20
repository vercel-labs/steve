import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { defineInstrumentation } from "eve/instrumentation";

let sdk: NodeSDK | undefined;

// Any OTLP/HTTP-compatible collector works. The exporter reads the standard
// OTEL_EXPORTER_OTLP_* variables, including endpoint and optional headers.
export default defineInstrumentation({
  recordInputs: process.env.OTEL_RECORD_INPUTS === "true",
  recordOutputs: process.env.OTEL_RECORD_OUTPUTS === "true",
  setup: ({ agentName }) => {
    if (
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
      process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
    ) {
      sdk = new NodeSDK({
        resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: agentName }),
        traceExporter: new OTLPTraceExporter(),
      });
      sdk.start();
    }
  },
});
