"use strict";
// ↑ Modo estricto de JS.

/**
 * Cola simple de ejecución en serie.
 *
 * Garantiza que nunca corran DOS BÚSQUEDAS de opencode a la vez: cada tarea se
 * encola detrás de la anterior (promise chain). Dentro de una misma búsqueda
 * pueden correr varios procesos de opencode EN PARALELO (uno por lote), pero la
 * búsqueda completa sigue siendo UNA sola tarea encolada.
 */

let cola = Promise.resolve();
// ↑ Empezamos con una promesa ya resuelta: la "cinta transportadora" de tareas, inicialmente vacía.

/** Encola fn (debe devolver una promesa) y devuelve una promesa con su resultado. */
function encolar(fn) {
  const ejecucion = cola.then(fn, fn); // corre aunque la anterior haya fallado
  // ↑ La tarea nueva se encadena a la anterior. El segundo `fn` (mismo callback) hace
  // que corra incluso si la tarea previa falló: llamamos a fn con el error o con el valor.
  cola = ejecucion.catch(() => {}); // la cola nunca queda "rota" por un error
  // ↑ Si esta tarea falla, lo "tapamos" en la cola para que la siguiente igual se ejecute.
  // La persona que encoló recibe el error por su propia promesa (ejecucion), no por la cola.
  return ejecucion;
}

module.exports = { encolar };
// ↑ Exportamos solo encolar: es la única pieza pública de este módulo.