/* ============================================================
   OffersGrid — Toolbar de filtros/orden + grilla de ofertas
   ============================================================ */

import { formatearPrecio } from "../utils.js";

export default function OffersGrid({
  ofertas,
  filtroDisponibles,
  onFiltro,
  orden,
  onOrden,
}) {
  return (
    <>
      <div className="toolbar-resultados">
        <h3 className="resumen-conteo">{ofertas.length} ofertas encontradas</h3>
        <div className="filtros-acciones">
          <label className="checkbox-wrapper">
            <input
              type="checkbox"
              checked={filtroDisponibles}
              onChange={onFiltro}
            />
            {/* ↑ Checkbox controlado: al cambiarlo, App recalcula la lista. */}
            <span>Solo disponibles</span>
          </label>
          <div className="select-wrapper">
            <span>↕</span>
            <select value={orden} onChange={(e) => onOrden(e.target.value)}>
              <option value="precio-asc">Menor precio</option>
              <option value="precio-desc">Mayor precio</option>
              <option value="tienda-asc">Tienda A-Z</option>
            </select>
            {/* ↑ Select controlado: cada value define el criterio de orden. */}
          </div>
        </div>
      </div>

      <div className="grid-ofertas">
        {ofertas.length === 0 ? (
          <p className="nota">No hay ofertas que coincidan con los filtros.</p>
        ) : (
          ofertas.map((o, i) => (
            <article className="card card-oferta" key={`${o.store}-${i}`}>
              {/* ↑ key combinada tienda+índice para evitar repetidos. */}
              <div className="oferta-header">
                <span className="badge-tienda">{o.store}</span>
              </div>
              <h4 className="oferta-titulo">{o.title}</h4>
              <div className="oferta-footer">
                {o.available && typeof o.price === "number" ? (
                  <>
                    <div className="oferta-precio">{formatearPrecio(o.price)}</div>
                    <a
                      className="btn-secondary"
                      href={o.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Ver Producto ↗
                    </a>
                  </>
                ) : (
                  <div className="oferta-no-disponible">No disponible</div>
                  // ↑ Si el agente no pudo verificar la oferta, mostramos el cartel.
                )}
              </div>
            </article>
          ))
        )}
      </div>
    </>
  );
}