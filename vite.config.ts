import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  base: process.env.VITE_BASE ?? "./",
  server: {
    port: 5174
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        about: resolve(__dirname, "about.html")
      }
    }
  }
});
