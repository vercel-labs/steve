import type { NextConfig } from "next";
import { withEve } from "eve/next";

const nextConfig: NextConfig = {
  transpilePackages: ["@open-observe/sdk"],
};

export default withEve(nextConfig);
