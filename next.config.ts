import type { NextConfig } from "next";
import { withEve } from "eve/next";

const nextConfig: NextConfig = {};

export default process.env.EVE_SELF_HOSTED === "1" ? nextConfig : withEve(nextConfig);
