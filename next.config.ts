import type { NextConfig } from "next";
import { withEve } from "eve/next";

const nextConfig: NextConfig = {
  // Workaround: Turbopack pulls a `node:module` reference into the client
  // chunk through eve/react's module-merging, even though the client code
  // never calls it at runtime. Alias it to a browser-safe stub so the client
  // bundle can be generated. (Upstream eve/Turbopack issue; see _internal.)
  turbopack: {
    resolveAlias: {
      "node:module": "./lib/node-module-stub.js",
    },
  },
};

export default withEve(nextConfig);
