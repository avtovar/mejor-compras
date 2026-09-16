"use strict";

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
const path = require("path");

const RAIZ = path.join(__dirname, "..", ".."); // F:\mejor_compras
const DIR_DATOS = path.join(RAIZ, "data");
const DIR_BUSQUEDAS = path.join(DIR_DATOS, "searches");
const ARCHIVO_INDEX = path.join(DIR_DATOS, "index.json");

/** Garantiza que existan data/ y data/searches/. */
function asegurarDirectorios() {
  fs.mkdirSync(DIR_BUSQUEDAS, { recursive: true });
  if (!fs.existsSync(ARCHIVO_INDEX)) {
    fs.writeFileSync(ARCHIVO_INDEX, "{}\n", "utf8");
  }
}

function rutaDeBusqueda(slug) {
  return path.join(DIR_BUSQUEDAS, `${slug}.json`);
}

/** Lee una búsqueda cacheada completa. Devuelve null si no existe. */
function leerBusqueda(slug) {
  const ruta = rutaDeBusqueda(slug);
  if (!fs.existsSync(ruta)) return null;
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

function escribirIndex(index) {
  fs.writeFileSync(ARCHIVO_INDEX, JSON.stringify(index, null, 2) + "\n", "utf8");
}

/**
 * Guarda una búsqueda completa en data/searches/<slug>.json y actualiza
 * data/index.json. Recibe el objeto de búsqueda ya armado.
 */
function guardarBusqueda(busqueda) {
  asegurarDirectorios();
  const ruta = rutaDeBusqueda(busqueda.slug);
  fs.writeFileSync(ruta, JSON.stringify(busqueda, null, 2) + "\n", "utf8");

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
  escribirIndex(index);
}

/** Devuelve el historial de búsquedas cacheadas (de la más reciente a la más vieja). */
function listarHistorial() {
  const index = leerIndex();
  return Object.entries(index)
    .map(([slug, meta]) => ({ slug, ...meta }))
    .sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
}

module.exports = {
  RAIZ,
  DIR_DATOS,
  asegurarDirectorios,
  leerBusqueda,
  guardarBusqueda,
  listarHistorial,
};