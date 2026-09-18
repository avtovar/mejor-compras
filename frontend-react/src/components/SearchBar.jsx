/* ============================================================
   SearchBar — Input de búsqueda + botón "Buscar con IA"
   ============================================================ */

export default function SearchBar({ query, onQuery, onBuscar, cargando }) {
  function manejarSubmit(e) {
    e.preventDefault();
    // ↑ preventDefault evita que el formulario recargue la página.
    const q = query.trim();
    if (q) onBuscar(q, false);
    // ↑ Solo busca si el input no está vacío.
  }

  return (
    <form className="buscador" onSubmit={manejarSubmit} autoComplete="off">
      <div className="input-wrapper">
        <span className="icon-search">🔎</span>
        {/* ↑ Lupa decorativa posicionada dentro del input. */}
        <input
          type="text"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="¿Qué estás buscando? (ej: TV 55, Heladera, Zapatillas...)"
          aria-label="Producto a buscar"
          required
        />
        {/* ↑ Input controlado: su valor vive en el estado de App (prop query). */}
      </div>
      <button id="btn-buscar" type="submit" disabled={cargando}>
        <span>Buscar con IA</span>
        <span>✨</span>
        {/* ↑ Se deshabilita mientras hay una búsqueda en curso. */}
      </button>
    </form>
  );
}