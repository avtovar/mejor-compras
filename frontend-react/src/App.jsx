/* ============================================================
   App — Componente raíz de MejorCompras (React)
   ============================================================
   ↑ Acá vive TODO el estado de la aplicación. Los componentes
   hijos son "tontos": sólo reciben props y avisan por callbacks.
   Esto es el patrón "levantar el estado" (lifting state up). */

import { useState, useEffect, useMemo, useRef } from "react";
import { api } from "./api.js";
import Header from "./components/Header.jsx";
import StoreSelector from "./components/StoreSelector.jsx";
import SearchBar from "./components/SearchBar.jsx";
import LoadingOverlay from "./components/LoadingOverlay.jsx";
import Dashboard from "./components/Dashboard.jsx";
import OffersGrid from "./components/OffersGrid.jsx";
import HistoryList from "./components/HistoryList.jsx";

const CLAVE_TEMA = "mejorcompras-theme";
const CLAVE_TIENDAS = "mejorcompras-stores";
// ↑ Claves de localStorage: deben coincidir con la versión HTML/CSS/JS
// para que ambos frontends compartan la misma preferencia guardada.

const MAX_TIENDAS_RECOMENDADAS = 24;
// ↑ Umbral de tiendas por búsqueda. El backend busca en lotes de 6 tiendas, hasta 4 lotes a la vez:
//   6 × 4 = 24 tiendas caben en UNA sola tanda. Pasado ese número hace falta una segunda tanda
//   (y una tercera, etc.), así que la espera crece: con 25+ conviene avisar al usuario.

export default function App() {
  // ---------- TEMA (claro / oscuro) ----------
  const [tema, setTema] = useState(
    () => localStorage.getItem(CLAVE_TEMA) || "light"
  );
  // ↑ useState con función: el valor inicial se calcula UNA sola vez al montar.

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", tema);
    // ↑ El CSS usa [data-theme="dark"] para pisar las variables de color.
    localStorage.setItem(CLAVE_TEMA, tema);
  }, [tema]);
  // ↑ Este efecto corre cada vez que "tema" cambia (está en el array de dependencias).

  // ---------- TIENDAS ----------
  const [tiendas, setTiendas] = useState([]);
  const [seleccionadas, setSeleccionadas] = useState(new Set());
  const [errorTiendas, setErrorTiendas] = useState("");

  async function cargarTiendas() {
    try {
      const datos = await api.getStores();
      setTiendas(datos.tiendas);
      // ↑ El backend responde { tiendas: [...] }; guardamos SOLO el array.

      const guardadas = JSON.parse(localStorage.getItem(CLAVE_TIENDAS) || "null");
      const nombres = datos.tiendas.map((t) => t.nombre);
      if (Array.isArray(guardadas) && guardadas.length) {
        // Filtramos las guardadas que ya no existen (tiendas borradas).
        setSeleccionadas(new Set(guardadas.filter((n) => nombres.includes(n))));
      } else {
        setSeleccionadas(new Set(nombres));
        // ↑ Primera vez: arrancan TODAS seleccionadas.
      }
      setErrorTiendas("");
    } catch (err) {
      setErrorTiendas(`No se pudieron cargar las tiendas: ${err.message}`);
    }
  }

  useEffect(() => {
    cargarTiendas();
  }, []);
  // ↑ Array de dependencias vacío = se ejecuta una sola vez (al montar).

  function toggleTienda(nombre) {
    setSeleccionadas((prev) => {
      const copia = new Set(prev);
      copia.has(nombre) ? copia.delete(nombre) : copia.add(nombre);
      // ↑ Si estaba, la saco; si no estaba, la agrego.
      localStorage.setItem(CLAVE_TIENDAS, JSON.stringify([...copia]));
      return copia;
    });
  }

  function todasLasTiendas() {
    const conjunto = new Set(tiendas.map((t) => t.nombre));
    setSeleccionadas(conjunto);
    localStorage.setItem(CLAVE_TIENDAS, JSON.stringify([...conjunto]));
  }

  function ningunaTienda() {
    const conjunto = new Set();
    setSeleccionadas(conjunto);
    localStorage.setItem(CLAVE_TIENDAS, JSON.stringify([]));
  }

  async function agregarTienda(nombre, url) {
    const datos = await api.addStore(nombre, url);
    // ↑ Si el backend responde 400/409, "pedir" lanza Error y cae en el catch
    // de StoreSelector, que muestra el mensaje en rojo.
    setTiendas(datos.tiendas);
    setSeleccionadas((prev) => {
      const copia = new Set(prev).add(datos.tienda.nombre);
      localStorage.setItem(CLAVE_TIENDAS, JSON.stringify([...copia]));
      return copia;
    });
    // ↑ Dejamos la tienda nueva marcada automáticamente.
  }

  async function eliminarTienda(tienda) {
    const datos = await api.deleteStore(tienda.id);
    setTiendas(datos.tiendas);
    setSeleccionadas((prev) => {
      const copia = new Set(prev);
      copia.delete(tienda.nombre);
      localStorage.setItem(CLAVE_TIENDAS, JSON.stringify([...copia]));
      return copia;
    });
  }

  // ---------- BÚSQUEDA ----------
  const [query, setQuery] = useState("");
  const [cargando, setCargando] = useState(false);
  const [respuesta, setRespuesta] = useState(null);
  const [error, setError] = useState("");
  const [nota, setNota] = useState("");
  const abortRef = useRef(null);
  // ↑ useRef: guarda el AbortController SIN provocar re-render al cambiar.

  async function buscar(texto, force) {
    const lista = [...seleccionadas];
    if (lista.length === 0) {
      setError("Seleccioná al menos una tienda antes de buscar.");
      return;
    }

    abortRef.current?.abort();
    // ↑ Si había una búsqueda anterior en curso, la cortamos.
    const control = new AbortController();
    abortRef.current = control;

    setCargando(true);
    setError("");
    setNota("");
    setRespuesta(null);

    try {
      const datos = await api.search(texto, force, lista, control.signal);
      setRespuesta(datos);
      setNota(datos.nota || "");
      cargarHistorial();
      // ↑ Cada búsqueda exitosa queda cacheada: refrescamos el historial.
    } catch (err) {
      if (err.status === 499 || err.name === "AbortError") {
        setNota("Búsqueda cancelada.");
        // ↑ 499 es el código propio del backend para "cancelado" (no es un error real).
      } else {
        setError(`Error en la búsqueda: ${err.message}`);
      }
    } finally {
      setCargando(false);
      abortRef.current = null;
    }
  }

  function cancelarBusqueda() {
    api.cancelSearch();
    // ↑ Le avisa al backend que mate el proceso de opencode que está corriendo.
    abortRef.current?.abort();
    setCargando(false);
    setNota("Búsqueda cancelada.");
  }

  // ---------- HISTORIAL ----------
  const [historial, setHistorial] = useState([]);

  async function cargarHistorial() {
    try {
      const datos = await api.getHistory();
      setHistorial(Array.isArray(datos) ? datos : []);
    } catch {
      /* Si falla, dejamos el historial como estaba (no es crítico). */
    }
  }

  useEffect(() => {
    cargarHistorial();
  }, []);

  async function verGuardado(item) {
    try {
      const datos = await api.getSearch(item.slug);
      setRespuesta(datos);
      setQuery(datos.query);
      setNota("Mostrando resultado guardado (sin consultar la IA).");
      setError("");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(`No se pudo abrir la búsqueda guardada: ${err.message}`);
    }
  }

  function actualizarConIA(item) {
    setQuery(item.query);
    buscar(item.query, true);
    // ↑ force=true ignora el cache y vuelve a consultar las tiendas.
  }

  // ---------- FILTROS Y ORDEN ----------
  const [filtroDisponibles, setFiltroDisponibles] = useState(false);
  const [orden, setOrden] = useState("precio-asc");

  const ofertas = useMemo(() => {
    if (!respuesta?.ofertas) return [];
    let lista = [...respuesta.ofertas];
    // ↑ Copiamos el array: nunca ordenamos el estado original (sería mutación).

    if (filtroDisponibles) {
      lista = lista.filter((o) => o.available && typeof o.price === "number");
    }

    lista.sort((a, b) => {
      if (orden === "tienda-asc") return a.store.localeCompare(b.store);
      // ↑ localeCompare ordena alfabéticamente respetando acentos.
      const pa = typeof a.price === "number" ? a.price : Infinity;
      const pb = typeof b.price === "number" ? b.price : Infinity;
      // ↑ Las ofertas sin precio van al final en cualquier orden por precio.
      return orden === "precio-desc" ? pb - pa : pa - pb;
    });

    return lista;
  }, [respuesta, filtroDisponibles, orden]);
  // ↑ useMemo: sólo recalcula si cambia la respuesta, el filtro o el orden.

  const stats = useMemo(() => {
    const conPrecio = (respuesta?.ofertas || []).filter(
      (o) => o.available && typeof o.price === "number"
    );
    if (conPrecio.length === 0) return null;

    const precios = conPrecio.map((o) => o.price);
    const min = Math.min(...precios);
    const max = Math.max(...precios);
    const avg = Math.round(precios.reduce((s, p) => s + p, 0) / precios.length);
    const mejor = conPrecio.reduce((m, o) => (o.price < m.price ? o : m));
    // ↑ reduce: recorre y se queda con la oferta de menor precio.

    return { min, avg, max, ahorro: max - min, mejor };
  }, [respuesta]);

  // ---------- RENDER ----------
  const demasiadasTiendas = seleccionadas.size > MAX_TIENDAS_RECOMENDADAS;
  // ↑ Si hay más de 24 tiendas marcadas (más de una tanda de lotes) mostramos el banner ámbar.
  return (
    <div className="app-container">
      <Header tema={tema} onToggleTema={() => setTema(tema === "dark" ? "light" : "dark")} />

      <main className="contenido">
        <section className="seccion-busqueda">
          <StoreSelector
            tiendas={tiendas}
            seleccionadas={seleccionadas}
            errorTiendas={errorTiendas}
            onToggle={toggleTienda}
            onTodas={todasLasTiendas}
            onNinguna={ningunaTienda}
            onAgregar={agregarTienda}
            onEliminar={eliminarTienda}
          />

          {demasiadasTiendas && (
            <div className="aviso-banner warn">
              ⚠️ Seleccionaste {seleccionadas.size} tiendas. La búsqueda va en lotes de 6, hasta 4 a la vez: con más de {MAX_TIENDAS_RECOMENDADAS} necesita más de una tanda y puede tardar bastante más.
            </div>
          )}
          {/* ↑ Aviso ámbar: aparece solo si el usuario marcó más de 24 tiendas. */}

          <SearchBar query={query} onQuery={setQuery} onBuscar={buscar} cargando={cargando} />
        </section>

        {error && <div className="aviso-banner error">⚠️ {error}</div>}
        {respuesta?.fromCache && (
          <div className="aviso-banner info">
            💾 Resultado guardado el {respuesta.fecha}. Usá 🔄 en el historial para actualizar con IA.
          </div>
        )}

        {respuesta && (
          <section className="seccion-resultados">
            <Dashboard stats={stats} />
            <OffersGrid
              ofertas={ofertas}
              filtroDisponibles={filtroDisponibles}
              onFiltro={() => setFiltroDisponibles((v) => !v)}
              orden={orden}
              onOrden={setOrden}
            />
            {nota && <div className="nota-agente">🤖 {nota}</div>}
            {/* ↑ Explicación del agente de IA sobre cómo interpretó la búsqueda. */}
          </section>
        )}

        {!respuesta && nota && <div className="aviso-banner info">ℹ️ {nota}</div>}

        <HistoryList items={historial} onVer={verGuardado} onActualizar={actualizarConIA} />
      </main>

      <footer className="pie">
        <div className="pie-content">
          <p>MejorCompras · Comparador de precios con agentes de IA</p>
          <p className="pie-tech">React + Vite · Backend Node/Express · opencode</p>
        </div>
      </footer>

      <LoadingOverlay visible={cargando} onCancelar={cancelarBusqueda} />
      {/* ↑ Overlay fijo por encima de todo mientras la IA busca precios. */}
    </div>
  );
}