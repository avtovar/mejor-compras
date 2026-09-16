"use strict";

/* ============================================================
   MejorCompras — lógica del frontend (vanilla JS)
   Consume la API del backend: /api/search, /api/history, /api/stores
   ============================================================ */

const $ = (sel) => document.querySelector(sel);

const form = $("#form-buscar");
const input = $("#input-query");
const btnBuscar = $("#btn-buscar");
const estado = $("#estado");
const estadoTexto = $("#estado-texto");
const avisoCache = $("#aviso-cache");
const avisoError = $("#aviso-error");
const resultado = $("#resultado");
const mejorOpcion = $("#mejor-opcion");
const mejorTitulo = $("#mejor-titulo");
const mejorTienda = $("#mejor-tienda");
const mejorPrecio = $("#mejor-precio");
const mejorMotivo = $("#mejor-motivo");
const mejorEnlace = $("#mejor-enlace");
const gridTiendas = $("#grid-tiendas");
const notaAgente = $("#nota-agente");
const listaHistorial = $("#lista-historial");
const historialVacio = $("#historial-vacio");

/** Formatea un número como pesos argentinos: 269988 → "$ 269.988" */
function formatearPrecio(numero) {
  if (numero === null || numero === undefined || isNaN(numero)) return "Precio no disponible";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(numero);
}

/** Formatea una fecha ISO a un texto corto local. */
function formatearFecha(iso) {
  try {
    return new Date(iso).toLocaleString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function mostrarEstado(texto) {
  estadoTexto.textContent = texto;
  estado.hidden = false;
}

function ocultarEstado() {
  estado.hidden = true;
}

function mostrarError(mensaje) {
  avisoError.textContent = mensaje;
  avisoError.hidden = false;
  setTimeout(() => { avisoError.hidden = true; }, 8000);
}

function ocultarAvisos() {
  avisoCache.hidden = true;
  avisoError.hidden = true;
}

/** Pinta el resultado completo (mejor opción + cards por tienda + nota). */
function pintarResultado(datos) {
  resultado.hidden = false;
  notaAgente.hidden = true;

  // ---- Mejor opción ----
  if (datos.mejorOpcion) {
    const m = datos.mejorOpcion;
    mejorTitulo.textContent = m.title || "Sin título";
    mejorTienda.textContent = `Tienda: ${m.store}`;
    mejorPrecio.textContent = formatearPrecio(m.price);
    mejorMotivo.textContent = m.motivo || "Menor precio entre las ofertas disponibles";
    mejorEnlace.href = m.url || "#";
    mejorOpcion.hidden = false;
  } else {
    mejorOpcion.hidden = true;
  }

  // ---- Cards por tienda ----
  gridTiendas.innerHTML = "";
  const ofertas = Array.isArray(datos.ofertas) ? datos.ofertas : [];
  if (ofertas.length === 0) {
    gridTiendas.innerHTML =
      '<p class="nota">No se encontraron ofertas. ' +
      (datos.nota ? datos.nota : "Probá con otra búsqueda.") + "</p>";
  } else {
    for (const o of ofertas) {
      const card = document.createElement("article");
      card.className = "card card-tienda";

      const nombreTienda = document.createElement("h4");
      nombreTienda.textContent = o.store || "Tienda";

      const titulo = document.createElement("p");
      titulo.className = "titulo-producto";
      titulo.textContent = o.title || "Sin título";

      card.append(nombreTienda, titulo);

      if (o.available && typeof o.price === "number") {
        const precio = document.createElement("p");
        precio.className = "precio";
        precio.textContent = formatearPrecio(o.price);
        card.append(precio);

        const enlace = document.createElement("a");
        enlace.className = "btn";
        enlace.href = o.url || "#";
        enlace.target = "_blank";
        enlace.rel = "noopener noreferrer";
        enlace.textContent = "Ver oferta";
        card.append(enlace);
      } else {
        const nd = document.createElement("p");
        nd.className = "no-disponible";
        nd.textContent = "Sin oferta disponible en esta tienda.";
        card.append(nd);
      }

      gridTiendas.append(card);
    }
  }

  // ---- Nota del agente ----
  if (datos.nota) {
    notaAgente.textContent = `📝 Nota del agente: ${datos.nota}`;
    notaAgente.hidden = false;
  }

  // ---- Aviso de cache ----
  if (datos.fromCache) {
    avisoCache.textContent = `📦 Resultado guardado (cache de ${formatearFecha(datos.fecha)}).`;
    avisoCache.hidden = false;
  }
}

/** Ejecuta una búsqueda contra el backend. */
async function buscar(query, fuerza) {
  ocultarAvisos();
  resultado.hidden = true;
  mejorOpcion.hidden = true;

  btnBuscar.disabled = true;
  mostrarEstado(
    fuerza
      ? "Refrescando con IA: buscando en Naldo, Carrefour y Coto con agentes…"
      : "Buscando en Naldo, Carrefour y Coto con agentes…"
  );

  try {
    const resp = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, force: Boolean(fuerza) }),
    });
    const datos = await resp.json();

    if (!resp.ok) {
      throw new Error(datos.error || "Algo salió mal en la búsqueda.");
    }
    pintarResultado(datos);
    cargarHistorial();
  } catch (err) {
    mostrarError(`⚠️ ${err.message}`);
  } finally {
    ocultarEstado();
    btnBuscar.disabled = false;
  }
}

/** Carga y pinta el historial de búsquedas guardadas. */
async function cargarHistorial() {
  try {
    const resp = await fetch("/api/history");
    const items = await resp.json();
    listaHistorial.innerHTML = "";

    if (!Array.isArray(items) || items.length === 0) {
      historialVacio.hidden = false;
      return;
    }
    historialVacio.hidden = true;

    for (const item of items) {
      const li = document.createElement("li");

      const info = document.createElement("div");
      info.className = "info";

      const query = document.createElement("span");
      query.className = "query";
      query.textContent = item.query;

      const meta = document.createElement("span");
      meta.className = "meta";
      const tiendas = Array.isArray(item.tiendas) && item.tiendas.length
        ? item.tiendas.join(", ")
        : "sin ofertas";
      meta.textContent = `${tiendas} · ${item.cantidad ?? 0} ofertas · ${formatearFecha(item.fecha)}`;

      info.append(query, meta);

      const acciones = document.createElement("div");
      acciones.className = "acciones";

      const botonVer = document.createElement("button");
      botonVer.textContent = "Ver";
      botonVer.title = "Mostrar el resultado guardado";
      botonVer.addEventListener("click", async () => {
        ocultarAvisos();
        input.value = item.query;
        try {
          const r = await fetch(`/api/search/${item.slug}`);
          const datos = await r.json();
          if (!r.ok) throw new Error(datos.error || "No se pudo recuperar la búsqueda.");
          pintarResultado(datos);
        } catch (err) {
          mostrarError(`⚠️ ${err.message}`);
        }
      });

      const botonActualizar = document.createElement("button");
      botonActualizar.textContent = "Actualizar";
      botonActualizar.title = "Volver a buscar con IA (fuerza refresh de la cache)";
      botonActualizar.addEventListener("click", () => buscar(item.query, true));

      acciones.append(botonVer, botonActualizar);
      li.append(info, acciones);
      listaHistorial.append(li);
    }
  } catch {
    // Si no carga el historial, no es bloqueante.
  }
}

// ---------------- Arranque ----------------

form.addEventListener("submit", (ev) => {
  ev.preventDefault();
  const query = input.value.trim();
  if (!query) {
    input.focus();
    return;
  }
  buscar(query, false);
});

cargarHistorial();