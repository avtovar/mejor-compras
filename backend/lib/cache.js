"use strict";
// ↑ Modo estricto de JS: buenas prácticas para evitar errores silenciosos.

/**
 * Cache persistente de búsquedas en el repo.
 *
 * Estructura:
 *   data/searches/<slug>.json   → detalle de una búsqueda
 *   data/index.json             → { [slug]: { query, fecha, archivo, cantidad, tiendas } }
 *
 * Los datos viven en el repo a propósito: quedan guardados para reutilizar
 * futuras búsquedas iguales (cache persistente).
 */

const fs = require("fs");
// ↑ Módulo nativo de Node para leer/escribir archivos.
const path = require("path");
// ↑ Módulo nativo de Node para armar rutas de archivos de forma segura.

const RAIZ = path.join(__dirname, "..", ".."); // F:\mejor_compras
// ↑ Raíz del proyecto calculada desde la carpeta del archivo (backend/lib/ → subo dos niveles).
const DIR_DATOS = path.join(RAIZ, "data");
const DIR_BUSQUEDAS = path.join(DIR_DATOS, "searches");
const ARCHIVO_INDEX = path.join(DIR_DATOS, "index.json");
// ↑ Las tres rutas base: data/, data/searches/ y el archivo índice.

/** Garantiza que existan data/ y data/searches/. */
function asegurarDirectorios() {
  fs.mkdirSync(DIR_BUSQUEDAS, { recursive: true });
  // ↑ mkdirSync con recursive:true crea la carpeta y no falla si ya existe (como "mkdir -p").
  if (!fs.existsSync(ARCHIVO_INDEX)) {
    fs.writeFileSync(ARCHIVO_INDEX, "{}\n", "utf8");
  }
  // ↑ Si no hay index.json todavía, lo creamos vacío con un objeto {}.
}

function rutaDeBusqueda(slug) {
  return path.join(DIR_BUSQUEDAS, `${slug}.json`);
}
// ↑ Devuelve la ruta del archivo de una búsqueda: data/searches/<slug>.json.

/** Lee una búsqueda cacheada completa. Devuelve null si no existe. */
function leerBusqueda(slug) {
  const ruta = rutaDeBusqueda(slug);
  if (!fs.existsSync(ruta)) return null;
  // ↑ Si el archivo no existe, no hay cache: devolvemos null para que busque con IA.
  try {
    return JSON.parse(fs.readFileSync(ruta, "utf8"));
  } catch {
    return null;
  }
}

function leerIndex() {
  try {
    return JSON.parse(fs.readFileSync(ARCHIVO_INDEX, "utf8"));
  } catch {
    return {};
  }
}
// ↑ Lee el índice general (slug → metadatos). Si está corrupto, devuelve {} para no romper.

function escribirIndex(index) {
  fs.writeFileSync(ARCHIVO_INDEX, JSON.stringify(index, null, 2) + "\n", "utf8");
}
// ↑ Guarda el índice con formato legible (2 espacios de indentación) y salto de línea final.

/**
 * Guarda una búsqueda completa en data/searches/<slug>.json y actualiza
 * data/index.json. Recibe el objeto de búsqueda ya armado.
 */
function guardarBusqueda(busqueda) {
  asegurarDirectorios();
  const ruta = rutaDeBusqueda(busqueda.slug);
  fs.writeFileSync(ruta, JSON.stringify(busqueda, null, 2) + "\n", "utf8");
  // ↑ Primero escribe el detalle completo de la búsqueda en su archivo.

  const index = leerIndex();
  index[busqueda.slug] = {
    query: busqueda.query,
    fecha: busqueda.fecha,
    archivo: `searches/${busqueda.slug}.json`,
    cantidad: busqueda.ofertas ? busqueda.ofertas.length : 0,
    tiendas: (busqueda.ofertas || [])
      .filter((o) => o.available)
      .map((o) => o.store),
  };
  // ↑ Después actualiza el índice con solo los metadatos (para el historial, sin repetir todo).

  escribirIndex(index);
}

/** Devuelve el historial de búsquedas cacheadas (de la más reciente a la más vieja). */
function listarHistorial() {
  const index = leerIndex();
  return Object.entries(index)
    .map(([slug, meta]) => ({ slug, ...meta }))
    // ↑ Convierte cada entrada { slug: meta } en un objeto { slug, ...meta } plano.
    .sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  // ↑ Ordena por fecha de más reciente (a.fecha mayor) a más vieja.
}

module.exports = {
  RAIZ,
  DIR_DATOS,
  asegurarDirectorios,
  leerBusqueda,
  guardarBusqueda,
  listarHistorial,
};
// ↑ Exportamos solo lo que usan los demás módulos (server.js principalmente).