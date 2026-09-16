"use strict";

/**
 * MejorCompras — Backend.
 *
 * API:
 *   GET  /api/stores            → tiendas configuradas (stores.json)
 *   POST /api/search            → body { query, force? }; busca (cache o agente opencode)
 *   GET  /api/history           → búsquedas cacheadas
 *   GET  /api/search/:slug      → detalle de una búsqueda cacheada
 *
 * Además sirve el frontend estático (frontend/) en la raíz.
 */

const express = require("express");
const path = require("path");
const fs = require("fs");

const slugLib = require("./lib/slug");
const cache = require("./lib/cache");
const opencode = require("./lib/opencode");
const cola = require("./lib/cola");

const PUERTO = Number(process.env.PORT || 3000);
const RAIZ = cache.RAIZ;
const DIR_FRONTEND = path.join(RAIZ, "frontend");

// Nombres canónicos de tienda (ídem stores.json) para normalizar respuestas del agente.
const TIENDAS_CANONICAS = ["Naldo", "Carrefour", "Coto"];

const app = express();
app.use(express.json());
app.use(express.static(DIR_FRONTEND));

cache.asegurarDirectorios();

/** Calcula la mejor opción: oferta disponible con menor precio. */
function calcularMejorOpcion(ofertas) {
  const disponibles = (ofertas || []).filter(
    (o) => o.available && typeof o.price === "number" && o.price > 0
  );
  if (disponibles.length === 0) return null;
  const mejor = disponibles.reduce((a, b) => (a.price <= b.price ? a : b));
  return {
    store: mejor.store,
    title: mejor.title,
    price: mejor.price,
    currency: mejor.currency || "ARS",
    url: mejor.url,
    fecha: mejor.fetchedAt || new Date().toISOString(),
    motivo: "Menor precio entre las ofertas disponibles",
  };
}

/** Normaliza la oferta del agente: garantiza nombres canónicos y campos mínimos. */
function normalizarOferta(oferta) {
  const mapa = (nombre) => {
    const n = String(nombre || "").toLowerCase();
    return TIENDAS_CANONICAS.find((t) => t.toLowerCase() === n) || n || "Desconocida";
  };
  const price = typeof oferta.price === "number" ? Math.round(oferta.price) : null;
  return {
    store: mapa(oferta.store),
    title: typeof oferta.title === "string" ? oferta.title : "Sin título",
    price,
    currency: "ARS",
    url: typeof oferta.url === "string" ? oferta.url : "",
    available: Boolean(oferta.available),
    fetchedAt: oferta.fetchedAt || new Date().toISOString(),
  };
}

// ---------------------------------------------------------------- API

/** GET /api/stores */
app.get("/api/stores", (_req, res) => {
  try {
    const datos = JSON.parse(fs.readFileSync(path.join(__dirname, "stores.json"), "utf8"));
    res.json(datos);
  } catch {
    res.status(500).json({ error: "No se pudieron leer las tiendas configuradas." });
  }
});

/** GET /api/history */
app.get("/api/history", (_req, res) => {
  res.json(cache.listarHistorial());
});

/** GET /api/search/:slug */
app.get("/api/search/:slug", (req, res) => {
  const slug = String(req.params.slug || "").toLowerCase();
  const guardada = cache.leerBusqueda(slug);
  if (!guardada) {
    return res.status(404).json({ error: "Esa búsqueda no está en el cache." });
  }
  res.json({ ...guardada, fromCache: true });
});

/** POST /api/search */
app.post("/api/search", (req, res) => {
  const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
  const fuerza = Boolean(req.body?.force);

  if (!query) {
    return res.status(400).json({ error: "Escribí un producto para buscar (ej: TV 32 pulgadas)." });
  }

  const queryNormalizada = slugLib.normalizar(query);
  const slug = slugLib.slugDeQuery(query);

  // 1) Cache: si ya existe y no se pidió fuerza, se responde desde cache.
  const guardada = cache.leerBusqueda(slug);
  if (guardada && !fuerza) {
    return res.json({ ...guardada, fromCache: true });
  }

  // 2) Búsqueda real vía agente opencode (en cola para no lanzar dos a la vez).
  const tarea = cola.encolar(async () => {
    const crudo = await opencode.buscar(query);
    return crudo;
  });

  tarea
    .then((crudo) => {
      const fecha = new Date().toISOString();
      const ofertas = Array.isArray(crudo.ofertas)
        ? crudo.ofertas.map(normalizarOferta)
        : [];

      const busqueda = {
        slug,
        query,
        queryNormalizada,
        fecha,
        agente: opencode.AGENTE,
        tiendasConsultadas: Array.isArray(crudo.tiendasConsultadas) ? crudo.tiendasConsultadas : TIENDAS_CANONICAS,
        ofertas,
        mejorOpcion: calcularMejorOpcion(ofertas),
        nota: typeof crudo.nota === "string" ? crudo.nota : "",
        fromCache: false,
      };

      // Se guarda siempre que haya al menos un resultado coherente (aunque sea sin ofertas).
      if (ofertas.length > 0 || busqueda.nota) {
        cache.guardarBusqueda(busqueda);
      }

      res.json(busqueda);
    })
    .catch((err) => {
      console.error(`[MejorCompras] Error en búsqueda "${query}":`, err.message);
      res.status(502).json({
        error:
          err.message ||
          "El agente de precios falló. Probá de nuevo en unos minutos o cambiá un poco la búsqueda.",
      });
    });
});

// ------------------------------------------------------------------ inicio

app.listen(PUERTO, () => {
  console.log(`🛒 MejorCompras backend corriendo en http://localhost:${PUERTO}`);
  console.log(`   Frontend estático: ${DIR_FRONTEND}`);
  console.log(`   Agente opencode:   ${opencode.AGENTE} (timeout ${opencode.TIMEOUT_DEFAULT_MS} ms)`);
});