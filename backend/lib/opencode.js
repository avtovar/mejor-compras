"use strict";
// ↑ Modo estricto de JS.

/**
 * Ejecuta el subagente de opencode (comparador-precios-ar) por cada búsqueda
 * real y extrae el JSON final de su respuesta.
 *
 * IMPORTANTE: `opencode run --agent <subagente>` NO funciona con subagentes
 * (opencode avisa "is a subagent, not a primary agent" y cae al agente
 * principal). Por eso el prompt del subagente se pasa INLINE como mensaje:
 *   opencode run "<prompt del subagente>.\n\nPRODUCTO: ..." --format json --dir <raiz>
 * Así el agente principal sigue el prompt especializado de forma determinística.
 *
 * opencode emite eventos JSON (NDJSON) por stdout. El resultado del subagente
 * llega como output de la tool "task" (part.tool === "task", state.output).
 * El texto puede traer prosa alrededor del JSON → se extrae el primer {...} al
 * último } y se parsea.
 *
 * BATCHING (lotes en paralelo): el catálogo creció a 37 tiendas y UNA sola
 * sesión de opencode ya no alcanzaba (agotaba el timeout y devolvía 502).
 * Ahora la lista se parte en lotes de BATCH_SIZE tiendas y se lanzan hasta
 * CONCURRENCIA procesos de opencode en paralelo; al final se fusionan las
 * ofertas de todos los lotes (ver `fusionarResultados`). Ventajas:
 *   - El tiempo total baja: antes 1 sesión gigante, ahora varios lotes a la vez.
 *   - Si UN lote falla, los demás igual devuelven ofertas (se evita el 502 total).
 * Contra: pasan de 1 proceso a N procesos a la vez, por eso la concurrencia es
 * limitada y configurable, y además hay un watchdog de tiempo total.
 *
 * CANCELACIÓN: se guardan las referencias de TODOS los procesos hijos activos
 * en `procesosActivos`. `cancelarActual()` mata a todos (SIGTERM y, si siguen
 * vivos, SIGKILL a los 2s) y marca `cancelado = true`, para que el handler de
 * "close" rechace cada promesa con un error distinguible (`err.cancelado === true`)
 * en vez de resolver como si hubiera terminado normalmente.
 */

const { spawn, execFileSync } = require("child_process");
// ↑ spawn lanza un proceso externo (la CLI de opencode). execFileSync ejecuta un comando síncrono
// (lo usamos con where.exe para encontrar el binario real de opencode en Windows).
const path = require("path");
// ↑ Para armar rutas de archivos.
const fs = require("fs");
// ↑ Para comprobar si existe el binario de opencode.
const cache = require("./cache");
// ↑ Usamos cache.RAIZ como directorio de trabajo (-–dir) al lanzar opencode.
const slugLib = require("./slug");
// ↑ normalizar() = minúsculas y sin acentos. Se usa para deduplicar tiendas al fusionar lotes.

const AGENTE = "comparador-precios-ar";
// ↑ Nombre exacto del subagente definido en .opencode/agent/comparador-precios-ar.md.

/** Lee un número entero >= 1 de una variable de entorno; si no es válido, usa el default. */
function enteroEnv(nombre, porDefecto) {
  const valor = Number(process.env[nombre]);
  return Number.isFinite(valor) && valor >= 1 ? Math.floor(valor) : porDefecto;
}
// ↑ Number("") es 0 y Number(undefined) es NaN: en ambos casos cae al default.

// Cuántas tiendas entran en cada lote (cada lote = un proceso de opencode).
const BATCH_SIZE = enteroEnv("OPENCODE_BATCH_SIZE", 6);
// ↑ 37 tiendas / 6 = 7 lotes. Configurable con OPENCODE_BATCH_SIZE.

// Cuántos procesos de opencode pueden correr AL MISMO TIEMPO.
const CONCURRENCIA = enteroEnv("OPENCODE_CONCURRENCIA", 4);
// ↑ Tope defensivo: evita saturar la máquina y disparar los límites del proveedor de IA.
// Con 7 lotes y concurrencia 4 se resuelve en 2 tandas.

// Timeout de CADA lote (cada proceso de opencode).
const TIMEOUT_DEFAULT_MS = Number(process.env.OPENCODE_TIMEOUT_MS || 600000);
// ↑ 10 minutos por lote.

// Watchdog de la búsqueda COMPLETA (todos los lotes juntos).
const TIMEOUT_TOTAL_DEFAULT_MS = Number(process.env.OPENCODE_TIMEOUT_TOTAL_MS || 900000);
// ↑ 15 minutos. Red de seguridad: si se pasa, se matan todos los procesos y se avisa.

// Nombres canónicos de tienda usados en el mensaje de delegación y en el contrato JSON.
// ↑ Misma lista que TIENDAS_CANONICAS en server.js y que backend/stores.json.
const TIENDAS_MENSAJE = [
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
  "Computers Depot",
  "SOS Computación",
  "Overhard",
  "AXA Computación",
  "Maximus Gaming",
  "M&M Computación",
  "Ultra Computación",
  "Venex",
  "Electro5",
  "Electro GV",
  "Quamo",
  "Baires4",
  "Furnitech",
  "Jumbo",
  "Disco",
  "Vea",
  "ChangoMas",
  "DIA",
  "Makro",
  "Vital",
  "Diarco",
  "Yaguar",
  "Cetrogar",
  "Megatone",
  "Pardo Hogar",
];
// ↑ La misma lista canónica del server.js; se usa para armar el mensaje que se le pasa a opencode.
// Si el frontend manda tiendas seleccionadas, se usa esa selección y no esta lista completa.

// Procesos hijos de opencode actualmente vivos (normalmente uno por lote en curso).
const procesosActivos = new Set();
// ↑ Antes era una sola referencia (`procesoActual`); con batching pueden ser varios a la vez.

// true si se pidió cancelar la búsqueda en curso (para distinguir cancelación de cierre normal).
let cancelado = false;
// ↑ Es UNA bandera por búsqueda (no por proceso): cancelar cancela todos los lotes.

/**
 * Cancela la búsqueda en curso (si hay una). Devuelve true si había al menos un
 * proceso activo al que se le pidió terminar, false si no había nada corriendo.
 */
function cancelarActual() {
  if (procesosActivos.size === 0) return false;
  // ↑ Sin procesos vivos no hay nada que cancelar.
  cancelado = true;
  // ↑ Marcamos la bandera ANTES de matar, para que los handlers de "close" sepan que fue cancelación.

  const vivos = [...procesosActivos];
  // ↑ Copiamos el Set a un array: mientras matamos, los procesos van saliendo del Set
  //   y no queremos modificar la colección que estamos recorriendo.

  for (const proc of vivos) {
    try {
      proc.kill("SIGTERM");
    } catch {
      /* el proceso puede haber terminado justo antes */
    }
  }
  // ↑ Primer intento: SIGTERM (pedido "amable" de terminar) a TODOS los lotes.
  // Si a los 2s alguno sigue vivo (algunos procesos ignoran SIGTERM), forzamos SIGKILL.
  setTimeout(() => {
    for (const proc of vivos) {
      try {
        proc.kill("SIGKILL");
      } catch {
        /* ya terminó */
      }
    }
  }, 2000);
  // ↑ Segundo intento: SIGKILL (terminación forzosa del sistema) sobre los que sigan vivos.
  return true;
}

/**
 * Resuelve el binario real de opencode.
 *
 * En Windows, `npm` instala un shim (opencode / opencode.cmd / opencode.ps1)
 * que Node NO puede ejecutar directo con shell:false (ENOENT/EINVAL). El shim
 * apunta al .exe real. Estrategia:
 *   1) OPENCODE_BIN env (override explícito).
 *   2) Buscar "opencode.exe" real vía `where.exe opencode` o derivándolo del shim.
 *   3) Fallback: "opencode" (funciona en macOS/Linux y si es un binario real).
 */
function resolverBinario() {
  if (process.env.OPENCODE_BIN && fs.existsSync(process.env.OPENCODE_BIN)) {
    return process.env.OPENCODE_BIN;
  }
  // ↑ Opción 1: el usuario puede forzar la ruta exacta del binario con la env OPENCODE_BIN.

  if (process.platform === "win32") {
    // ↑ Solo en Windows necesitamos cazar el .exe real; en Linux/macOS "opencode" ya funciona.
    try {
      const salida = execFileSync("where.exe", ["opencode"], {
        encoding: "utf8",
        windowsHide: true,
      });
      for (const linea of salida.split(/\r?\n/)) {
        const ruta = linea.trim();
        if (!ruta) continue;
        // Ya es un .exe real → usarlo.
        if (ruta.toLowerCase().endsWith(".exe") && fs.existsSync(ruta)) return ruta;
        // Es un shim de npm → el .exe vive en .../node_modules/opencode-ai/bin/.
        const candidato = path.resolve(
          path.dirname(ruta),
          "node_modules",
          "opencode-ai",
          "bin",
          "opencode.exe"
        );
        if (fs.existsSync(candidato)) return candidato;
      }
      // ↑ where.exe lista las rutas en PATH; probamos cada línea hasta encontrar el .exe.
    } catch {
      // where.exe no encontró opencode; se intenta el fallback de abajo.
    }
  }

  return "opencode";
  // ↑ Fallback: dejar que el sistema resuelva "opencode" (caso Linux/macOS).
}

/**
 * Ejecuta opencode con la query dada sobre UN lote de tiendas.
 * Devuelve { stdout, stderr, code }.
 */
function ejecutarProceso(query, tiendas) {
  return new Promise((resolve, reject) => {
    // ↑ El patrón promise + executors: el trabajo pesado (spawn, eventos) envuelto en una promesa.
    // Si no se pasan tiendas, usar la lista completa por defecto.
    const listaTiendas = Array.isArray(tiendas) && tiendas.length > 0
      ? tiendas
      : TIENDAS_MENSAJE;

    // Mensaje corto que empuja la delegación determinística al subagente
    // especializado (que tiene el prompt completo y responde el JSON).
    const mensaje =
      `Compará precios del producto "${query}" en las tiendas argentinas ` +
      `${listaTiendas.join(", ")}. Usá la herramienta Task con subagent_type ` +
      `"comparador-precios-ar" y devolvé la información que te devuelva ese subagente.`;
    // ↑ El "prompt" que recibe el agente principal: le dice que delega en el subagente vía Task.
    //   Con batching, este mensaje solo nombra las tiendas DEL LOTE (no las 37).

    const args = [
      "run",
      mensaje,
      "--format",
      "json",
      "--dir",
      cache.RAIZ,
    ];
    // ↑ Argumentos: opencode run "<mensaje>" --format json --dir <raíz del proyecto>.

    let proc;
    try {
      proc = spawn(resolverBinario(), args, {
        cwd: cache.RAIZ,
        windowsHide: true,
        shell: false,
        // stdin cerrado: si opencode pidiera permiso interactivo, no se cuelga.
        // (los prompts de permisos se resuelven solos sin input bloqueante)
        stdio: ["ignore", "pipe", "pipe"],
      });
      // ↑ spawn lanza el proceso con stdin ignorado y stdout/stderr capturados como pipes.
    } catch (err) {
      return reject(new Error(`No se pudo lanzar opencode: ${err.message}`));
    }

    // Se registra el proceso para que cancelarActual() pueda matarlo desde afuera.
    procesosActivos.add(proc);
    // ↑ Cada lote agrega SU proceso al registro; pueden convivir varios (batching).

    let stdout = "";
    let stderr = "";
    // ↑ Acumuladores del texto que opencode va imprimiendo.
    let terminado = false;
    // ↑ Bandera para ejecutar la resolución/rechazo SOLO la primera vez (evita dobles llamadas).

    const limpiar = () => {
      procesosActivos.delete(proc);
    };
    // ↑ Al terminar, sacamos el proceso del registro para que cancelarActual() no lo cuente como vivo.

    const timer = setTimeout(() => {
      if (terminado) return;
      terminado = true;
      try { proc.kill(); } catch { /* sin importar */ }
      limpiar();
      reject(new Error("El agente de opencode tardó demasiado (timeout). Probá de nuevo más tarde."));
    }, TIMEOUT_DEFAULT_MS);
    // ↑ Si ESTE lote supera el timeout (600 s), lo matamos y rechazamos con un mensaje claro.

    proc.stdout.on("data", (d) => { stdout += d.toString("utf8"); });
    proc.stderr.on("data", (d) => { stderr += d.toString("utf8"); });
    // ↑ Eventos "data": pedacitos de salida del proceso que vamos acumulando como strings.

    proc.on("error", (err) => {
      if (terminado) return;
      terminado = true;
      clearTimeout(timer);
      limpiar();
      reject(new Error(`No se pudo ejecutar opencode: ${err.message}. ¿Está "opencode" en el PATH?`));
    });
    // ↑ Si Node ni siquiera pudo lanzar el binario (ej. no está en el PATH) llegamos a "error".

    proc.on("close", (code) => {
      if (terminado) return;
      terminado = true;
      clearTimeout(timer);
      const fueCancelado = cancelado;
      // ↑ Leemos la bandera compartida: si se canceló la BÚSQUEDA, todos los lotes se consideran cancelados.
      limpiar();
      if (fueCancelado) {
        const err = new Error("Búsqueda cancelada por el usuario.");
        err.cancelado = true;
        return reject(err);
      }
      // ↑ Si la persona pidió cancelar, rechazamos con err.cancelado=true para que el
      // server.js responda 499 en vez de 502.
      resolve({ stdout, stderr, code });
      // ↑ Cierre normal: resolvemos con la salida capturada y el código de salida.
    });
  });
}

/** Recorre el NDJSON y devuelve todos los textos del agente (eventos de tipo text y salida del tool task). */
function recolectarTextos(stdout) {
  const textos = [];
  for (const linea of stdout.split(/\r?\n/)) {
    if (!linea.trim()) continue;
    let ev;
    try {
      ev = JSON.parse(linea);
    } catch {
      continue; // líneas que no son JSON (ruido) se ignoran
    }
    // ↑ opencode emite NDJSON: una línea = un objeto JSON. Las líneas inválidas se saltan.
    const part = ev.part;
    if (!part) continue;

    if (part.type === "text" && typeof part.text === "string") {
      textos.push(part.text);
    }
    // ↑ Evento "text": el agente principal habla (mensajes normales de la conversación).
    if (ev.type === "tool_use" && part.tool === "task" && part.state && typeof part.state.output === "string") {
      textos.push(part.state.output);
    }
    // ↑ Evento "tool_use" de la tool Task: ahí sale la respuesta del subagente (state.output).
  }
  return textos;
}

/**
 * Extrae el primer objeto JSON {...} completo de un texto.
 * Devuelve el objeto parseado o null.
 */
function extraerJson(texto) {
  if (typeof texto !== "string" || !texto.includes("{")) return null;
  const ini = texto.indexOf("{");
  const fin = texto.lastIndexOf("}");
  if (fin <= ini) return null;
  // ↑ Busca el primer { y el último } como candidatos del objeto JSON completo.

  // Intenta con el primer { y el último }; si falla, prueba desplazando el inicio.
  let candidato = texto.slice(ini, fin + 1);
  try {
    return JSON.parse(candidato);
  } catch {
    let inicio = ini;
    while (inicio < texto.length && inicio < fin) {
      inicio = texto.indexOf("{", inicio + 1);
      if (inicio === -1 || inicio >= fin) break;
      try {
        return JSON.parse(texto.slice(inicio, fin + 1));
      } catch {
        /* seguir buscando */
      }
    }
    // ↑ Si el primer intento falla, desplaza el inicio hacia adelante buscando otro { válido.
  }
  return null;
}

/**
 * Interpreta la salida de UN lote: junta los textos y devuelve el JSON del contrato.
 * Tira Error si el lote no devolvió nada interpretable → el llamador lo trata como
 * "lote fallido", NO como fallo de toda la búsqueda.
 */
function interpretarSalida(stdout, code, stderr) {
  const textos = recolectarTextos(stdout);
  if (textos.length === 0) {
    const detalle = stderr ? ` Detalle: ${String(stderr).slice(0, 300)}` : "";
    throw new Error(`El agente no devolvió ninguna respuesta (código ${code}).${detalle}`);
  }
  // ↑ Si no llegó ningún texto del agente, algo falló: error con el detalle de stderr.

  // Tomamos el último texto que contenga JSON (el del mensaje final, o el del tool task).
  let resultado = null;
  for (let i = textos.length - 1; i >= 0; i--) {
    resultado = extraerJson(textos[i]);
    if (resultado && Array.isArray(resultado.ofertas)) break;
    if (resultado) break;
  }
  // ↑ Buscamos de atrás hacia adelante el JSON con forma de contrato (que tenga "ofertas").

  if (!resultado) {
    throw new Error("El agente respondió pero no se pudo interpretar su JSON con ofertas. Reintentá.");
  }
  return resultado;
}

/**
 * Parte una lista en lotes consecutivos de a lo sumo `tamano` elementos.
 * Función PURA (no toca procesos ni red) → fácil de testear.
 * Ej: partirEnLotes([1..37], 6) → 6 lotes de 6 + 1 lote de 1.
 */
function partirEnLotes(lista, tamano) {
  if (!Array.isArray(lista) || lista.length === 0) return [];
  // ↑ Sin tiendas no hay lotes que armar.
  const n = Number.isInteger(tamano) && tamano >= 1 ? tamano : BATCH_SIZE;
  // ↑ Si el tamaño no es un entero válido (0, negativo, NaN), caemos al valor por defecto.
  const lotes = [];
  for (let i = 0; i < lista.length; i += n) {
    lotes.push(lista.slice(i, i + n));
  }
  // ↑ slice(i, i+n) corta un pedazo sin modificar la lista original. El último puede venir más corto.
  return lotes;
}

/** ¿La oferta sirve para comparar precios? (disponible y con precio positivo) */
function ofertaUtil(oferta) {
  return Boolean(oferta) && oferta.available === true && typeof oferta.price === "number" && oferta.price > 0;
}

/** De dos ofertas de la MISMA tienda elige la mejor: la disponible y, si empatan, la más barata. */
function mejorOferta(a, b) {
  const utilA = ofertaUtil(a);
  const utilB = ofertaUtil(b);
  if (utilA && utilB) return a.price <= b.price ? a : b;
  // ↑ Las dos sirven: gana la de menor precio.
  if (utilA) return a;
  if (utilB) return b;
  return a;
  // ↑ Si ninguna sirve, conservamos la primera (queda como available:false).
}

/**
 * Fusiona los resultados de TODOS los lotes en un único objeto con el contrato
 * del agente. Función PURA → fácil de testear.
 *
 * `resultados`: [{ ok: true, json, lote } | { ok: false, error, lote }]
 */
function fusionarResultados(resultados) {
  const entradas = (Array.isArray(resultados) ? resultados : []).filter(
    (r) => r && typeof r === "object" && !r.cancelado
  );
  // ↑ Ignoramos huecos del array y lotes cancelados (la cancelación se maneja aparte).
  const exitosos = entradas.filter((r) => r.ok && r.json);

  const tiendasConsultadas = [];
  const vistas = new Set();
  const ofertasPorTienda = new Map();
  // ↑ Map: clave normalizada de la tienda → la mejor oferta vista hasta ahora.
  const notas = [];
  let queryOriginal = "";
  let sinNombre = 0;
  // ↑ Contador para ofertas sin nombre de tienda (no queremos pisarlas entre sí).

  for (const entrada of exitosos) {
    const json = entrada.json;

    if (!queryOriginal && typeof json.queryOriginal === "string") {
      queryOriginal = json.queryOriginal;
    }
    // ↑ Nos quedamos con el primer queryOriginal no vacío (todos los lotes comparten la misma query).

    if (Array.isArray(json.tiendasConsultadas)) {
      for (const tienda of json.tiendasConsultadas) {
        const clave = slugLib.normalizar(String(tienda || ""));
        if (!clave || vistas.has(clave)) continue;
        vistas.add(clave);
        tiendasConsultadas.push(tienda);
      }
    }
    // ↑ Unión de tiendas consultadas: sin repetir y conservando el orden de primera aparición.

    if (Array.isArray(json.ofertas)) {
      for (const oferta of json.ofertas) {
        if (!oferta || typeof oferta !== "object") continue;
        const clave = slugLib.normalizar(String(oferta.store || ""));
        // ↑ La clave de dedupe ignora mayúsculas Y acentos: "SOS Computación" === "SOS Computacion".
        const id = clave || `__sin_nombre_${sinNombre++}`;
        if (ofertasPorTienda.has(id)) {
          ofertasPorTienda.set(id, mejorOferta(ofertasPorTienda.get(id), oferta));
        } else {
          ofertasPorTienda.set(id, oferta);
        }
      }
    }
    // ↑ Cada tienda aparece UNA sola vez en el resultado final, aunque dos lotes la hubieran consultado.

    if (typeof json.nota === "string" && json.nota.trim()) {
      notas.push(json.nota.trim());
    }
  }

  const fallidos = entradas.filter((r) => !r.ok);
  let nota = notas.join(" | ");
  if (fallidos.length > 0) {
    const motivo = String(fallidos[0].error?.message || "")
      .split(". ")[0] // nos quedamos solo con la primera oración del error
      .replace(/\.$/, "") // y le sacamos el punto final
      .slice(0, 120);
    // ↑ El motivo se usa tal cual (sin paréntesis), así el texto no anida signos de puntuación.
    const frase = motivo
      ? `Lote(s) con error: ${fallidos.length} de ${entradas.length}: ${motivo}.`
      : `Lote(s) con error: ${fallidos.length} de ${entradas.length}.`;
    nota = nota ? `${nota} | ${frase}` : frase;
  }
  // ↑ Si algún lote falló, lo dejamos dicho en la nota para que el usuario sepa que faltó cubrir tiendas.

  return {
    queryOriginal,
    tiendasConsultadas,
    ofertas: [...ofertasPorTienda.values()],
    nota,
  };
}

/**
 * Flujo completo: parte la lista en lotes, corre hasta CONCURRENCIA procesos de
 * opencode en paralelo y devuelve el JSON del contrato fusionado.
 * Lanza un Error con mensaje claro si NINGÚN lote pudo devolver resultados.
 */
async function buscar(query, tiendas) {
  cancelado = false;
  // ↑ Arrancamos una búsqueda nueva: limpiamos la bandera de cancelación de la anterior.

  const lista = Array.isArray(tiendas) && tiendas.length > 0 ? tiendas : TIENDAS_MENSAJE;
  const lotes = partirEnLotes(lista, BATCH_SIZE);
  if (lotes.length === 0) {
    throw new Error("No hay tiendas para consultar.");
  }

  const workers = Math.min(CONCURRENCIA, lotes.length);
  // ↑ No tiene sentido lanzar más workers que lotes.
  console.log(
    `[MejorCompras] Búsqueda "${query}": ${lista.length} tiendas → ${lotes.length} lote(s) de hasta ${BATCH_SIZE}, ${workers} en paralelo.`
  );

  const resultados = new Array(lotes.length);
  // ↑ Un casillero por lote: puede quedar hueco si se corta antes de repartir todos.
  let siguiente = 0;
  let tiempoAgotado = false;

  const watchdog = setTimeout(() => {
    tiempoAgotado = true;
    console.error(
      `[MejorCompras] Tiempo total de búsqueda agotado (${TIMEOUT_TOTAL_DEFAULT_MS} ms): matando los procesos activos.`
    );
    for (const proc of [...procesosActivos]) {
      try { proc.kill("SIGKILL"); } catch { /* ya terminó */ }
    }
  }, TIMEOUT_TOTAL_DEFAULT_MS);
  // ↑ Red de seguridad de la búsqueda COMPLETA: si se pasa, corta todo de raíz.

  const trabajar = async () => {
    while (true) {
      if (cancelado || tiempoAgotado) return;
      // ↑ Cortamos sin tomar más lotes si se canceló o si se agotó el tiempo total.
      const indice = siguiente++;
      // ↑ `siguiente++` es seguro en Node (un solo hilo): cada worker se queda con un lote distinto.
      if (indice >= lotes.length) return;
      // ↑ No quedan lotes por repartir: este worker se retira.

      const lote = lotes[indice];
      try {
        const { stdout, stderr, code } = await ejecutarProceso(query, lote);
        const json = interpretarSalida(stdout, code, stderr);
        const cantidad = Array.isArray(json.ofertas) ? json.ofertas.length : 0;
        console.log(
          `[MejorCompras] Lote ${indice + 1}/${lotes.length} (${lote.length} tiendas) → ${cantidad} ofertas`
        );
        resultados[indice] = { ok: true, json, lote: indice + 1 };
      } catch (err) {
        if (err.cancelado) {
          resultados[indice] = { ok: false, error: err, lote: indice + 1, cancelado: true };
          return;
          // ↑ Cancelación: marcamos el lote y salimos sin seguir tomando lotes.
        }
        console.log(`[MejorCompras] Lote ${indice + 1}/${lotes.length} falló: ${err.message}`);
        resultados[indice] = { ok: false, error: err, lote: indice + 1 };
        // ↑ Un lote fallido NO aborta la búsqueda: los demás siguen y se fusiona lo que haya.
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: workers }, () => trabajar()));
    // ↑ Lanzamos `workers` "trabajadores" que se reparten los lotes de la cola compartida.
  } finally {
    clearTimeout(watchdog);
    // ↑ Pase lo que pase (éxito, error o cancelación), no dejamos el watchdog colgado.
  }

  const completos = resultados.filter(Boolean);

  if (cancelado || completos.some((r) => r.cancelado)) {
    const err = new Error("Búsqueda cancelada por el usuario.");
    err.cancelado = true;
    throw err;
    // ↑ Mismo contrato que antes: server.js responde 499.
  }
  if (tiempoAgotado) {
    throw new Error(
      `La búsqueda superó el tiempo máximo total (${Math.round(TIMEOUT_TOTAL_DEFAULT_MS / 60000)} min). Probá con menos tiendas.`
    );
  }
  if (!completos.some((r) => r.ok)) {
    const primero = completos.find((r) => !r.ok);
    throw new Error(primero?.error?.message || "El agente de precios falló.");
    // ↑ Si TODOS los lotes fallaron, recién ahí la búsqueda entera falla (server.js responde 502).
  }

  return fusionarResultados(completos);
  // ↑ Fusionamos los lotes exitosos en un único resultado con el contrato del agente.
}

module.exports = {
  ejecutarProceso,
  recolectarTextos,
  extraerJson,
  interpretarSalida,
  partirEnLotes,
  fusionarResultados,
  buscar,
  resolverBinario,
  cancelarActual,
  AGENTE,
  TIMEOUT_DEFAULT_MS,
  TIMEOUT_TOTAL_DEFAULT_MS,
  BATCH_SIZE,
  CONCURRENCIA,
  TIENDAS_MENSAJE,
};
// ↑ Exportamos casi todo: buscar/cancelarActual los usa server.js; partirEnLotes y
// fusionarResultados quedan afuera para poder testear la lógica sin lanzar opencode.
