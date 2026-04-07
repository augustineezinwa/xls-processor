import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep ExcelJS on the server only — it uses Node.js built-ins (fs, stream, crypto)
  serverExternalPackages: ["exceljs"],
  // Turbopack config (Next.js 16 default bundler)
  // ExcelJS is server-external so client bundles never include it.
  // Empty turbopack config silences the webpack-conflict warning.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
