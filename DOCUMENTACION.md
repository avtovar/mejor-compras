# Documentación - mejor_compras

Comparador de precios argentino: escribís un producto (ej. "TV 32 pulgadas") y la app te devuelve la **mejor opción** comparando precios en **37 tiendas argentinas**. El catálogo se armó en dos tandas:

1. **Catálogo original (12):** Naldo, Carrefour, Coto, Mercado Libre, On City, Musimundo, Garbarino, Frávega, RODO, Tiribelli Hogar, Feelhome y Casa del Audio.
2. **Anexo 2026 — listado de electrodomésticos, computación y sillas/escritorios de CABA (25):** Computers Depot, SOS Computación, Overhard, AXA Computación, Maximus Gaming, M&M Computación, Ultra Computación, Venex, Electro5, Electro GV, Quamo, Baires4, Furnitech, Jumbo, Disco, Vea, ChangoMas, DIA, Makro, Vital, Diarco, Yaguar, Cetrogar, Megatone y Pardo Hogar. (Coto, Carrefour, Frávega, Naldo y On City ya estaban en el catálogo original, por eso no se duplicaron.)

> ⚠️ **Escalado:** la búsqueda se hace **por lotes en paralelo**: la lista se parte en lotes de 6 tiendas y corren hasta 4 procesos de opencode a la vez, fusionando las ofertas al final. Con 37 tiendas son 7 lotes → 2 tandas. Si un lote falla, los demás igual devuelven ofertas. Ver "Escalado de la búsqueda" en el README.
>
> ⚠️ **Aviso en pantalla:** cuando se marcan **más de 24 tiendas**, aparece un banner ámbar arriba del buscador (en `frontend/` y en `frontend-react/`) avisando que la búsqueda va a necesitar más de una tanda de lotes. El umbral es la constante `MAX_TIENDAS_RECOMENDADAS = 24` (sale del batching: 6 tiendas por lote × 4 lotes en paralelo); el aviso es informativo y **no impide** lanzar la búsqueda.
>
> ⚠️ **Sector 2026:** el listado da a **Garbarino** y **Musimundo** por quebrados. **Se mantienen en el catálogo a propósito** (decisión del proyecto): el agente los marca `available: false` si el sitio no responde, nunca inventa precios. No borrarlas sin consultar.

El stack se divide en dos partes:

- **Backend (Node.js + Express, CommonJS):** API REST que recibe la búsqueda, revisa un **cache persistente** en `data/` y, si no existe, delega la búsqueda real a un **agente de IA de opencode** (subagente `comparador-precios-ar`). Corriendo el backend se sirve también el frontend.
- **Frontend HTML/CSS/JS puro (sin frameworks ni build):** página que arma el selector de tiendas, el buscador, el dashboard de análisis (mejor opción, mínimo, promedio, máximo, ahorro), el grid de ofertas, filtros, orden, tema claro/oscuro e historial. Vive en `frontend/` y se sirve en `/`.
- **Frontend React 18 + Vite:** exactamente la misma app reescrita con componentes, servida en `/react` a partir del build de `frontend-react/`. Ambos frontends consumen la misma API y comparten las preferencias de `localStorage`.

Conceptos que usa: API REST con Express, `child_process.spawn` para lanzar procesos externos, cola de promesas (promise chaining), cache en archivos JSON, normalización de texto (slugs), `fetch` + `AbortController` para cancelar búsquedas, `localStorage` para persistir preferencias, y **dark mode** con variables CSS (`data-theme`). En la versión React además: componentes, props, `useState`/`useEffect`/`useMemo`/`useRef` y levantamiento del estado (lifting state up).

---

## Estructura

- `backend/server.js` — API Express (los endpoints `/api/stores` GET/POST, `/api/search`, `/api/history`, `/api/search/:slug`, `/api/search/cancel`) + sirve el frontend estático. Calcula `mejorOpcion` y normaliza las ofertas del agente.
- `backend/stores.json` — Las **37 tiendas** configurables (id, nombre y URL base). Lo consume `GET /api/stores` y debe estar sincronizado con `TIENDAS_CANONICAS` (server.js) y `TIENDAS_MENSAJE` (lib/opencode.js).
- `backend/package.json` — Dependencias del backend (solo Express) y scripts (`npm start`).
- `backend/lib/cache.js` — Lectura/escritura del cache persistente en `data/` (`searches/<slug>.json` + `index.json`).
- `backend/lib/cola.js` — Cola simple en serie: garantiza que nunca corran **dos búsquedas** a la vez (no de dos *procesos*: dentro de una búsqueda pueden correr varios en paralelo, uno por lote).
- `backend/lib/opencode.js` — Lanza la CLI de opencode (`spawn`), resuelve el binario real en Windows, recolecta el NDJSON de salida, extrae el JSON del subagente, **parte la lista en lotes y los ejecuta en paralelo** (`partirEnLotes`, `fusionarResultados`) y permite cancelar todos los procesos activos.
- `backend/lib/slug.js` — Utilidades de normalización: quita acentos, pasa a minúsculas y convierte una query en un **slug** seguro para nombre de archivo.
- `frontend/index.html` — Estructura de la página: header, selector de tiendas, buscador, overlays de estado, dashboard de análisis, filtros, grid de ofertas, nota del agente e historial.
- `frontend/style.css` — Todos los estilos: variables de tema (claro/oscuro), layout, tarjetas, dashboard, responsive.
- `frontend/app.js` — Lógica del frontend: carga tiendas y selección, búsqueda con `fetch` + `AbortController`, render del dashboard/grid/historial, tema, filtrado y orden.
- `frontend-react/` — **Versión React (Vite)** de la misma app: `index.html`, `vite.config.js` (`base: "/react/"` + proxy de `/api`), `src/` con `main.jsx`, `App.jsx`, `api.js`, `utils.js`, `styles.css` y `src/components/` (`Header`, `StoreSelector`, `SearchBar`, `LoadingOverlay`, `Dashboard`, `OffersGrid`, `HistoryList`). El build se genera en `dist/` (ignorado por git) y el backend lo sirve en `/react`.
- `.opencode/agent/comparador-precios-ar.md` — Definición del **subagente de IA** de opencode que hace la búsqueda real de precios y responde JSON (contrato estricto, no inventa precios).
- `data/` — Cache persistente: `index.json` (historial) y `searches/<slug>.json` (resultados guardados).
- `no_subir/` — Carpeta local privada (ignorada por git). No debe subirse.
- `README.md` — Guía principal: cómo correr el proyecto, API, limitaciones.

---

## Comandos

```
npm install --prefix backend         -> instala Express (única dependencia del backend)
npm start --prefix backend           -> levanta el backend + frontend en http://localhost:3000

cd frontend-react
npm install                          -> instala React y Vite (solo para la versión React)
npm run build                        -> genera frontend-react/dist (se sirve en http://localhost:3000/react)
npm run dev                          -> dev server con recarga en vivo en http://localhost:5173/react/
```

No hay build ni lint para la versión vanilla: `frontend/` es HTML/CSS/JS puro y el backend solo necesita Node ≥ 18 (probado con v24). La versión React sí requiere `npm install` + `npm run build` en `frontend-react/`.

---

## Conceptos clave que se ven en este proyecto

1. **Agentes de IA + CLI (`opencode run`)** — El backend no scrapea las tiendas con código: lanza la CLI de opencode con un mensaje que delega en el subagente `comparador-precios-ar` (vía la tool `Task`). El agente usa `websearch`/`webfetch` y responde un JSON con las ofertas.
2. **Cache persistente en archivos JSON** — Cada búsqueda nueva se guarda en `data/searches/<slug>.json` y se indexa en `data/index.json`. Una búsqueda repetida se responde desde cache sin gastar tokens de IA (salvo `force: true`).
3. **Cola en serie con promesas** — `cola.js` encadena las tareas (`cola = cola.then(fn)`): si dos personas buscan al mismo tiempo, la segunda espera a que termine la primera. El invariante es "una **búsqueda** a la vez"; adentro de una búsqueda puede haber varios procesos de opencode en paralelo.
4. **Cancelación de procesos (`AbortController` + matar los procesos)** — El frontend corta el `fetch` con `AbortController`, y el backend mata **todos** los procesos de opencode activos (los de todos los lotes: `SIGTERM` y `SIGKILL` a los 2 s) y responde 499 con `cancelado: true`.
5. **Normalización de queries → slugs** — `slug.js` convierte "TV 32 Pulgadas!" en `tv-32-pulgadas` para usarlo como nombre de archivo seguro del cache.
6. **Contrato JSON estricto del agente** — El subagente debe responder siempre el mismo shape (`ofertas[]`, `tiendasConsultadas`, `nota`, etc.). El backend extrae el JSON de la salida incluso si el texto trae prosa alrededor.
7. **Dark mode con variables CSS** — `style.css` define variables en `:root` (tema claro) y las sobrescribe en `[data-theme="dark"]`. `app.js` guarda la preferencia en `localStorage`.
8. **Dashboard de análisis** — El frontend calcula mínimo, promedio, máximo y **ahorro estimado** (máximo − mínimo) entre las ofertas disponibles, y destaca la mejor opción.
9. **Manejo de errores por códigos HTTP** — Cache recuperado (200 con `fromCache: true`), cancelación (499), agente fallido (502), query vacía (400), búsqueda no cacheada (404).
10. **Levantar el estado (lifting state up)** — En React, `App.jsx` guarda TODO el estado (tema, tiendas seleccionadas, búsqueda, filtros, historial) y se lo pasa a los componentes hijos por **props**; los hijos avisan con **callbacks** (`onToggle`, `onBuscar`, `onFiltro`...). Así los hijos quedan "tontos" y fáciles de leer.
11. **`useMemo` para cálculos derivados** — Las ofertas filtradas/ordenadas y las estadísticas (mínimo, promedio, máximo, ahorro, mejor opción) se calculan con `useMemo`, así no se recalculan en cada render si nada cambió.
12. **`useRef` + `AbortController`** — El `AbortController` de la búsqueda en curso se guarda en un `useRef` (que NO provoca re-render), y se cancela tanto en el navegador (`abort()`) como en el backend (`POST /api/search/cancel`).
13. **Build estático servido por Express** — Vite compila a `frontend-react/dist` con `base: "/react/"`, y el backend monta esa carpeta con `express.static` sólo si existe: un mismo servidor sirve la versión vanilla en `/` y la React en `/react`.
14. **Lotes en paralelo con pool de concurrencia** — Con 37 tiendas, una sola sesión de opencode agotaba el timeout. Ahora `opencode.js` parte la lista en lotes (`partirEnLotes`) y lanza hasta `CONCURRENCIA` procesos a la vez: N "trabajadores" comparten un índice (`siguiente++`), así ninguno repite lote y nunca hay más procesos vivos que el tope. Al final, `fusionarResultados` une las ofertas de todos los lotes deduplicando por tienda. Es un patrón clásico (**worker pool**) y su gran ventaja es la **tolerancia a fallos parciales**: un lote caído no arruina el resultado completo.
15. **Aislamiento de fallos por lote** — Cada lote se envuelve en su propio `try/catch` y se guarda como `{ ok: true/false, ... }`: un lote que expira o devuelve basura se registra como fallido y **los demás siguen**. El `502` solo se devuelve si fallan **todos**; además hay un **watchdog** de tiempo total (`OPENCODE_TIMEOUT_TOTAL_MS`) que mata todo si la búsqueda completa se pasa del tope.

---

## Árbol de dependencias

```
backend/server.js            ✅ entry point del backend (Express)
  └─ backend/lib/slug.js     ✅ importado (normalizar, slugDeQuery)
  └─ backend/lib/cache.js    ✅ importado (RAIZ, leerBusqueda, guardarBusqueda, listarHistorial)
  └─ backend/lib/opencode.js ✅ importado (buscar, cancelarActual, AGENTE, TIMEOUT_DEFAULT_MS, BATCH_SIZE, CONCURRENCIA, TIMEOUT_TOTAL_DEFAULT_MS)
  └─ backend/lib/cola.js     ✅ importado (encolar)
  └─ backend/stores.json     ✅ leído por GET /api/stores

frontend/index.html          ✅ página principal
  └─ frontend/style.css      ✅ aplicado (<link rel="stylesheet">)
  └─ frontend/app.js         ✅ aplicado (<script src>)
       └─ /api/stores, /api/search, /api/search/cancel, /api/search/:slug, /api/history
                            ✅ consumen la API del backend

frontend-react/index.html    ✅ entrada de Vite (versión React)
  └─ frontend-react/src/main.jsx        ✅ monta <App /> en #root
       ├─ src/App.jsx                   ✅ componente raíz (todo el estado)
       │    ├─ src/api.js               ✅ fetch centralizado
       │    ├─ src/utils.js             ✅ formato de precios y fechas
       │    └─ src/components/*.jsx     ✅ Header, StoreSelector, SearchBar,
       │                                    LoadingOverlay, Dashboard,
       │                                    OffersGrid, HistoryList
       └─ src/styles.css                ✅ importado por main.jsx
  └─ backend sirve frontend-react/dist  ✅ en /react (express.static condicional)

.opencode/agent/comparador-precios-ar.md   ✅ subagente invocado por opencode.js
data/index.json + data/searches/*.json     ✅ cache generado y leído por cache.js
```

No hay archivos huérfanos: el CSS y el JS del frontend vanilla están enlazados por su `index.html`; en React, `main.jsx` importa `App.jsx` y `styles.css`, y `App.jsx` importa `api.js`, `utils.js` y los siete componentes. Todos los módulos del backend son requeridos por `server.js`.

---

## Cómo cambiar cosas típicas

- **Cambiar el puerto del servidor:** usá la variable de entorno `PORT`, ej. `$env:PORT=4000` y luego `npm start --prefix backend`.
- **Cambiar el timeout de la búsqueda IA:** `OPENCODE_TIMEOUT_MS` (por defecto 600000 ms = 10 min **por lote**) y `OPENCODE_TIMEOUT_TOTAL_MS` (por defecto 900000 ms = 15 min para la búsqueda completa). También podés ajustar el batching con `OPENCODE_BATCH_SIZE` (default 6 tiendas por lote) y `OPENCODE_CONCURRENCIA` (default 4 lotes en paralelo).
- **Agregar o quitar tiendas:** en la app, botón **"+ Agregar tienda"** (nombre + URL, se guarda vía `POST /api/stores` en `backend/stores.json`), y la **"×" de cada chip** para eliminar (`DELETE /api/stores/:id`). También podés editarlo a mano en `backend/stores.json`. Si querés que el agente de IA la consulte con prioridad, actualizá también las listas canónicas en `backend/server.js` (`TIENDAS_CANONICAS`) y `backend/lib/opencode.js` (`TIENDAS_MENSAJE`), además del prompt del subagente `.opencode/agent/comparador-precios-ar.md` (tabla nombre canónico → URL). Son **4 lugares** que deben quedar sincronizados; si se desincronizan, el agente devuelve una oferta con un `store` que el backend no reconoce y el filtro por tienda del frontend no la muestra. El chequeo de duplicados de `POST /api/stores` ignora mayúsculas **y acentos** (`slug.normalizar`), así que `"SOS Computación"` y `"sos computacion"` se detectan como la misma tienda.
- **Cambiar la paleta de colores:** editar las variables CSS en el bloque `:root` y `[data-theme="dark"]`. En la versión vanilla es `frontend/style.css`; en la versión React, `frontend-react/src/styles.css` (y volver a correr `npm run build`).
- **Tocar la interfaz React:** editá los componentes en `frontend-react/src/components/`. Con `npm run dev` (http://localhost:5173/react/) los cambios se ven al instante; para producción hay que volver a correr `npm run build`.
- **Forzar una búsqueda nueva (ignorar cache):** el botón "Actualizar con IA" del historial usa `force: true` en el body de `POST /api/search`.

---

## Componentes de la versión React

| Archivo | Qué hace | Estado que maneja |
|---------|----------|-------------------|
| `src/main.jsx` | Monta `<App />` en `#root` e importa `styles.css`. | — |
| `src/App.jsx` | Dueño de **todo** el estado; arma las secciones y los callbacks. | tema, tiendas, selección, búsqueda, resultado, error, nota, historial, filtros y orden |
| `src/api.js` | Única puerta de salida a la API (`getStores`, `addStore`, `deleteStore`, `search`, `cancelSearch`, `getSearch`, `getHistory`). Adjunta `status` y `datos` al Error para distinguir una cancelación (499) de un error real. | — |
| `src/utils.js` | Helpers `formatearPrecio` (ARS) y `formatearFecha` (es-AR). | — |
| `components/Header.jsx` | Barra superior con logo y botón de tema. | — |
| `components/StoreSelector.jsx` | Chips de tiendas, "Todas"/"Ninguna", alta y baja de tiendas. | formulario de alta, nombre, URL, mensaje de feedback |
| `components/SearchBar.jsx` | Input + botón "Buscar con IA". | — (el texto vive en `App`) |
| `components/LoadingOverlay.jsx` | Overlay con spinner y botón Cancelar. | — |
| `components/Dashboard.jsx` | Tarjeta "Mejor Opción" + mínimo, promedio, máximo y ahorro. | — |
| `components/OffersGrid.jsx` | Toolbar de filtro/orden y grilla de ofertas. | — |
| `components/HistoryList.jsx` | Búsquedas guardadas con 👁 (ver cache) y 🔄 (actualizar con IA). | — |

Cómo se hidrata el estado inicial: `App` lee el tema y las tiendas seleccionadas desde `localStorage` (claves `mejorcompras-theme` y `mejorcompras-stores`, las mismas que usa la versión vanilla, así ambas comparten preferencias) y pide las tiendas a `GET /api/stores` en un `useEffect` de montaje.

---

## API / Endpoints

| Método | Ruta                    | Qué hace                                                            |
|--------|-------------------------|---------------------------------------------------------------------|
| GET    | `/api/stores`           | Devuelve las tiendas configuradas (`backend/stores.json`)           |
| POST   | `/api/stores`           | Agrega una tienda nueva. Body: `{ "nombre": "...", "urlBase": "..." }` (ambos obligatorios; si falta alguno responde 400 y **no** guarda). Valida, normaliza la URL y guarda en `stores.json` |
| DELETE | `/api/stores/:id`       | Elimina una tienda (id = slug, ej. `easy`). Guarda en `stores.json` |
| POST   | `/api/search`           | Busca un producto. Body: `{ "query": "...", "force": false, "stores": ["Naldo", "Coto"] }` |
| POST   | `/api/search/cancel`    | Cancela la búsqueda en curso (mata el proceso de opencode activo)   |
| GET    | `/api/search/:slug`     | Detalle de una búsqueda guardada en cache                           |
| GET    | `/api/history`          | Historial de búsquedas cacheadas                                    |

Formato de cada oferta en las respuestas:

```json
{
  "store": "Carrefour",
  "title": "...",
  "price": 123456,
  "currency": "ARS",
  "url": "https://...",
  "available": true,
  "fetchedAt": "2026-09-15T..."
}
```

Códigos de error: `400` (query vacía), `404` (búsqueda no cacheada), `499` (cancelada por el usuario), `502` (el agente falló o expiró el timeout).

---

*Documentado por Ali Valentin Tovar Morales*