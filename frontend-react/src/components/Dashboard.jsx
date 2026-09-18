/* ============================================================
   Dashboard — Mejor opción + estadísticas de precios
   ============================================================ */

import { formatearPrecio } from "../utils.js";

export default function Dashboard({ stats }) {
  if (!stats) return null;
  // ↑ Sin ofertas disponibles no hay nada que mostrar (App lo maneja).

  const { min, avg, max, ahorro, mejor } = stats;

  return (
    <div className="dashboard-analisis">
      <div className="card stats-card mejor-opcion-destacada">
        <div className="stats-label">🏆 MEJOR OPCIÓN</div>
        <div className="mejor-opcion-content">
          <div className="mejor-info">
            <h2>{mejor.title}</h2>
            <p>Tienda: {mejor.store}</p>
            <div className="precio-hero">{formatearPrecio(mejor.price)}</div>
          </div>
          <a
            className="btn-primary"
            href={mejor.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Ir a la tienda ↗
            {/* ↑ Enlace a la oferta ganadora, en pestaña nueva. */}
          </a>
        </div>
      </div>

      <div className="stats-grid">
        <div className="card stat-item">
          <div className="stat-label">Mínimo</div>
          <div className="stat-value text-green">{formatearPrecio(min)}</div>
        </div>
        <div className="card stat-item">
          <div className="stat-label">Promedio</div>
          <div className="stat-value">{formatearPrecio(avg)}</div>
        </div>
        <div className="card stat-item">
          <div className="stat-label">Máximo</div>
          <div className="stat-value">{formatearPrecio(max)}</div>
        </div>
        <div className="card stat-item highlight">
          <div className="stat-label">Ahorro Estimado</div>
          <div className="stat-value text-green">{formatearPrecio(ahorro)}</div>
          {/* ↑ Ahorro = máximo − mínimo entre las ofertas disponibles. */}
        </div>
      </div>
    </div>
  );
}