import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // node-llama-cpp and tesseract.js ship native/wasm binaries that must not
  // be bundled by webpack; they need to be loaded as real Node.js modules
  // at runtime so the local-only AI pipeline keeps working in production.
  serverExternalPackages: [
    "node-llama-cpp",
    "@node-llama-cpp/linux-x64",
    "tesseract.js",
    "pdf-parse",
    "mammoth",
    // PGlite loads its WASM binary from its package at runtime. Bundling it
    // with Turbopack changes the loader and causes instantiateWasm failures.
    "@electric-sql/pglite",
    // pgvector for PGlite ships its extension as a tarball resolved relative
    // to the package file at runtime — it must stay external as well.
    "@electric-sql/pglite-pgvector",
  ],
};

export default nextConfig;
