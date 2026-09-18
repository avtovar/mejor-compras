/* ============================================================
   MejorCompras — Lógica Premium (Frontend)
   ============================================================
   ↑ Todo el comportamiento de la página: buscar, renderizar,
   filtrar, historial, tema y administrar tiendas. Se carga desde
   index.html con <script src="app.js"> al final del <body>. */

"use strict";
// ↑ Modo estricto de JS: evita errores silenciosos y código inseguro.

const $ = (sel) => document.querySelector(sel);
// ↑ Atajo para seleccionar UN elemento con un selector CSS (querySelector).
const $$ = (sel) => document.querySelectorAll(sel);
// ↑ Atajo para seleccionar TODOS los elementos que coincidan (devuelve NodeList).

// Elementos Globales
const body = document.body;
const btnTema = $("#btn-tema");
const form = $("#form-buscar");
const input = $("#input-query");
const btnBuscar = $("#btn-buscar");
const btnCancelar = $("#btn-cancelar");
const selectorTiendas = $("#selector-tiendas");
const btnTodas = $("#btn-todas");
const btnNinguna = $("#btn-ninguna");
// ↑ Referencias a los elementos del HTML que vamos a tocar. Al buscarlos una vez
// al inicio, no hace falta repetir document.querySelector en cada función.

// Elementos del formulario "Agregar tienda"
const btnAgregarTienda = $("#btn-agregar-tienda");
const formAgregarTienda = $("#form-agregar-tienda");
const inputNuevaTienda = $("#input-nueva-tienda");
const inputNuevaUrl = $("#input-nueva-url");
const btnCancelarAgregar = $("#btn-cancelar-agregar");
const msgAgregarTienda = $("#msg-agregar-tienda");
// ↑ Referencias para el alta de tiendas nuevas a través de POST /api/stores.

const estado = $("#estado");
const avisoError = $("#aviso-error");
const errorTexto = $("#error-texto");
const avisoCache = $("#aviso-cache");
const cacheTexto = $("#cache-texto");
const avisoTiendas = $("#aviso-tiendas");
const tiendasTexto = $("#tiendas-texto");
// ↑ Overlay de carga + banners de error, de aviso (cache) y de "demasiadas tiendas".

const resultado = $("#resultado");
const mejorOpcionCard = $("#mejor-opcion-card");
const mejorTitulo = $("#mejor-titulo");
const mejorTienda = $("#mejor-tienda");
const mejorPrecio = $("#mejor-precio");
const mejorEnlace = $("#mejor-enlace");
// ↑ Bloque "MEJOR OPCIÓN": tarjeta destacada con el ganador.

const statMin = $("#stat-min");
const statAvg = $("#stat-avg");
const statMax = $("#stat-max");
const statAhorro = $("#stat-ahorro");
// ↑ Las 4 estadísticas del dashboard (mínimo, promedio, máximo, ahorro).

const conteoOfertas = $("#conteo-ofertas");
const filtroDisponibles = $("#filtro-disponibles");
const ordenOfertas = $("#orden-ofertas");
const gridTiendas = $("#grid-tiendas");
const notaAgente = $("#nota-agente");
const notaTexto = $("#nota-texto");
// ↑ Toolbar de filtros/orden + el grid de tarjetas + la nota del agente.

const listaHistorial = $("#lista-historial");
const historialVacio = $("#historial-vacio");
// ↑ Sección de historial del cache.

// Estado de la Aplicación
let ultimaRespuesta = null; // Datos crudos del servidor
// ↑ Guarda la última respuesta de /api/search para recalcular filtros sin volver a pedir.
let tiendasDisponibles = []; // Nombres de tiendas cargados de /api/stores
let tiendasSeleccionadas = new Set();
// ↑ Set (colección sin repetidos) con las tiendas que el usuario dejó marcadas.
const MAX_TIENDAS_RECOMENDADAS = 24;
// ↑ Umbral de tiendas por búsqueda. El backend busca en lotes de 6 tiendas, hasta 4 lotes a la vez:
//   6 × 4 = 24 tiendas caben en UNA sola tanda. Pasado ese número hace falta una segunda tanda
//   (y una tercera, etc.), así que la espera crece: con 25+ conviene avisar al usuario.
let controladorActual = null;
// ↑ Referencia al AbortController activo, para poder cancelar la búsqueda.

/* ============================================================
   Utilidades
   ============================================================ */

function formatearPrecio(numero) {
  if (numero === null || numero === undefined || isNaN(numero)) return "N/D";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(numero);
  // ↑ Intl.NumberFormat formatea como moneda argentina: $ 123.456 (sin decimales).
}

function formatearFecha(iso) {
  try {
    return new Date(iso).toLocaleString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    // ↑ Convierte una fecha ISO ("2026-09-15T14:30:00Z") en algo legible: 15/09/2026 14:30.
  } catch { return iso; }
}

function refrescarIconos() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
  // ↑ lucide reemplaza los <i data-lucide="..."> por el SVG real. Hay que llamarlo
  // cada vez que el DOM cambia; si no, los íconos nuevos quedan vacíos.
}

/* ============================================================
   Gestión de Temas (Dark/Light)
   ============================================================ */

function toggleTema() {
  const actual = body.getAttribute("data-theme");
  const nuevo = actual === "dark" ? "light" : "dark";
  body.setAttribute("data-theme", nuevo);
  localStorage.setItem("mejorcompras-theme", nuevo);
  // ↑ Cambia el atributo data-theme del body (el CSS reacciona) y guarda en localStorage.
}

function initTema() {
  const guardado = localStorage.getItem("mejorcompras-theme");
  if (guardado) {
    body.setAttribute("data-theme", guardado);
  } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
    body.setAttribute("data-theme", "dark");
  }
  // ↑ Al cargar: usa la preferencia guardada, o si no la hay, la del sistema operativo.
}

/* ============================================================
   Selector de Tiendas
   ============================================================ */

async function cargarConfiguracion() {
  try {
    const resp = await fetch("/api/stores");
    const datos = await resp.json();
    tiendasDisponibles = datos.tiendas || [];
    // ↑ FIX: el backend responde { tiendas: [...] }, así que guardamos SOLO el array
    // (antes se guardaba el objeto entero y el selector no cargaba).
    
    // Recuperar seleccion previa o marcar todas por defecto
    const guardadas = localStorage.getItem("mejorcompras-stores");
    if (guardadas) {
      const parsed = JSON.parse(guardadas);
      tiendasSeleccionadas = new Set(parsed);
    } else {
      tiendasSeleccionadas = new Set(tiendasDisponibles.map(t => t.nombre));
    }
    // ↑ Si el usuario ya eligió tiendas antes, se recuperan; si no, se marcan todas.
    // (Usamos `t.nombre`, el campo real que manda el backend, no `t.name`).

    renderSelectorTiendas();
  } catch (err) {
    selectorTiendas.innerHTML = '<p class="error">Error cargando tiendas.</p>';
  }
}

function renderSelectorTiendas() {
  selectorTiendas.innerHTML = "";
  // ↑ Vacía el contenedor para re-dibujar desde cero.
  tiendasDisponibles.forEach(tienda => {
    const nombre = tienda.nombre;
    const label = document.createElement("label");
    label.className = `tienda-check ${tiendasSeleccionadas.has(nombre) ? "selected" : ""}`;
    // ↑ Template string: arma la clase según si la tienda está en el Set.
    
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = tiendasSeleccionadas.has(nombre);
    input.addEventListener("change", (e) => {
      if (e.target.checked) {
        tiendasSeleccionadas.add(nombre);
        label.classList.add("selected");
      } else {
        tiendasSeleccionadas.delete(nombre);
        label.classList.remove("selected");
      }
      persistirSeleccion();
      // ↑ Cada cambio del checkbox actualiza el Set, la clase visual y localStorage.
    });
    
    const btnQuitar = document.createElement("button");
    btnQuitar.type = "button";
    btnQuitar.className = "btn-quitar";
    btnQuitar.title = `Eliminar ${nombre}`;
    btnQuitar.textContent = "×";
    btnQuitar.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      eliminarTienda(tienda, label);
      // ↑ La "×" elimina la tienda. stopPropagation impide que el clic togglee el checkbox.
    });
    // ↑ Botón chico "×" en cada chip para borrar la tienda de la configuración.

    label.append(input, document.createTextNode(nombre), btnQuitar);
    selectorTiendas.appendChild(label);
  });

  actualizarAvisoTiendas();
  // ↑ Al terminar de pintar los chips, actualizamos el aviso de "demasiadas tiendas".
}

function persistirSeleccion() {
  localStorage.setItem("mejorcompras-stores", JSON.stringify([...tiendasSeleccionadas]));
  // ↑ [...tiendasSeleccionadas] convierte el Set en un array para poder guardarlo como JSON.
  actualizarAvisoTiendas();
  // ↑ Cada cambio de selección actualiza también el aviso de "demasiadas tiendas".
}

function actualizarAvisoTiendas() {
  const n = tiendasSeleccionadas.size;
  if (n > MAX_TIENDAS_RECOMENDADAS) {
    tiendasTexto.textContent = `Seleccionaste ${n} tiendas. La búsqueda va en lotes de 6, hasta 4 a la vez: con más de ${MAX_TIENDAS_RECOMENDADAS} necesita más de una tanda y puede tardar bastante más.`;
    avisoTiendas.hidden = false;
    // ↑ Superado el umbral: mostramos el banner ámbar con el texto completo.
  } else {
    avisoTiendas.hidden = true;
    // ↑ Con 12 o menos tiendas no hace falta avisar: ocultamos el banner.
  }
}

btnTodas.addEventListener("click", () => {
  tiendasDisponibles.forEach(t => tiendasSeleccionadas.add(t.nombre));
  renderSelectorTiendas();
  persistirSeleccion();
});
// ↑ "Todas": agrega todas las tiendas al Set y vuelve a pintar los chips.

btnNinguna.addEventListener("click", () => {
  tiendasSeleccionadas.clear();
  renderSelectorTiendas();
  persistirSeleccion();
});
// ↑ "Ninguna": vacía el Set y re-pinta.

/* ============================================================
   Agregar Tienda (POST /api/stores)
   ============================================================ */

btnAgregarTienda.addEventListener("click", () => {
  const visible = !formAgregarTienda.hidden;
  formAgregarTienda.hidden = visible;
  msgAgregarTienda.hidden = true;
  if (!visible) inputNuevaTienda.focus();
  // ↑ "Toggles" del formulario: lo muestra si estaba oculto y lo oculta si estaba visible.
});

btnCancelarAgregar.addEventListener("click", () => {
  formAgregarTienda.hidden = true;
  inputNuevaTienda.value = "";
  inputNuevaUrl.value = "";
  msgAgregarTienda.hidden = true;
  // ↑ Cancelar: oculta el form y limpia lo que se estaba escribiendo.
});

formAgregarTienda.addEventListener("submit", async (e) => {
  e.preventDefault();
  // ↑ Evita que el formulario recargue la página.
  const nombre = inputNuevaTienda.value.trim();
  const urlBase = inputNuevaUrl.value.trim();
  if (!nombre || !urlBase) {
    msgAgregarTienda.textContent = "Faltan datos: la tienda está incompleta. Completá el nombre y la URL.";
    msgAgregarTienda.className = "msg-agregar error";
    msgAgregarTienda.hidden = false;
    return;
    // ↑ Validación previa: si falta algún campo mostramos el aviso y NO llamamos al backend.
  }
  msgAgregarTienda.hidden = true;

  try {
    const resp = await fetch("/api/stores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre, urlBase }),
      // ↑ El backend valida duplicados, normaliza la URL y la guarda en stores.json.
    });
    const datos = await resp.json();

    if (!resp.ok) {
      msgAgregarTienda.textContent = datos.error || "No se pudo agregar la tienda.";
      msgAgregarTienda.className = "msg-agregar error";
      msgAgregarTienda.hidden = false;
      return;
      // ↑ Error del backend (400 nombre vacío, 409 duplicada, 500 no se pudo escribir).
    }

    // Éxito: limpiamos el form, lo ocultamos y recargamos el selector con la lista nueva.
    inputNuevaTienda.value = "";
    inputNuevaUrl.value = "";
    formAgregarTienda.hidden = true;
    await cargarConfiguracion();
    // ↑ Re-consulta GET /api/stores: la tienda nueva ya aparece como chip seleccionable.

    msgAgregarTienda.textContent = `Tienda "${nombre}" agregada.`;
    msgAgregarTienda.className = "msg-agregar ok";
    msgAgregarTienda.hidden = false;
    refrescarIconos();
  } catch {
    msgAgregarTienda.textContent = "Error de conexión al agregar la tienda.";
    msgAgregarTienda.className = "msg-agregar error";
    msgAgregarTienda.hidden = false;
  }
});

/** Elimina una tienda vía DELETE /api/stores/:id y refresca el selector. */
async function eliminarTienda(tienda, label) {
  if (!confirm(`¿Eliminar la tienda "${tienda.nombre}"?`)) return;
  // ↑ confirm es un diálogo nativo: "Aceptar" sigue, "Cancelar" aborta.

  msgAgregarTienda.hidden = true;
  try {
    const resp = await fetch(`/api/stores/${encodeURIComponent(tienda.id)}`, {
      method: "DELETE",
    });
    // ↑ encodeURIComponent escapa caracteres raros del id por si viniera en la URL.
    const datos = await resp.json();

    if (!resp.ok) throw new Error(datos.error || "No se pudo eliminar la tienda.");

    // Si estaba seleccionada, la sacamos de la selección para no mandarla en búsquedas.
    tiendasSeleccionadas.delete(tienda.nombre);
    persistirSeleccion();

    await cargarConfiguracion();
    // ↑ Vuelve a pedir GET /api/stores: el chip de la tienda eliminada ya no aparece.

    msgAgregarTienda.textContent = `Tienda "${tienda.nombre}" eliminada.`;
    msgAgregarTienda.className = "msg-agregar ok";
    msgAgregarTienda.hidden = false;
  } catch (err) {
    msgAgregarTienda.textContent = err.message;
    msgAgregarTienda.className = "msg-agregar error";
    msgAgregarTienda.hidden = false;
  }
}

/* ============================================================
   Lógica de Resultados (Filtrado, Orden, Análisis)
   ============================================================ */

function recalcular() {
  if (!ultimaRespuesta) return;

  let ofertas = [...(ultimaRespuesta.ofertas || [])];
  // ↑ Copia del array original (spread [...]) para no modificar los datos crudos.

  // 1. Filtrar por disponibilidad (si el check está marcado)
  if (filtroDisponibles.checked) {
    ofertas = ofertas.filter(o => o.available);
  }
  // ↑ filter devuelve un NUEVO array solo con las ofertas disponibles.

  // 2. Ordenar
  const orden = ordenOfertas.value;
  ofertas.sort((a, b) => {
    if (orden === "precio-asc") return (a.price || Infinity) - (b.price || Infinity);
    if (orden === "precio-desc") return (b.price || 0) - (a.price || 0);
    if (orden === "tienda-asc") return a.store.localeCompare(b.store);
    return 0;
  });
  // ↑ sort recibe una función comparadora. "Infinity" manda los precios nulos al final.

  // 3. Renderizar Grid
  renderGrid(ofertas);

  // 4. Calcular Análisis (Min, Avg, Max, Ahorro)
  const disponibles = ofertas.filter(o => o.available && typeof o.price === "number");
  if (disponibles.length > 0) {
    const precios = disponibles.map(o => o.price);
    // ↑ map transforma cada oferta en solo su precio: [123456, 98000, ...].
    const min = Math.min(...precios);
    const max = Math.max(...precios);
    // ↑ Math.min/max con spread (...) recibe cada número como argumento por separado.
    const avg = precios.reduce((a, b) => a + b, 0) / precios.length;
    // ↑ reduce suma todos los precios (empieza en 0) y lo dividimos por la cantidad.
    const ahorro = max - min;
    // ↑ Cuánto se ahorra yendo a la opción más barata vs la más cara.

    statMin.textContent = formatearPrecio(min);
    statAvg.textContent = formatearPrecio(avg);
    statMax.textContent = formatearPrecio(max);
    statAhorro.textContent = formatearPrecio(ahorro);
    // ↑ Actualiza el texto visible de las 4 stats.

    // Actualizar Mejor Opción destacada (siempre la de menor precio de las filtradas)
    const mejor = disponibles.reduce((a, b) => a.price <= b.price ? a : b);
    // ↑ Mismo truco del backend: reduce "tornea" para quedarse con la de menor precio.
    mejorTitulo.textContent = mejor.title;
    mejorTienda.textContent = `Tienda: ${mejor.store}`;
    mejorPrecio.textContent = formatearPrecio(mejor.price);
    mejorEnlace.href = mejor.url;
    mejorOpcionCard.hidden = false;
  } else {
    statMin.textContent = "-";
    statAvg.textContent = "-";
    statMax.textContent = "-";
    statAhorro.textContent = "-";
    mejorOpcionCard.hidden = true;
    // ↑ Sin ofertas: muestra guiones y oculta la tarjeta destacada.
  }

  conteoOfertas.textContent = `${ofertas.length} ofertas encontradas`;
  refrescarIconos();
}

function renderGrid(ofertas) {
  gridTiendas.innerHTML = "";
  if (ofertas.length === 0) {
    gridTiendas.innerHTML = '<p class="nota">No hay ofertas que coincidan con los filtros.</p>';
    return;
  }

  ofertas.forEach(o => {
    // ↑ Creamos cada tarjeta de oferta con createElement y la llenamos campo por campo.
    const card = document.createElement("article");
    card.className = "card card-oferta";

    const header = document.createElement("div");
    header.className = "oferta-header";
    header.innerHTML = `<span class="badge-tienda">${o.store}</span>`;
    // ↑ innerHTML es cómodo para fragmentos fijos; o.store viene del backend (normalizado).
    
    const titulo = document.createElement("h4");
    titulo.className = "oferta-titulo";
    titulo.textContent = o.title;
    // ↑ textContent en vez de innerHTML: evita inyección de HTML si el título tuviera <tags>.

    const footer = document.createElement("div");
    footer.className = "oferta-footer";

    if (o.available && typeof o.price === "number") {
      footer.innerHTML = `
        <div class="oferta-precio">${formatearPrecio(o.price)}</div>
        <a href="${o.url}" target="_blank" class="btn-secondary" rel="noopener noreferrer">
          Ver Producto <i data-lucide="external-link"></i>
        </a>
      `;
      // ↑ Oferta válida: precio + enlace "Ver Producto" en pestaña nueva.
    } else {
      footer.innerHTML = `<div class="oferta-no-disponible">No disponible</div>`;
      // ↑ Si el agente no pudo verificarla, mostramos un cartel rojo en vez de precio.
    }

    card.append(header, titulo, footer);
    gridTiendas.appendChild(card);
  });
}

/* ============================================================
   Comunicación con API
   ============================================================ */

async function buscar(query, force = false) {
  avisoError.hidden = true;
  avisoCache.hidden = true;
  resultado.hidden = true;
  // ↑ Limpia estados anteriores antes de empezar.

  btnBuscar.disabled = true;
  estado.hidden = false;
  controladorActual = new AbortController();
  // ↑ AbortController permite cancelar el fetch: lo abortamos con .abort().

  try {
    const bodySearch = {
      query,
      force,
      stores: [...tiendasSeleccionadas]
    };
    // ↑ Enviamos también las tiendas que eligió el usuario (array, no Set).

    const resp = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodySearch),
      signal: controladorActual.signal,
      // ↑ signal conecta este fetch con el AbortController para poder cancelarlo.
    });

    const datos = await resp.json();

    if (!resp.ok) {
      if (datos.cancelado) return;
      throw new Error(datos.error || "Fallo en la búsqueda.");
      // ↑ Si la API respondió con error (400/499/502), lo convertimos en excepción.
    }

    ultimaRespuesta = datos;
    
    // Nota del agente
    if (datos.nota) {
      notaTexto.textContent = datos.nota;
      notaAgente.hidden = false;
    } else {
      notaAgente.hidden = true;
    }

    // Cache banner
    if (datos.fromCache) {
      cacheTexto.textContent = `Resultado recuperado del cache (${formatearFecha(datos.fecha)})`;
      avisoCache.hidden = false;
      // ↑ Avisa que el resultado NO es nuevo: salió del cache persistente.
    }

    resultado.hidden = false;
    recalcular();
    cargarHistorial();
    // ↑ Muestra resultados y refresca el historial (la búsqueda nueva ya quedó guardada).
  } catch (err) {
    if (err.name === "AbortError") return;
    // ↑ Si nosotros mismos abortamos el fetch, no es un error real: no mostrar nada.
    errorTexto.textContent = err.message;
    avisoError.hidden = false;
  } finally {
    estado.hidden = true;
    btnBuscar.disabled = false;
    controladorActual = null;
    // ↑ finally siempre corre (con éxito o error): restauramos la UI y limpiamos el controller.
  }
}

async function cancelarBusqueda() {
  if (controladorActual) controladorActual.abort();
  // ↑ Corta el fetch del frontend.
  try {
    await fetch("/api/search/cancel", { method: "POST" });
  } catch {}
  // ↑ Le avisa al backend para que mate el proceso de opencode activo (mata el agente).
}

async function cargarHistorial() {
  try {
    const resp = await fetch("/api/history");
    const items = await resp.json();
    listaHistorial.innerHTML = "";

    if (!items || items.length === 0) {
      historialVacio.hidden = false;
      return;
    }
    historialVacio.hidden = true;

    items.forEach(item => {
      const div = document.createElement("div");
      div.className = "card historial-item";
      
      div.innerHTML = `
        <div class="historial-info">
          <span class="h-query">${item.query}</span>
          <span class="h-meta">${item.tiendas.length} tiendas · ${formatearFecha(item.fecha)}</span>
        </div>
        <div class="historial-acciones">
          <button class="btn-icon btn-ver" title="Ver guardado"><i data-lucide="eye"></i></button>
          <button class="btn-icon btn-refresh" title="Actualizar con IA"><i data-lucide="refresh-cw"></i></button>
        </div>
      `;
      // ↑ Cada fila del historial trae dos botones: ver (cache) y actualizar (IA).

      div.querySelector(".btn-ver").onclick = async () => {
        input.value = item.query;
        input.scrollIntoView({ behavior: "smooth" });
        // ↑ Lleva la vista hasta el buscador con scroll suave.
        const r = await fetch(`/api/search/${item.slug}`);
        const d = await r.json();
        ultimaRespuesta = d;
        avisoCache.hidden = true;
        avisoError.hidden = true;
        resultado.hidden = false;
        recalcular();
        // ↑ "Ver" muestra la búsqueda guardada sin volver a gastar IA (desde cache).
      };

      div.querySelector(".btn-refresh").onclick = () => {
        input.value = item.query;
        buscar(item.query, true);
        // ↑ "Actualizar con IA" usa force: true para buscarla de nuevo y refrescar el precio.
      };

      listaHistorial.appendChild(div);
    });
    refrescarIconos();
  } catch {}
}

/* ============================================================
   Inicialización y Eventos
   ============================================================ */

btnTema.addEventListener("click", toggleTema);
btnCancelar.addEventListener("click", cancelarBusqueda);

filtroDisponibles.addEventListener("change", recalcular);
ordenOfertas.addEventListener("change", recalcular);
// ↑ Cambios de filtro u orden re-calculan sobre la última respuesta (sin llamar a la API).

form.addEventListener("submit", (e) => {
  e.preventDefault();
  // ↑ preventDefault evita que el formulario recargue la página (comportamiento por defecto).
  const q = input.value.trim();
  if (q) buscar(q);
  // ↑ Solo busca si el input no quedó vacío.
});

// Inicio
initTema();
cargarConfiguracion();
cargarHistorial();
refrescarIconos();
// ↑ Al cargar la página: tema, tiendas, historial e íconos (en ese orden).