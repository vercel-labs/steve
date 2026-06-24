import { defineSandbox } from "eve/sandbox";
import { docker } from "eve/sandbox/docker";
import { MOVIES_CSV } from "./movies";

// Code isolation without Vercel Sandbox.
//
// Every line of model-generated code runs inside a Docker container, never in
// the host Node process. The default image `ghcr.io/vercel/eve:latest` ships
// a Python runtime, so `run_python` works out of the box.
//
// The Docker backend supports only "allow-all" / "deny-all" network policy
// (no domain allow-lists). We lock egress to "deny-all": this analysis agent
// only needs local compute, and deny-all strengthens the isolation proof (the
// container cannot phone home or reach host services).
//
// NOTE: the policy is set on the factory rather than in onSession's use()
// because of a type-declaration bug in eve 0.13.3 where docker() drops its
// session-use option types (see _internal/ISSUES.md). The factory is correctly
// typed and applies the policy at container creation.
export default defineSandbox({
  backend: docker({
    image: "ghcr.io/vercel/eve:latest",
    pullPolicy: "if-not-present",
    networkPolicy: "deny-all",
  }),

  // Seed a small, recognizable movie database into the sandbox at the start of
  // every session, so the agent has real data to analyze immediately (no need
  // to ask the user to upload anything). The agent reads /workspace/movies.csv.
  async onSession({ use }) {
    const session = await use();
    await session.writeTextFile({
      path: "movies.csv",
      content: MOVIES_CSV,
    });
  },
});
