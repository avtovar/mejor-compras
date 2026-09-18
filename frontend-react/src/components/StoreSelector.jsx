/* ============================================================
   StoreSelector — Listar, elegir, agregar y eliminar tiendas
   ============================================================ */

import { useState } from "react";

export default function StoreSelector({
  tiendas,
  seleccionadas,
  errorTiendas,
  onToggle,
  onTodas,
  onNinguna,
  onAgregar,
  onEliminar,
}) {
  // Estados locales del formulario de alta y del mensaje de feedback.
  const [mostrarForm, setMostrarForm] = useState(false);
  const [nombre, setNombre] = useState("");
  const [url, setUrl] = useState("");
  const [msg, setMsg] = useState(null); // { tipo: "ok" | "error", texto }

  async function manejarSubmit(e) {
    e.preventDefault();
    const nombreT = nombre.trim();
    const urlT = url.trim();

    if (!nombreT || !urlT) {
      setMsg({
        tipo: "error",
        texto: "Faltan datos: la tienda está incompleta. Completá el nombre y la URL.",
      });
      return;
      // ↑ Validación en el cliente: si falta algo, avisamos y NO llamamos a la API.
    }

    try {
      await onAgregar(nombreT, urlT);
      setNombre("");
      setUrl("");
      setMostrarForm(false);
      setMsg({ tipo: "ok", texto: `Tienda "${nombreT}" agregada.` });
    } catch (err) {
      setMsg({ tipo: "error", texto: err.message });
    }
  }

  async function manejarEliminar(tienda) {
    if (!window.confirm(`¿Eliminar la tienda "${tienda.nombre}"?`)) return;
    // ↑ Diálogo nativo de confirmación: "Aceptar" sigue, "Cancelar" aborta.
    try {
      await onEliminar(tienda);
      setMsg({ tipo: "ok", texto: `Tienda "${tienda.nombre}" eliminada.` });
    } catch (err) {
      setMsg({ tipo: "error", texto: err.message });
    }
  }

  return (
    <div className="card panel-tiendas">
      <div className="panel-header">
        <h3>🏬 Elegir Tiendas</h3>
        <div className="panel-acciones">
          <button className="btn-text" onClick={onTodas}>Todas</button>
          <button className="btn-text" onClick={onNinguna}>Ninguna</button>
          <button
            className="btn-text"
            type="button"
            onClick={() => {
              setMostrarForm((v) => !v);
              setMsg(null);
            }}
          >
            {mostrarForm ? "Cancelar alta" : "+ Agregar tienda"}
            {/* ↑ Muestra/oculta el formulario de alta. */}
          </button>
        </div>
      </div>

      <div className="selector-tiendas">
        {errorTiendas && <p className="error">{errorTiendas}</p>}
        {!errorTiendas && tiendas.length === 0 && (
          <div className="skeleton-tiendas">Cargando tiendas...</div>
        )}

        {tiendas.map((tienda) => {
          const activa = seleccionadas.has(tienda.nombre);
          return (
            <label
              key={tienda.id}
              className={`tienda-check ${activa ? "selected" : ""}`}
            >
              {/* ↑ key ayuda a React a identificar cada chip en la lista. */}
              <input
                type="checkbox"
                checked={activa}
                onChange={() => onToggle(tienda.nombre)}
              />
              <span>{tienda.nombre}</span>
              <button
                type="button"
                className="btn-quitar"
                title={`Eliminar ${tienda.nombre}`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  manejarEliminar(tienda);
                  // ↑ stopPropagation evita que el clic active el checkbox del chip.
                }}
              >
                ×
              </button>
            </label>
          );
        })}
      </div>

      {mostrarForm && (
        <form className="form-agregar-tienda" onSubmit={manejarSubmit} autoComplete="off">
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Nombre (ej: Easy)"
            aria-label="Nombre de la tienda nueva"
            required
          />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://..."
            aria-label="URL base de la tienda nueva"
            required
          />
          <button type="submit" className="btn-agregar">Guardar</button>
          <button
            type="button"
            className="btn-text"
            onClick={() => {
              setMostrarForm(false);
              setNombre("");
              setUrl("");
            }}
          >
            Cancelar
          </button>
        </form>
      )}

      {msg && <p className={`msg-agregar ${msg.tipo}`}>{msg.texto}</p>}
    </div>
  );
}