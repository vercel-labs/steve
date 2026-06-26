import type { NextConfig } from "next";
import { withEve } from "eve/next";

const nextConfig: NextConfig = {
  // @open-observe/sdk ships raw TS (unpublished local link:), so transpile it if
  // anything in the Next app ever imports it. The agent's own OpenObserve path
  // is a code toggle in agent/instrumentation.ts (committed OFF); the UI does
  // not import the SDK today, so this is a harmless safeguard.
  transpilePackages: ["@open-observe/sdk"],
};

export default withEve(nextConfig);
