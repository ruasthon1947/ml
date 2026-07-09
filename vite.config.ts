import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import localDbPlugin from "./server/localDbPlugin.mjs";

export default defineConfig({
  plugins: [react(), localDbPlugin()],
  server: { host: true, port: 5173 },
});
