/* ============================================================
   Header — Barra superior con logo y botón de tema
   ============================================================ */

export default function Header({ tema, onToggleTema }) {
  return (
    <header className="encabezado">
      <div className="encabezado-content">
        <div className="logo-area">
          <span className="logo-emoji">🛒</span>
          {/* ↑ Emoji del logo (sin imágenes externas). */}
          <div>
            <h1>MejorCompras</h1>
            <p>Comparador Inteligente de Precios · React</p>
          </div>
        </div>

        <button
          id="btn-tema"
          className="btn-icon"
          title="Cambiar tema"
          onClick={onToggleTema}
        >
          {/* ↑ Al hacer clic, App alterna el tema claro/oscuro. */}
          {tema === "dark" ? "☀️" : "🌙"}
          {/* ↑ Si está en oscuro muestra sol (para pasar a claro) y viceversa. */}
        </button>
      </div>
    </header>
  );
}