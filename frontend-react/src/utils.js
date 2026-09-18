/* ============================================================
   MejorCompras (React) — Helpers de formato
   ============================================================ */

/** Formatea un número como moneda argentina: 123456 → "$ 123.456". */
export function formatearPrecio(numero) {
  if (numero === null || numero === undefined || isNaN(numero)) return "N/D";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(numero);
}

/** Formatea una fecha ISO a un texto legible en español argentino. */
export function formatearFecha(iso) {
  try {
    return new Date(iso).toLocaleString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}