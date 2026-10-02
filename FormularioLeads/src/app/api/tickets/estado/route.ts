import type {Database} from "@/types/supabase";
import type {NextRequest} from "next/server";

import {NextResponse} from "next/server";

import {requirePanel} from "@/lib/auth";
import {esEstado, esPrioridad} from "@/lib/tickets";
import {createClient} from "@/lib/supabase/server";

// POST /api/tickets/estado → mueve un ticket de columna, le cambia la
// prioridad o las notas. Mover o cambiar la prioridad reinicia el reloj del
// envejecimiento (trigger trg_tickets_movimiento en la base).
export async function POST(request: NextRequest) {
  const denegado = await requirePanel();

  if (denegado) return denegado;

  let body: Record<string, unknown>;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ok: false, error: "Body inválido."}, {status: 400});
  }

  const ticketId = String(body.ticket_id ?? "").trim();

  if (!/^[0-9a-f-]{36}$/i.test(ticketId)) {
    return NextResponse.json({ok: false, error: 'Falta "ticket_id".'}, {status: 400});
  }

  const cambios: Database["public"]["Tables"]["tickets"]["Update"] = {};

  if (body.estado !== undefined) {
    const estado = String(body.estado).toUpperCase();

    if (!esEstado(estado))
      return NextResponse.json({ok: false, error: `Estado inválido: ${estado}.`}, {status: 400});
    cambios.estado = estado;
  }
  if (body.prioridad !== undefined) {
    const prioridad = String(body.prioridad).toUpperCase();

    if (!esPrioridad(prioridad)) {
      return NextResponse.json(
        {ok: false, error: `Prioridad inválida: ${prioridad}.`},
        {status: 400},
      );
    }
    cambios.prioridad = prioridad;
  }
  if (body.notas !== undefined)
    cambios.notas = body.notas ? String(body.notas).slice(0, 2000) : null;

  if (Object.keys(cambios).length === 0) {
    return NextResponse.json({ok: false, error: "No hay nada que cambiar."}, {status: 400});
  }

  const supabase = await createClient();

  if (!supabase)
    return NextResponse.json({ok: false, error: "Supabase no disponible."}, {status: 500});

  const {data, error} = await supabase
    .from("tickets")
    .update(cambios)
    .eq("id", ticketId)
    .select("id");

  if (error) {
    console.error(error);

    return NextResponse.json({ok: false, error: "No se pudo actualizar el ticket."}, {status: 502});
  }
  if (!data?.length)
    return NextResponse.json({ok: false, error: "Ticket inexistente."}, {status: 404});

  return NextResponse.json({ok: true});
}
