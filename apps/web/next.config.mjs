/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@flowos/schema", "@flowos/db"],
  typescript: {
    // Type errors will be fixed once we run `supabase gen types` against a real project.
    // Remove this flag after first DB connection.
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
