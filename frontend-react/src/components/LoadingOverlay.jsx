/* ============================================================
   LoadingOverlay — Pantalla de carga mientras busca la IA
   ============================================================ */

export default function LoadingOverlay({ visible, onCancelar }) {
  if (!visible) return null;
  // ↑ Si no está cargando, no renderiza nada (equivalente a hidden).

  return (
    <div className="estado-overlay">
      <div className="estado-card">
        <div className="spinner"></div>
        {/* ↑ Círculo animado (CSS con @keyframes spin). */}
        <div className="estado-info">
          <h3>Analizando precios...</h3>
          <p>Consultando tiendas argentinas con agentes de IA.</p>
        </div>
        <button type="button" className="btn-cancelar" onClick={onCancelar}>
          ✕ Cancelar
          {/* ↑ Corta el fetch y le avisa al backend que mate el proceso de opencode. */}
        </button>
      </div>
    </div>
  );
}