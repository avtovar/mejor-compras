"use strict";

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
 */

const { spawn, execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const cache = require("./cache");

const AGENTE = "comparador-precios-ar";
const TIMEOUT_DEFAULT_MS = Number(process.env.OPENCODE_TIMEOUT_MS || 360000);

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

  if (process.platform === "win32") {
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
    } catch {
      // where.exe no encontró opencode; se intenta el fallback de abajo.
    }
  }

  return "opencode";
}

/**
 * Ejecuta opencode con la query dada.
 * Devuelve { stdout, stderr, code }.
 */
function ejecutarProceso(query) {
  return new Promise((resolve, reject) => {
    // Mensaje corto que empuja la delegación determinística al subagente
    // especializado (que tiene el prompt completo y responde el JSON).
    const mensaje =
      `Compará precios del producto "${query}" en las tiendas argentinas Naldo, ` +
      `Carrefour y Coto. Usá la herramienta Task con subagent_type "comparador-precios-ar" ` +
      `y devolvé la información que te devuelva ese subagente.`;
    const args = [
      "run",
      mensaje,
      "--format",
      "json",
      "--dir",
      cache.RAIZ,
    ];

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
    } catch (err) {
      return reject(new Error(`No se pudo lanzar opencode: ${err.message}`));
    }

    let stdout = "";
    let stderr = "";
    let terminado = false;

    const timer = setTimeout(() => {
      if (terminado) return;
      terminado = true;
      try { proc.kill(); } catch { /* sin importar */ }
      reject(new Error("El agente de opencode tardó demasiado (timeout). Probá de nuevo más tarde."));
    }, TIMEOUT_DEFAULT_MS);

    proc.stdout.on("data", (d) => { stdout += d.toString("utf8"); });
    proc.stderr.on("data", (d) => { stderr += d.toString("utf8"); });
    proc.on("error", (err) => {
      if (terminado) return;
      terminado = true;
      clearTimeout(timer);
      reject(new Error(`No se pudo ejecutar opencode: ${err.message}. ¿Está "opencode" en el PATH?`));
    });
    proc.on("close", (code) => {
      if (terminado) return;
      terminado = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
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
    const part = ev.part;
    if (!part) continue;

    if (part.type === "text" && typeof part.text === "string") {
      textos.push(part.text);
    }
    if (ev.type === "tool_use" && part.tool === "task" && part.state && typeof part.state.output === "string") {
      textos.push(part.state.output);
    }
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
  }
  return null;
}

/**
 * Flujo completo: ejecuta el agente y devuelve el objeto JSON de su contrato.
 * Lanza un Error con mensaje claro si algo falla.
 */
async function buscar(query) {
  const { stdout, stderr, code } = await ejecutarProceso(query);

  const textos = recolectarTextos(stdout);
  if (textos.length === 0) {
    const detalle = stderr ? ` Detalle: ${stderr.slice(0, 300)}` : "";
    throw new Error(`El agente no devolvió ninguna respuesta (código ${code}).${detalle}`);
  }

  // Tomamos el último texto que contenga JSON (el del mensaje final, o el del tool task).
  let resultado = null;
  for (let i = textos.length - 1; i >= 0; i--) {
    resultado = extraerJson(textos[i]);
    if (resultado && Array.isArray(resultado.ofertas)) break;
    if (resultado) break;
  }

  if (!resultado) {
    throw new Error("El agente respondió pero no se pudo interpretar su JSON con ofertas. Reintentá.");
  }
  return resultado;
}

module.exports = { ejecutarProceso, recolectarTextos, extraerJson, buscar, resolverBinario, AGENTE, TIMEOUT_DEFAULT_MS };