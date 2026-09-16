"use strict";

/**
 * Cola simple de ejecución en serie.
 *
 * Garantiza que nunca se lancen DOS procesos de opencode simultáneos:
 * cada tarea se encola detrás de la anterior (promise chain).
 */

let cola = Promise.resolve();

/** Encola fn (debe devolver una promesa) y devuelve una promesa con su resultado. */
function encolar(fn) {
  const ejecucion = cola.then(fn, fn); // corre aunque la anterior haya fallado
  cola = ejecucion.catch(() => {}); // la cola nunca queda "rota" por un error
  return ejecucion;
}

module.exports = { encolar };