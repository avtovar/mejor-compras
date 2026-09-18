"use strict";
// ↑ "use strict" activa el modo estricto de JS: evita errores silenciosos y
// código poco seguro (variables sin declarar, etc.). Es una buena práctica.

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
// ↑ Express es el framework web con el que armamos el servidor HTTP y las rutas de la API.
const path = require("path");
// ↑ Módulo nativo de Node para armar rutas de archivos seguras en cualquier sistema operativo.
const fs = require("fs");
// ↑ Módulo nativo de Node para leer/escribir archivos (stores.json, cache, etc.).

const slugLib = require("./lib/slug");
// ↑ Nuestro módulo de utilidades: convierte "TV 32!" en un slug seguro como nombre de archivo.
const cache = require("./lib/cache");
// ↑ Nuestro módulo de cache persistente: guarda y lee las búsquedas en data/.
const opencode = require("./lib/opencode");
// ↑ Nuestro módulo que lanza la CLI de opencode y lee el JSON del subagente de precios.
const cola = require("./lib/cola");
// ↑ Nuestra cola en serie: evita que se lancen DOS BÚSQUEDAS a la vez (dentro de una
// búsqueda pueden correr varios procesos de opencode en paralelo, uno por lote).

const PUERTO = Number(process.env.PORT || 3000);
// ↑ Puertos donde escucha el servidor. Se puede cambiar con la variable de entorno PORT.
const RAIZ = cache.RAIZ;
// ↑ Raíz del proyecto (F:\mejor_compras), calculada en cache.js.
const DIR_FRONTEND = path.join(RAIZ, "frontend");
// ↑ Carpeta con el HTML/CSS/JS que Express va a servir como página estática.
const DIR_REACT = path.join(RAIZ, "frontend-react", "dist");
// ↑ Carpeta con el build de la versión React (la genera `npm run build` en frontend-react/).

// Nombres canónicos de tienda (ídem stores.json) para normalizar respuestas del agente.
// ↑ Debe mantenerse EXACTAMENTE en sincronía con backend/stores.json:
//   el frontend selecciona tiendas por `nombre`, y esta lista traduce lo que
//   devuelve el agente ("naldo", "NALDO") al nombre canónico ("Naldo").
const TIENDAS_CANONICAS = [
  // --- Catálogo original (12) ---
  "Naldo",
  "Carrefour",
  "Coto",
  "Mercado Libre",
  "On City",
  "Musimundo",
  "Garbarino",
  "Frávega",
  "RODO",
  "Tiribelli Hogar",
  "Feelhome",
  "Casa del Audio",
  // --- Anexadas: listado electro/computación CABA (2026) ---
  // Bloque 1: comercios que cubren electro + computación + muebles
  "Computers Depot",
  "SOS Computación",
  "Overhard",
  // Bloque 2: computación / gaming con sillas y escritorios
  "AXA Computación",
  "Maximus Gaming",
  "M&M Computación",
  "Ultra Computación",
  "Venex",
  // Bloque 3: electrodomésticos con e-commerce propio
  "Electro5",
  "Electro GV",
  // Bloque 4: sillas y escritorios
  "Quamo",
  "Baires4",
  "Furnitech",
  // Bloque 5: supermercados e hipermercados
  "Jumbo",
  "Disco",
  "Vea",
  "ChangoMas",
  "DIA",
  // Bloque 6: mayoristas
  "Makro",
  "Vital",
  "Diarco",
  "Yaguar",
  // Bloque 7: cadenas de electro y tecnología
  "Cetrogar",
  "Megatone",
  "Pardo Hogar",
];
// ↑ Lista "oficial" de tiendas. Si el agente devuelve "naldo" o "NALDO", lo normalizamos a "Naldo".

const app = express();
// ↑ Creamos la aplicación Express: sobre ella registramos rutas y middlewares.
app.use(express.json());
// ↑ Middleware que convierte el body JSON de cada request en un objeto JS (req.body).
app.use(express.static(DIR_FRONTEND));
// ↑ Middleware que sirve los archivos estáticos del frontend (index.html, css, js) en la raíz "/".

if (fs.existsSync(DIR_REACT)) {
  app.use("/react", express.static(DIR_REACT));
  // ↑ Si existe el build de React, lo servimos en http://localhost:3000/react.
  //   Vite compila con base "/react/", así que los assets apuntan a /react/assets/...
} else {
  console.log("[react] No hay build en frontend-react/dist. Corré `npm install && npm run build` ahí.");
  // ↑ Aviso útil en consola: la app HTML/CSS/JS sigue funcionando en "/" igual.
}

cache.asegurarDirectorios();
// ↑ Al arrancar garantizamos que existan data/ y data/searches/ (y el index.json).

/** Calcula la mejor opción: oferta disponible con menor precio. */
function calcularMejorOpcion(ofertas) {
  const disponibles = (ofertas || []).filter(
    (o) => o.available && typeof o.price === "number" && o.price > 0
  );
  // ↑ Filtramos solo las ofertas que tienen `available: true` y un precio numérico válido (> 0).
  if (disponibles.length === 0) return null;
  const mejor = disponibles.reduce((a, b) => (a.price <= b.price ? a : b));
  // ↑ reduce recorre el array quedándose con la oferta de menor precio (como un "torneo").
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
  // ↑ Función interna: busca el nombre canónico de la tienda (ej. "naldo" → "Naldo").
  const price = typeof oferta.price === "number" ? Math.round(oferta.price) : null;
  // ↑ El precio llega como número del agente; lo redondeamos por si trae decimales.
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
    // ↑ Lee stores.json y lo devuelve como JSON. `__dirname` es la carpeta actual (backend/).
    res.json(datos);
  } catch {
    res.status(500).json({ error: "No se pudieron leer las tiendas configuradas." });
  }
});

/** POST /api/stores — agrega una tienda nueva y la guarda en stores.json (persistente). */
app.post("/api/stores", (req, res) => {
  const nombre = typeof req.body?.nombre === "string" ? req.body.nombre.trim() : "";
  let urlBase = typeof req.body?.urlBase === "string" ? req.body.urlBase.trim() : "";
  // ↑ El frontend manda { nombre, urlBase } para la tienda nueva.

  if (!nombre || !urlBase) {
    return res.status(400).json({
      error: "Faltan datos: la tienda está incompleta. Escribí el nombre y la URL (ej: https://www.mitienda.com.ar).",
    });
  }
  // ↑ Sin nombre o sin URL la tienda no se puede consultar: rechazamos el alta (400).
  // Nada se guarda hasta que la información esté completa.

  // Normaliza la URL: si trae texto pero no tiene esquema, le agregamos https://.
  if (urlBase && !/^https?:\/\//i.test(urlBase)) {
    urlBase = `https://${urlBase}`;
  }

  try {
    const datos = JSON.parse(fs.readFileSync(path.join(__dirname, "stores.json"), "utf8"));
    const tiendas = datos.tiendas || [];

    // Evita duplicados: mismo nombre (ignorando mayúsculas Y acentos) o mismo id (slug derivado del nombre).
    const nombreNormalizado = slugLib.normalizar(nombre);
    const duplicado = tiendas.find(
      (t) =>
        slugLib.normalizar(t.nombre) === nombreNormalizado ||
        t.id.toLowerCase() === slugLib.slugDeQuery(nombre)
    );
    // ↑ normalizar() pasa a minúsculas Y quita acentos: así "SOS Computación",
    //   "sos computacion" y "SOS COMPUTACIÓN" se detectan como la misma tienda.
    if (duplicado) {
      return res.status(409).json({ error: `La tienda "${nombre}" ya existe en la configuración.` });
    }

    const nueva = {
      id: slugLib.slugDeQuery(nombre),
      nombre,
      urlBase,
    };
    tiendas.push(nueva);
    fs.writeFileSync(
      path.join(__dirname, "stores.json"),
      JSON.stringify({ tiendas }, null, 2) + "\n",
      "utf8"
    );
    // ↑ Guarda el archivo con formato legible (2 espacios) para que se pueda editar a mano.

    res.status(201).json({ ok: true, tienda: nueva, tiendas });
  } catch {
    res.status(500).json({ error: "No se pudo actualizar el archivo de tiendas." });
  }
});

/** DELETE /api/stores/:id — elimina una tienda de stores.json. */
app.delete("/api/stores/:id", (req, res) => {
  const id = String(req.params.id || "").toLowerCase().trim();
  // ↑ El id llega en la URL (es el slug: "naldo", "carrefour", etc.).

  try {
    const datos = JSON.parse(fs.readFileSync(path.join(__dirname, "stores.json"), "utf8"));
    const tiendas = datos.tiendas || [];
    const pos = tiendas.findIndex((t) => t.id.toLowerCase() === id);
    if (pos === -1) {
      return res.status(404).json({ error: "Esa tienda no existe en la configuración." });
    }
    // ↑ findIndex devuelve -1 cuando no encuentra: respondemos 404 con mensaje claro.

    const [eliminada] = tiendas.splice(pos, 1);
    // ↑ splice(pos, 1) saca el elemento de esa posición. La "desestructuración" [x] captura el primero.
    fs.writeFileSync(
      path.join(__dirname, "stores.json"),
      JSON.stringify({ tiendas }, null, 2) + "\n",
      "utf8"
    );
    // ↑ Guardamos stores.json sin la tienda eliminada (formato legible).

    res.json({ ok: true, eliminada, tiendas });
  } catch {
    res.status(500).json({ error: "No se pudo actualizar el archivo de tiendas." });
  }
});

/** GET /api/history */
app.get("/api/history", (_req, res) => {
  res.json(cache.listarHistorial());
  // ↑ El historial es el índice del cache (data/index.json) ordenado de más reciente a más vieja.
});

/** GET /api/search/:slug */
app.get("/api/search/:slug", (req, res) => {
  const slug = String(req.params.slug || "").toLowerCase();
  // ↑ El "slug" viene en la URL (los dos puntos marcan un parámetro dinámico de Express).
  const guardada = cache.leerBusqueda(slug);
  if (!guardada) {
    return res.status(404).json({ error: "Esa búsqueda no está en el cache." });
  }
  res.json({ ...guardada, fromCache: true });
});

/** POST /api/search */
app.post("/api/search", (req, res) => {
  const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
  // ↑ El operador `?.` (optional chaining) evita errores si req.body es undefined.
  const fuerza = Boolean(req.body?.force);
  // ↑ `force: true` quiere decir "ignorá la cache y buscá de nuevo con IA".
  const tiendas = Array.isArray(req.body?.stores) ? req.body.stores : null;
  // ↑ Tiendas opcionales que eligió el usuario en el frontend (si no manda ninguna, se consultan todas).

  if (!query) {
    return res.status(400).json({ error: "Escribí un producto para buscar (ej: TV 32 pulgadas)." });
  }

  const queryNormalizada = slugLib.normalizar(query);
  // ↑ Versión "limpia" de la query (minúsculas, sin acentos) usada como referencia.
  const slug = slugLib.slugDeQuery(query);
  // ↑ Slug único para nombrar el archivo del cache: data/searches/<slug>.json.

  // 1) Cache: si ya existe y no se pidió fuerza, se responde desde cache.
  // Nota: si se especifican tiendas, forzamos búsqueda real para garantizar frescura en esas tiendas
  // o simplemente dejamos que el frontend filtre la cache. Aquí seguimos la lógica de fuerza.
  const guardada = cache.leerBusqueda(slug);
  if (guardada && !fuerza) {
    return res.json({ ...guardada, fromCache: true });
  }
  // ↑ Primera búsqueda idéntica sale desde cache: rápido y sin gastar tokens de IA.

  // 2) Búsqueda real vía agente opencode (en cola para no lanzar dos a la vez).
  const tarea = cola.encolar(async () => {
    const crudo = await opencode.buscar(query, tiendas);
    return crudo;
  });
  // ↑ Se encola la tarea y se espera el JSON crudo del agente cuando le toque turno.

  tarea
    .then((crudo) => {
      const fecha = new Date().toISOString();
      const ofertas = Array.isArray(crudo.ofertas)
        ? crudo.ofertas.map(normalizarOferta)
        : [];
      // ↑ Cada oferta del agente pasa por normalizarOferta para garantizar el formato de la API.

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
      // ↑ Armamos el "contrato" completo de la búsqueda que se devuelve al frontend y se cachea.

      // Se guarda siempre que haya al menos un resultado coherente (aunque sea sin ofertas).
      if (ofertas.length > 0 || busqueda.nota) {
        cache.guardarBusqueda(busqueda);
      }
      // ↑ Guardamos en data/searches/<slug>.json para que la próxima vez salga desde cache.

      res.json(busqueda);
    })
    .catch((err) => {
      if (err.cancelado) {
        // Cancelación pedida por el usuario: no es un error real, se responde distinto (499)
        // para que el frontend lo muestre como "cancelada" y no como una falla del agente.
        return res.status(499).json({
          error: err.message || "Búsqueda cancelada por el usuario.",
          cancelado: true,
        });
      }
      console.error(`[MejorCompras] Error en búsqueda "${query}":`, err.message);
      res.status(502).json({
        error:
          err.message ||
          "El agente de precios falló. Probá de nuevo en unos minutos o cambiá un poco la búsqueda.",
      });
    });
  // ↑ Si la promesa falla se llega aquí: 499 si fue cancelación, 502 si fue otro error.
});

/** POST /api/search/cancel — cancela la búsqueda en curso (mata el proceso de opencode activo). */
app.post("/api/search/cancel", (_req, res) => {
  const cancelado = opencode.cancelarActual();
  // ↑ Le pedimos a opencode.js que mate el proceso hijo en curso (si existe).
  res.json({ cancelado });
});

// ------------------------------------------------------------------ inicio

app.listen(PUERTO, () => {
  console.log(`🛒 MejorCompras backend corriendo en http://localhost:${PUERTO}`);
  console.log(`   Frontend estático: ${DIR_FRONTEND}`);
  console.log(`   Agente opencode:   ${opencode.AGENTE} (timeout ${opencode.TIMEOUT_DEFAULT_MS} ms)`);
  console.log(
    `   Batching:          ${opencode.BATCH_SIZE} tiendas por lote, ${opencode.CONCURRENCIA} en paralelo ` +
    `(timeout por lote ${opencode.TIMEOUT_DEFAULT_MS} ms, total ${opencode.TIMEOUT_TOTAL_DEFAULT_MS} ms)`
  );
  // ↑ Muestra la configuración del batching: cuántas tiendas por lote, cuántos lotes en paralelo
  //   y los dos timeouts (el de cada lote y el watchdog de la búsqueda completa).
});
// app.listen pone el servidor a escuchar; el callback se ejecuta cuando ya está arriba.