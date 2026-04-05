import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@flowos/schema", "@flowos/db"],
};

export default nextConfig;
