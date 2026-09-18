/* ============================================================
   HistoryList — Búsquedas guardadas en cache
   ============================================================ */

import { formatearFecha } from "../utils.js";

export default function HistoryList({ items, onVer, onActualizar }) {
  return (
    <section className="historial">
      <div className="section-header">
        <h3>🕒 Búsquedas recientes</h3>
      </div>

      {items.length === 0 ? (
        <p className="nota-vacia">Todavía no hay búsquedas guardadas.</p>
      ) : (
        <div className="lista-historial">
          {items.map((item) => (
            <div className="card historial-item" key={item.slug}>
              <div className="historial-info">
                <span className="h-query">{item.query}</span>
                <span className="h-meta">
                  {(item.tiendas || []).length} tiendas · {formatearFecha(item.fecha)}
                </span>
              </div>
              <div className="historial-acciones">
                <button
                  className="btn-icon btn-ver"
                  title="Ver guardado"
                  onClick={() => onVer(item)}
                >
                  👁
                  {/* ↑ Muestra el resultado cacheado sin gastar IA. */}
                </button>
                <button
                  className="btn-icon btn-refresh"
                  title="Actualizar con IA"
                  onClick={() => onActualizar(item)}
                >
                  🔄
                  {/* ↑ Vuelve a buscar con force:true para refrescar precios. */}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}