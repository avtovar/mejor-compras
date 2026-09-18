"use strict";
// ↑ Modo estricto de JS.

/**
 * Utilidades de normalización de texto y generación de slugs.
 *
 * El slug se usa como nombre de archivo del cache:
 *   data/searches/<slug>.json
 */

/** Quita acentos y pasa a minúsculas, colapsando espacios. */
function normalizar(texto) {
  if (typeof texto !== "string") return "";
  return texto
    .toLowerCase()
    // ↑ Todo a minúsculas para que las comparaciones no dependan de mayúsculas/minúsculas.
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // elimina acentos
    // ↑ "normalize NFD" separa las letras de sus acentos y el regex borra los símbolos de acento.
    // "Águila" → "Aguila".
    .replace(/\s+/g, " ")
    // ↑ Colapsa espacios múltiples o saltos de línea en un solo espacio.
    .trim();
  // ↑ Quita espacios al inicio y al final.
}

/** Convierte una query libre ("TV 32 pulgadas") en un slug seguro para nombre de archivo. */
function slugDeQuery(query) {
  return normalizar(query)
    .replace(/[^a-z0-9]+/g, "-")
    // ↑ Todo lo que no sea letra o número se convierte en guion: "TV 32" → "tv-32".
    .replace(/^-+|-+$/g, "")
    // ↑ Elimina guiones al inicio y al final (no queremos "tv--32" ni "-tv-32-").
    .slice(0, 80) || "busqueda";
  // ↑ Corta a 80 caracteres para no tener nombres de archivo gigantes; si queda vacío usa "busqueda".
}

module.exports = { normalizar, slugDeQuery };
// ↑ Exportamos las dos funciones útiles para el resto del backend.