import { defineSandbox } from "eve/sandbox";
import { docker } from "eve/sandbox/docker";
import { MOVIES_CSV } from "./movies";

// Code isolation without Vercel Sandbox.
//
// Model-authored Python runs inside a Docker container, never in the host Node
// process. Pin the multi-architecture image digest so every host gets the same
// Python and Bash environment even after Eve publishes a new `latest` image.
//
// The Docker backend supports only "allow-all" / "deny-all" network policy
// (no domain allow-lists). We lock egress to "deny-all": this analysis agent
// only needs local compute, and deny-all strengthens the isolation proof (the
// container cannot phone home or reach host services).
export default defineSandbox({
  backend: docker({
    image: "ghcr.io/vercel/eve@sha256:18fb75032908d231b65e269fa46034ddcea3d90524d795d2f7e77c4fd4edbe48",
    pullPolicy: "if-not-present",
    networkPolicy: "deny-all",
  }),

  // Seed a small, recognizable movie database into the sandbox at the start of
  // each durable session, so the agent has data to analyze immediately (no need
  // to ask the user to upload anything). The agent reads /workspace/movies.csv.
  async onSession({ use }) {
    const session = await use();
    await session.writeTextFile({
      path: "movies.csv",
      content: MOVIES_CSV,
    });
  },
});
