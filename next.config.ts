import type { NextConfig } from "next";

/* The studio has two modes and one switch. With no HF_API_BASE_URL it renders
   on this machine (ffmpeg) and the picker shows the local model; set the URL
   and it goes back to being a client for the hosted catalog. The flag is
   mirrored to the client through NEXT_PUBLIC_*, so the server and the picker
   always agree on which mode the build is in. */
const localMode = !process.env.HF_API_BASE_URL;

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_OHF_LOCAL_MODE: localMode ? "1" : "0",
  },
  /* The renderer shells out to a prebuilt binary that resolves its own path at
     runtime; bundling it would break that lookup. */
  serverExternalPackages: ["@ffmpeg-installer/ffmpeg"],
  /* The studio is previewed through a proxy host, so dev-mode asset requests
     arrive from an origin the default allow-list would refuse. */
  allowedDevOrigins: ["*.e2b.app"],
  experimental: {
    /* Server actions compare Origin to Host. Behind a preview proxy the two
       differ, and the default allow-list would reject every generate. */
    serverActions: {
      allowedOrigins: ["localhost:3000", "127.0.0.1:3000", "*.e2b.app"],
    },
  },
};

export default nextConfig;
