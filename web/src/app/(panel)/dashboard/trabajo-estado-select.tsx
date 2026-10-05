"use client";

import {useState} from "react";

const ESTADOS = ["PENDIENTE", "EN_PROGRESO", "EN_REVISION", "ENTREGADO"] as const;

const COLOR: Record<string, string> = {
  PENDIENTE: "text-muted border-rule",
  EN_PROGRESO: "text-ochre border-ochre/40",
  EN_REVISION: "text-[#2f5e86] border-[#afc6da]",
  ENTREGADO: "text-moss border-[#b4cca5]",
};

// Selector de estado del TRABAJO. Optimista: aplica el cambio en pantalla y lo
// manda a /api/crm/trabajo-estado (route handler que revalida que el pedido sea
// de tu espacio y agrega la credencial antes de llamar a n8n, que actualiza Supabase).
// Si falla, revierte.
export default function TrabajoEstadoSelect({
  leadId,
  inicial,
  onCambio,
}: {
  leadId: string;
  inicial: string;
  // El componente guarda su propio estado, así que el tablero no se enteraba del
  // cambio hasta la siguiente recarga. Con Realtime deshabilitado para `leads`
  // esa recarga no llega nunca, y las acciones que dependen del estado del
  // trabajo —cerrar el proyecto— no aparecían hasta refrescar a mano.
  onCambio?: (estado: string) => void;
}) {
  const [estado, setEstado] = useState(inicial);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(false);

  async function cambiar(nuevo: string) {
    if (nuevo === estado) return;

    const previo = estado;

    setEstado(nuevo);
    onCambio?.(nuevo);
    setGuardando(true);
    setError(false);

    try {
      const res = await fetch("/api/crm/trabajo-estado", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({lead_id: leadId, estado: nuevo}),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || json.ok === false) throw new Error(json.error ?? `Error ${res.status}`);
    } catch (err) {
      console.error(err);
      setEstado(previo); // revertir
      onCambio?.(previo);
      setError(true);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <select
      className={`bg-card cursor-pointer border px-2.5 py-1.5 text-[11px] tracking-[0.08em] uppercase transition outline-none disabled:opacity-40 ${
        error ? "border-brick text-brick" : (COLOR[estado] ?? "text-ink-soft border-rule")
      }`}
      disabled={guardando}
      value={estado}
      onChange={(e) => cambiar(e.target.value)}
    >
      {ESTADOS.map((s) => (
        <option key={s} className="bg-card text-ink" value={s}>
          {s.replace(/_/g, " ")}
        </option>
      ))}
    </select>
  );
}
