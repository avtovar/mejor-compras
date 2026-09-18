/* ============================================================
   MejorCompras (React) — vite.config.js
   ============================================================
   ↑ Configuración del bundler Vite:
   - `base: '/react/'` hace que el build genere rutas absolutas
     bajo `/react/...`, así el backend puede servirlo en esa ruta.
   - El proxy de `/api` redirige las peticiones al backend Express
     de http://localhost:3000 (evita problemas de CORS en dev). */

import { defineConfig } from "vite";
// ↑ defineConfig tipa la config y da autocompletado.
import react from "@vitejs/plugin-react";
// ↑ Plugin oficial de Vite para compilar JSX y aplicar React Fast Refresh.

export default defineConfig({
  plugins: [react()],
  base: "/react/",
  // ↑ Todas las URLs generadas (JS/CSS) quedan bajo /react/ en producción.

  server: {
    port: 5173,
    // ↑ Puerto del dev server (http://localhost:5173/react/).
    proxy: {
      "/api": "http://localhost:3000",
      // ↑ Todo request a /api/* se reenvía al backend sin tocar el dominio.
    },
  },
});