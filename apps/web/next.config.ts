import type { NextConfig } from "next";

// QT_WEB_DIST_DIR is set only by the separate IPO site build; unset, the build is exactly the default Core PCE export.
const nextConfig: NextConfig = { output: "export", trailingSlash: true, ...(process.env.QT_WEB_DIST_DIR ? { distDir: process.env.QT_WEB_DIST_DIR } : {}) };
export default nextConfig;
