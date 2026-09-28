import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const backendTarget = env.DOGFOOD_BACKEND_URL ?? "http://localhost:8000";

  return {
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      port: 5173,
      proxy: {
        "/health": backendTarget,
        "/projects": backendTarget,
        "/events": backendTarget,
        "/teams": backendTarget,
        "/team-invites": backendTarget,
        "/judge-invitations": backendTarget,
        "/judge-assignments": backendTarget,
        "/api": backendTarget,
      },
    },
  };
});