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
  ],
};

export default nextConfig;
