# 🛒 MejorCompras

Comparador de precios argentino: escribís un producto (ej. "TV 32 pulgadas") y la app te devuelve la **mejor opción** comparando precios en **37 tiendas**: cadenas de electro y tecnología (Naldo, Frávega, Cetrogar, Megatone, On City, Pardo Hogar, RODO, Tiribelli Hogar, Feelhome, Casa del Audio), computación y gaming (Computers Depot, SOS Computación, Overhard, AXA Computación, Maximus Gaming, M&M Computación, Ultra Computación, Venex), electrodomésticos (Electro5, Electro GV), sillas y escritorios (Quamo, Baires4, Furnitech), supermercados e hipermercados (Coto, Carrefour, Jumbo, Disco, Vea, ChangoMas, DIA) y mayoristas (Makro, Vital, Diarco, Yaguar), más Mercado Libre. La búsqueda real la hace un **agente de IA de opencode** y los resultados quedan **guardados en el repo** (`data/`) como cache persistente para futuras búsquedas iguales.

> ⚠️ **Recomendación de uso:** la búsqueda se hace **por lotes en paralelo** (6 tiendas por lote, 4 lotes a la vez), así que las 37 tiendas ya son viables: **hasta 24 tiendas entran en una sola tanda** y la espera es prácticamente la misma. Pasado ese número arranca una segunda tanda y el tiempo crece. Ver la sección "Escalado de la búsqueda".

Solo Argentina: moneda ARS y tiendas argentinas.

El proyecto trae **dos frontends que consumen la misma API** y comparten las preferencias guardadas en `localStorage`:

| Frontend | Tecnología | URL |
|----------|------------|-----|
| `frontend/` | HTML + CSS + JS puro (sin build) | http://localhost:3000 |
| `frontend-react/` | React 18 + Vite | http://localhost:3000/react (con build) · http://localhost:5173/react/ (en dev) |

> 📚 ¿Querés entender cada archivo y concepto del proyecto? Mirá [`DOCUMENTACION.md`](DOCUMENTACION.md), la guía didáctica con comentarios por archivo.

> ⚠️ Nota sobre Garbarino, Musimundo y Casa del Audio: el listado del sector de 2026 da a **Garbarino** y **Musimundo** por quebrados (sitios posiblemente caídos o sin stock real), y **Casa del Audio** no tiene URL de comercio electrónico confirmada. En los tres casos el agente marca la oferta como no disponible y lo explica en la `nota` en vez de inventar datos.

---

## ✨ Funcionalidades del frontend

- **Selector de tiendas**: elegís contra qué tiendas comparar (chips seleccionables, "Todas"/"Ninguna"). La selección queda guardada en `localStorage`.
- **Agregar tienda**: el botón "+ Agregar tienda" abre un formulario (**nombre y URL obligatorios**) que guarda la tienda en `backend/stores.json` a través de `POST /api/stores`. Si falta algún dato, avisa que está incompleta y no la agrega. El chip aparece enseguida en el selector.
- **Eliminar tienda**: cada chip tiene una "×" que borra la tienda (`DELETE /api/stores/:id`), con confirmación.
- **Búsqueda con IA**: cada búsqueda nueva delega en el agente de opencode. Botón **"Cancelar búsqueda"** mientras está en curso (corta la conexión y mata el proceso de opencode en el backend).
- **Dashboard de análisis**: mejor opción destacada + mínimo, promedio, máximo y **ahorro estimado** entre las ofertas disponibles.
- **Filtros y orden**: "Solo disponibles" y orden por menor/ mayor precio o tienda A-Z.
- **Historial**: búsquedas cacheadas con "Ver" (desde cache) y "Actualizar con IA" (`force: true`).
- **Tema claro/oscuro** automático según el sistema, con preferencia guardada en `localStorage`.

Como ahora son más tiendas, la búsqueda puede demorar más — la interfaz tiene un botón **"Cancelar búsqueda"** mientras está en curso, que corta la conexión y mata el proceso de opencode activo en el backend.

### Versión React (`frontend-react/`)

Misma funcionalidad y mismo look & feel, reescrita en **React 18 + Vite**. La lógica de estado vive en `src/App.jsx` ("lifting state up") y cada pieza es un componente: `Header`, `StoreSelector`, `SearchBar`, `LoadingOverlay`, `Dashboard`, `OffersGrid` y `HistoryList`. Las llamadas a la API se centralizan en `src/api.js` y los formatos de precio/fecha en `src/utils.js`. Usa `useMemo` para filtrar y ordenar ofertas y para calcular las estadísticas, y `AbortController` para cancelar la búsqueda en curso. Comparte con la versión vanilla las claves de `localStorage` (`mejorcompras-theme` y `mejorcompras-stores`), así la selección de tiendas y el tema son los mismos en ambas.

---

## Cómo funciona el flujo

```
[Frontend]  →  POST /api/search { query }  →  [Backend Node/Express]
                                                   │
                             ┌─────────────────────┴─────────────────────┐
                             │ ¿Ya está en data/searches/<slug>.json?    │
                             │  Sí → responde desde CACHE (fromCache:true)│
                             │  No → invoca la CLI de opencode:           │
                             │      opencode run "<mensaje de delegación>"│
                             │        --format json --dir <raíz>          │
                             │  El agente principal delega vía la tool    │
                             │  Task al subagente comparador-precios-ar   │
                             └─────────────────────┬─────────────────────┘
                                                   │  El subagente usa websearch/webfetch
                                                   │  y responde JSON con ofertas
                                                   ▼
                              Se guarda en data/ + calcula mejorOpcion
                                                   ▼
                              Respuesta: { query, fromCache, fecha, ofertas[],
                                           mejorOpcion, agente, nota }
```

Puntos clave:

- **Cada búsqueda nueva invoca la CLI de opencode** con un mensaje de delegación hacia el subagente dedicado (`.opencode/agent/comparador-precios-ar.md`). El backend hace `child_process.spawn` (nunca `--auto`, nunca otro scraper) con el **stdin cerrado** para que opencode nunca quede esperando input.
- **Por qué no se usa `--agent <subagente>`:** la CLI de opencode solo acepta agentes primarios con `--agent`; si pasás un subagente, avisa "is a subagent, not a primary agent" y cae al agente principal ignorando el prompt. Por eso el backend delega explícitamente con la tool `Task` (subagent_type `comparador-precios-ar`), que es el mecanismo oficial y determinístico.
- **Cola en serie**: el backend garantiza que nunca se lancen dos procesos de opencode a la vez.
- **Cache persistente**: `data/searches/<slug>.json` + `data/index.json`. Una segunda búsqueda con la misma query devuelve el resultado guardado sin relanzar la IA (salvo que pidas "Actualizar" = `force: true`).
- El backend calcula `mejorOpcion` (menor precio entre las ofertas disponibles).

---

## Requisitos

- **Node.js ≥ 18** (probado con Node v24)
- **opencode CLI ≥ 1.18** disponible en el `PATH` (probado con v1.18.31)
- Un proveedor de IA configurado en opencode (el mismo que usás para este proyecto)
- Sistema operativo: Windows (desarrollado y probado en Windows/pwsh)

---

## Instalación

```powershell
cd F:\mejor_compras
npm install --prefix backend
```

Instala Express (la única dependencia) en `backend/`.

> Nota: el frontend `frontend/` es HTML/CSS/JS puro, no necesita build ni `npm install`.

Si querés usar la **versión React**, instalá sus dependencias y generá el build:

```powershell
cd F:\mejor_compras\frontend-react
npm install
npm run build
```

Eso crea `frontend-react/dist/`. Al reiniciar el backend, la app React queda servida en **http://localhost:3000/react** (si `dist/` no existe, el backend avisa por consola y la ruta no se monta; la versión vanilla sigue funcionando en `/`).

---

## Cómo correr

### 1) Iniciar el backend (sirve API + frontend)

```powershell
cd F:\mejor_compras
npm start --prefix backend
```

En Windows también se puede usar `npm.cmd start --prefix backend` si `npm` da problemas con `.cmd` shims.

### 2) Abrir la app

Entrá a **http://localhost:3000** en el navegador.

- Versión **HTML/CSS/JS**: http://localhost:3000 (no hace falta ningún dev server ni build).
- Versión **React compilada**: http://localhost:3000/react (requiere haber corrido `npm run build` en `frontend-react/`).

El puerto se configura con la env `PORT` (ej. `$env:PORT=4000`).

### 3) (Opcional) Modo desarrollo de React

Para editar la versión React con recarga en vivo (Fast Refresh), en otra terminal:

```powershell
cd F:\mejor_compras\frontend-react
npm run dev
```

Abrí **http://localhost:5173/react/**. Vite hace proxy de `/api` hacia `http://localhost:3000`, así que el backend tiene que estar corriendo igual.

---

## API

| Método | Ruta                 | Descripción                                                       |
|--------|----------------------|-------------------------------------------------------------------|
| GET    | `/api/stores`        | Tiendas configuradas (desde `backend/stores.json`)                 |
| POST   | `/api/stores`        | Agrega una tienda nueva. Body: `{ "nombre": "...", "urlBase": "..." }` (ambos obligatorios; si falta alguno responde 400 y **no** guarda). Guarda en `stores.json` |
| DELETE | `/api/stores/:id`    | Elimina una tienda (id = slug, ej. `easy`). Guarda en `stores.json` |
| POST   | `/api/search`        | Busca un producto. Body: `{ "query": "...", "force": false, "stores": ["Naldo", "Coto"] }` |
| POST   | `/api/search/cancel` | Cancela la búsqueda en curso (mata el proceso de opencode activo)  |
| GET    | `/api/search/:slug`  | Detalle de una búsqueda guardada en cache                          |
| GET    | `/api/history`       | Historial de búsquedas cacheadas                                   |

Ejemplo:

```powershell
curl.exe -X POST http://localhost:3000/api/search `
  -H "Content-Type: application/json" `
  -d '{"query":"TV 32 pulgadas"}'
```

### Formato de oferta (contrato)

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

### Respuesta de `POST /api/search`

```json
{
  "slug": "tv-32-pulgadas",
  "query": "TV 32 pulgadas",
  "fromCache": false,
  "fecha": "2026-09-15T...",
  "agente": "comparador-precios-ar",
  "tiendasConsultadas": ["Naldo", "Carrefour", "Coto"],
  "ofertas": [ ... ],
  "mejorOpcion": { "store": "Coto", "price": 269988, ... },
  "nota": "..."
}
```

Errores: la búsqueda se hace por lotes en paralelo, así que un lote que falla **no** arruina el resultado (los demás se fusionan igual y la `nota` aclara cuántos lotes cayeron). La API responde **502** con un mensaje claro en español solo cuando fallan **todos** los lotes (o si se pasa el watchdog total); el frontend lo muestra de forma amigable. Los timeouts son configurables: `OPENCODE_TIMEOUT_MS` (10 min **por lote**) y `OPENCODE_TIMEOUT_TOTAL_MS` (15 min para la búsqueda completa). Si el usuario cancela la búsqueda desde la interfaz, la API mata **todos** los procesos y responde **499** con `{ "cancelado": true }`, y el frontend lo muestra como cancelación, no como error.

---

## El subagente de opencode

Definición: **`.opencode/agent/comparador-precios-ar.md`**

- Rol: comparador de precios de **solo Argentina**.
- Recibe el producto y **la lista de tiendas a consultar**; el prompt incluye una tabla nombre canónico → URL con las **37 tiendas** del catálogo (`naldo.com.ar`, `carrefour.com.ar`, `coto.com.ar`, `mercadolibre.com.ar`, `oncity.com`, `fravega.com`, `rodo.com.ar`, `tiribellihogar.com.ar`, `feelhome.ar`, `depot.com.ar`, `soscomputacion.com.ar`, `overhard.com.ar`, `axa.com.ar`, `maximus.com.ar`, `mymcomputacion.com`, `ultracomputacion.com`, `venex.com.ar`, `electro5.com.ar`, `electrogv.com.ar`, `quamo.com.ar`, `baires4.com.ar`, `furnitech.com.ar`, `jumbo.com.ar`, `disco.com.ar`, `vea.com.ar`, `changomas.com.ar`, `diaonline.supermercadosdia.com.ar`, `makro.com.ar`, `vitalweb.com.ar`, `diarco.com.ar`, `yaguar.com`, `cetrogar.com.ar`, `megatone.net`, `pardo.com.ar` y Casa del Audio) usando `websearch`/`webfetch`.
- **No inventa precios**: si una tienda no responde o no tiene el producto, devuelve `"available": false` y explica en `nota`.
- Hace **como máximo 1 intento por tienda** (sin reintento) para no eternizar la búsqueda; si igual tarda mucho, el usuario puede cancelarla desde la interfaz.
- `Garbarino` y `Musimundo` siguen en el catálogo **a propósito** (decisión del proyecto), aunque el listado del sector de 2026 los da por quebrados: el agente los marca como no disponibles si el sitio no responde, sin inventar stock ni precios. Se mantienen para seguir consultándolas hasta que sus sitios dejen de responder por completo.
- Responde SIEMPRE con un bloque JSON único (el backend lo extrae de forma robusta aunque el texto traiga prosa alrededor).

Probar el subagente a mano (la CLI delega vía Task como hace el backend):

```powershell
opencode run "Compará precios del producto TV 32 pulgadas. Usá la herramienta Task con subagent_type comparador-precios-ar y devolvé la información que te devuelva ese subagente." --format json --dir F:\mejor_compras
```

---

## Escalado de la búsqueda: lotes en paralelo

El catálogo pasó de 12 a **37 tiendas** (se anexó el listado de comercios de electrodomésticos, computación y sillas/escritorios de CABA). Una sola sesión de opencode que recorriera las 37 con 1 intento por tienda agotaba el timeout de 10 minutos y devolvía `502`. Por eso la búsqueda ahora se hace **por lotes en paralelo**:

1. La lista de tiendas seleccionadas se parte en **lotes de 6** (`partirEnLotes`, en `backend/lib/opencode.js`).
2. Se lanzan hasta **4 procesos de opencode a la vez**, uno por lote, con un pool de concurrencia.
3. Cada lote devuelve su propio JSON y al final se **fusionan** todas las ofertas (`fusionarResultados`): se deduplica por tienda (ignorando mayúsculas **y** acentos) y, si dos lotes trajeran la misma tienda, gana la oferta disponible más barata.

Con las 37 tiendas eso da **7 lotes → 2 tandas de 4**, en lugar de una sesión gigante.

**Ventaja clave: si un lote falla, los demás igual devuelven ofertas.** Las tiendas del lote caído quedan como faltantes y la respuesta lo aclara en `nota` (`Lote(s) con error: 1 de 7: ...`). El `502` total ahora solo aparece si fallan **todos** los lotes.

Cómo se configura (variables de entorno del backend, todas opcionales):

| Variable | Default | Qué hace |
|---|---|---|
| `OPENCODE_BATCH_SIZE` | `6` | Tiendas que entran en cada lote |
| `OPENCODE_CONCURRENCIA` | `4` | Lotes corriendo al mismo tiempo (tope defensivo) |
| `OPENCODE_TIMEOUT_MS` | `600000` | Timeout de **cada lote** (10 min) |
| `OPENCODE_TIMEOUT_TOTAL_MS` | `900000` | Watchdog de la **búsqueda completa** (15 min): si se pasa, mata todos los procesos y avisa |

Otras notas:

1. **La UI te avisa sola:** si marcás **más de 24 tiendas**, en los **dos frontends** aparece un banner ámbar de advertencia arriba del buscador, porque la búsqueda va a necesitar **más de una tanda** de lotes. El número sale del batching (6 tiendas × 4 lotes = 24 en una sola tanda) y vive en la constante `MAX_TIENDAS_RECOMENDADAS` (`frontend/app.js` y `frontend-react/src/App.jsx`). Es solo informativo: **no bloquea la búsqueda**.
2. **Cancelar** ahora mata **todos** los procesos (SIGTERM y, a los 2 s, SIGKILL a los que sigan vivos) y el frontend recibe el `499` de siempre.
3. **Ojo con el cache:** se guarda por query (slug), no por selección de tiendas. Si buscás "TV 32" con 6 tiendas y después querés comparar otro grupo, la segunda búsqueda te va a devolver el cache de la primera. Usá el botón **🔄 Actualizar con IA** del historial (que manda `force: true`) para forzar una consulta nueva con la selección actual.
4. La **cola** de `backend/lib/cola.js` sigue existiendo, pero su invariante cambió: ya no es "un proceso a la vez" sino "**una búsqueda a la vez**" (dentro de una búsqueda puede haber varios procesos en paralelo).
5. Se evaluó y **descartó** paralelizar a nivel de agente (varios `Task` en una sola sesión): depende de que el modelo emita llamadas paralelas, y si las hiciera secuenciales el problema del timeout seguiría igual.

---


```
F:\mejor_compras
├── .opencode/
│   └── agent/
│       └── comparador-precios-ar.md     ← subagente de precios (IA)
├── backend/
│   ├── package.json
│   ├── server.js                        ← API Express + sirve el frontend
│   ├── stores.json                      ← tiendas configurables
│   └── lib/
│       ├── cache.js                     ← lectura/escritura de data/
│       ├── cola.js                      ← cola en serie: una BÚSQUEDA a la vez
│       ├── opencode.js                  ← lotes en paralelo + spawn de opencode + parseo/fusión del JSON
│       └── slug.js                      ← normalización de queries
├── data/
│   ├── index.json                       ← historial (creado al primer uso)
│   └── searches/<slug>.json             ← resultados guardados
├── frontend/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── frontend-react/                      ← versión React (Vite)
│   ├── index.html
│   ├── vite.config.js                   ← base "/react/" + proxy /api
│   ├── package.json
│   ├── dist/                            ← build (generado, no se sube al repo)
│   └── src/
│       ├── main.jsx                     ← punto de entrada
│       ├── App.jsx                      ← estado global y composición
│       ├── api.js                       ← todas las llamadas fetch
│       ├── utils.js                     ← formato de precios y fechas
│       ├── styles.css
│       └── components/
│           ├── Header.jsx
│           ├── StoreSelector.jsx
│           ├── SearchBar.jsx
│           ├── LoadingOverlay.jsx
│           ├── Dashboard.jsx
│           ├── OffersGrid.jsx
│           └── HistoryList.jsx
├── DOCUMENTACION.md                     ← guía didáctica por archivo
└── README.md
```

---

## Advertencias y limitaciones reales

1. **Anti-scraping y JS dinámico**: `carrefour.com.ar` y `coto.com.ar` cargan gran parte del catálogo con JavaScript. El agente accede a lo que puede (páginas de producto accesibles, resultados de `websearch`, URLs de búsqueda) y marca como no disponible lo que no puede verificar.
2. **Robots.txt**: algunas secciones de las tiendas pueden estar excluidas para rastreadores. La herramienta `webfetch` respeta el acceso y puede fallar ante bloqueos.
3. **Los precios pueden variar**: cambian minuto a minuto (ofertas, precios exclusivos digitales, etc.). El resultado es un dato de un momento puntual (ver `fetchedAt`).
4. **La IA puede fallar**: depende del proveedor configurado en opencode, de la conectividad y del estado de los sitios. El backend usa timeouts (10 min por lote, 15 min en total), ejecuta los lotes en paralelo con tope de concurrencia y devuelve errores claros.
5. **Costo de uso**: cada búsqueda nueva ejecuta una sesión real de opencode que consume tokens del proveedor configurado. Usá el cache (o el botón "Ver" del historial) para no repetir búsquedas.
6. Este es un **MVP funcional**: el objetivo es mostrar el flujo agentes + cache, no un scraper perfecto de e-commerce.

---

## Mejoras posibles

- Backoff/reintentos automáticos ante timeouts del agente (hoy un lote que falla se reporta y se sigue).
- Reintentar automáticamente el lote caído una vez, en vez de dejarlo como faltante.
- Umbral de edad del cache (ej. "refrescá si tiene más de 24 h").
- Historial con borrado y exportación.
- Más tiendas agregándolas a `backend/stores.json` (y al prompt del subagente).
- Persistencia del historial en una base (SQLite) si el volumen crece.
- ✅ ~~Búsqueda en paralelo~~: **implementado** como lotes de tiendas en paralelo (ver "Escalado de la búsqueda").
- Confirmar la URL real del canal de venta online de Casa del Audio (hoy no está garantizada).