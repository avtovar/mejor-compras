# 🛒 MejorCompras

Comparador de precios argentino: escribís un producto (ej. "TV 32 pulgadas") y la app te devuelve la **mejor opción** comparando precios en **Naldo**, **Carrefour** y **Coto**. La búsqueda real la hace un **agente de IA de opencode** y los resultados quedan **guardados en el repo** (`data/`) como cache persistente para futuras búsquedas iguales.

Solo Argentina: moneda ARS y tiendas argentinas.

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

> Nota: el frontend es HTML/CSS/JS puro, no necesita build ni `npm install`.

---

## Cómo correr

### 1) Iniciar el backend (sirve API + frontend)

```powershell
cd F:\mejor_compras
npm start --prefix backend
```

o directamente:

```powershell
cd F:\mejor_compras\backend
npm start
```

El servidor queda en **http://localhost:3000** (configurable con la env `PORT`, ej. `$env:PORT=4000`).

### 2) Abrir la app

Entrá a **http://localhost:3000** en el navegador. No hace falta ningún dev server ni build.

---

## API

| Método | Ruta                 | Descripción                                                       |
|--------|----------------------|-------------------------------------------------------------------|
| GET    | `/api/stores`        | Tiendas configuradas (desde `backend/stores.json`)                 |
| POST   | `/api/search`        | Busca un producto. Body: `{ "query": "...", "force": false }`      |
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

Errores: si el agente falla o se agota el timeout (360 s por defecto), la API responde **502** con un mensaje claro en español y el frontend lo muestra de forma amigable.

---

## El subagente de opencode

Definición: **`.opencode/agent/comparador-precios-ar.md`**

- Rol: comparador de precios de **solo Argentina**.
- Recibe el producto por input y busca en `naldo.com.ar`, `carrefour.com.ar` y `coto.com.ar` usando `websearch`/`webfetch`.
- **No inventa precios**: si una tienda no responde o no tiene el producto, devuelve `"available": false` y explica en `nota`.
- Responde SIEMPRE con un bloque JSON único (el backend lo extrae de forma robusta aunque el texto traiga prosa alrededor).

Probar el subagente a mano (la CLI delega vía Task como hace el backend):

```powershell
opencode run "Compará precios del producto TV 32 pulgadas. Usá la herramienta Task con subagent_type comparador-precios-ar y devolvé la información que te devuelva ese subagente." --format json --dir F:\mejor_compras
```

---

## Estructura del proyecto

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
│       ├── cola.js                      ← cola en serie para opencode
│       ├── opencode.js                  ← spawn de opencode + parseo del JSON
│       └── slug.js                      ← normalización de queries
├── data/
│   ├── index.json                       ← historial (creado al primer uso)
│   └── searches/<slug>.json             ← resultados guardados
├── frontend/
│   ├── index.html
│   ├── style.css
│   └── app.js
└── README.md
```

---

## Advertencias y limitaciones reales

1. **Anti-scraping y JS dinámico**: `carrefour.com.ar` y `coto.com.ar` cargan gran parte del catálogo con JavaScript. El agente accede a lo que puede (páginas de producto accesibles, resultados de `websearch`, URLs de búsqueda) y marca como no disponible lo que no puede verificar.
2. **Robots.txt**: algunas secciones de las tiendas pueden estar excluidas para rastreadores. La herramienta `webfetch` respeta el acceso y puede fallar ante bloqueos.
3. **Los precios pueden variar**: cambian minuto a minuto (ofertas, precios exclusivos digitales, etc.). El resultado es un dato de un momento puntual (ver `fetchedAt`).
4. **La IA puede fallar**: depende del proveedor configurado en opencode, de la conectividad y del estado de los sitios. El backend usa timeout (360 s), reintenta vía cola y devuelve errores claros.
5. **Costo de uso**: cada búsqueda nueva ejecuta una sesión real de opencode que consume tokens del proveedor configurado. Usá el cache (o el botón "Ver" del historial) para no repetir búsquedas.
6. Este es un **MVP funcional**: el objetivo es mostrar el flujo agentes + cache, no un scraper perfecto de e-commerce.

---

## Mejoras posibles

- Backoff/reintentos automáticos ante timeouts del agente.
- Umbral de edad del cache (ej. "refrescá si tiene más de 24 h").
- Historial con borrado y exportación.
- Más tiendas agregándolas a `backend/stores.json` (y al prompt del subagente).
- Persistencia del historial en una base (SQLite) si el volumen crece.