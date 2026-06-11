import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const exampleDir = dirname(fileURLToPath(import.meta.url));

/** @type {import("next").NextConfig} */
const nextConfig = {
  turbopack: {
    root: resolve(exampleDir, "../.."),
  },
};

export default nextConfig;
