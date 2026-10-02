import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Uploads go through a Server Action; the default 1 MB limit is too small for scans.
    // Slightly above MAX_UPLOAD_BYTES (10 MB) to leave room for multipart overhead.
    serverActions: { bodySizeLimit: "11mb" },
  },
  // pdf.js (via unpdf) must not be bundled by webpack/turbopack for the server.
  serverExternalPackages: ["unpdf"],
};

export default nextConfig;
