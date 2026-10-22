import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  // The PPTX export worker is a module worker and imports PptxGenJS, which
  // splits into multiple chunks; ES output is required for that.
  worker: { format: "es" },
});
