import type { NextConfig } from "next";
import { withEve } from "eve/next";

const nextConfig: NextConfig = {
  // The local @open-observe/sdk package ships TypeScript source (its package
  // `main` points at src/index.ts), so Next must transpile it like first-party
  // code. Required because the SDK is linked from a local checkout rather than
  // installed as a prebuilt npm package.
  transpilePackages: ["@open-observe/sdk"],

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
