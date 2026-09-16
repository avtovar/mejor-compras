"use strict";

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
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // elimina acentos
    .replace(/\s+/g, " ")
    .trim();
}

/** Convierte una query libre ("TV 32 pulgadas") en un slug seguro para nombre de archivo. */
function slugDeQuery(query) {
  return normalizar(query)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "busqueda";
}

module.exports = { normalizar, slugDeQuery };