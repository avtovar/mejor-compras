/* ============================================================
   MejorCompras (React) — Capa de acceso a la API
   ============================================================
   ↑ Centraliza TODAS las llamadas fetch al backend. Así los
   componentes no repiten URLs ni manejo de errores.
   En desarrollo, Vite hace proxy de /api → http://localhost:3000.
   En producción, el backend sirve esta app y /api es el mismo origen. */

const BASE = "";
// ↑ Sin prefijo: usamos rutas relativas ("/api/...").

/** Función interna: hace el fetch, parsea JSON y lanza Error si la respuesta no es OK. */
async function pedir(url, opciones) {
  const resp = await fetch(url, opciones);
  let datos = {};
  try {
    datos = await resp.json();
  } catch {
    datos = {};
  }
  // ↑ Algunas respuestas pueden no traer JSON; en ese caso dejamos un objeto vacío.

  if (!resp.ok) {
    const err = new Error(datos.error || `Error ${resp.status}`);
    err.status = resp.status;
    err.datos = datos;
    // ↑ Adjuntamos el status y el body del error para que App pueda distinguir
    // p.ej. una cancelación (499 con cancelado:true) de un error real.
    throw err;
  }
  return datos;
}

export const api = {
  /** Lista de tiendas configuradas: { tiendas: [{id, nombre, urlBase}] } */
  getStores: () => pedir("/api/stores"),

  /** Agrega una tienda nueva (nombre y URL obligatorios). */
  addStore: (nombre, urlBase) =>
    pedir("/api/stores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre, urlBase }),
    }),

  /** Elimina una tienda por su id (slug). */
  deleteStore: (id) =>
    pedir(`/api/stores/${encodeURIComponent(id)}`, { method: "DELETE" }),

  /** Busca un producto. `signal` permite cancelar la petición. */
  search: (query, force, stores, signal) =>
    pedir("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, force, stores }),
      signal,
    }),

  /** Cancela la búsqueda en curso en el backend (mata el proceso de opencode). */
  cancelSearch: () => fetch("/api/search/cancel", { method: "POST" }).catch(() => {}),

  /** Detalle de una búsqueda guardada en cache. */
  getSearch: (slug) => pedir(`/api/search/${encodeURIComponent(slug)}`),

  /** Historial de búsquedas cacheadas. */
  getHistory: () => pedir("/api/history"),
};