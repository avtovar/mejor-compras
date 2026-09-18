/* ============================================================
   MejorCompras (React) — Punto de entrada
   ============================================================
   ↑ Monta la aplicación React dentro del <div id="root"> que está
   en index.html. Es lo primero que Vite ejecuta. */

import React from "react";
// ↑ Traemos React (necesario para usar JSX en StrictMode).
import { createRoot } from "react-dom/client";
// ↑ createRoot: API moderna de React 18 para montar la app en el DOM.
import App from "./App.jsx";
// ↑ El componente raíz de nuestra aplicación.
import "./styles.css";
// ↑ Estilos globales (paleta, tarjetas, dashboard, responsive).

createRoot(document.getElementById("root")).render(
  // ↑ Busca el contenedor #root del HTML y lo convierte en la raíz de React.
  <React.StrictMode>
    {/* ↑ StrictMode: modo de desarrollo que avisa de malas prácticas (no afecta producción). */}
    <App />
  </React.StrictMode>
);