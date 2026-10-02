import type {NextRequest} from "next/server";

import {NextResponse} from "next/server";

import {requirePanel} from "@/lib/auth";
import {ESTADOS, PRIORIDADES, aTicket, esEstado, esPrioridad} from "@/lib/tickets";
import {createClient} from "@/lib/supabase/server";

// GET /api/tickets?estado=&prioridad=&abiertos=&limite=
export async function GET(request: NextRequest) {
  const denegado = await requirePanel();

  if (denegado) return denegado;

  const supabase = await createClient();

  if (!supabase)
    return NextResponse.json({ok: false, error: "Supabase no disponible."}, {status: 500});

  const q = request.nextUrl.searchParams;
  const limite = Math.max(1, Math.min(200, Number(q.get("limite")) || 100));
  let consulta = supabase.from("tickets_tablero").select("*");

  const estado = q.get("estado")?.toUpperCase();
  const prioridad = q.get("prioridad")?.toUpperCase();

  if (esEstado(estado)) consulta = consulta.eq("estado", estado);
  else if (q.get("abiertos") !== "false") consulta = consulta.neq("estado", "HECHO");
  if (esPrioridad(prioridad)) consulta = consulta.eq("prioridad", prioridad);

  // Uno de más para saber si quedó algo afuera.
  const {data, error} = await consulta
    .order("score", {ascending: false})
    .order("creado_en", {ascending: false})
    .limit(limite + 1);

  if (error) {
    console.error(error);

    return NextResponse.json({ok: false, error: "No se pudieron leer los tickets."}, {status: 502});
  }

  const tickets = (data ?? [])
    .slice(0, limite)
    .map(aTicket)
    .filter((t) => t !== null);

  return NextResponse.json({
    ok: true,
    total: tickets.length,
    truncado: (data ?? []).length > limite,
    estados: [...ESTADOS],
    prioridades: [...PRIORIDADES],
    tickets,
  });
}

// POST /api/tickets → crea un ticket desde el tablero
export async function POST(request: NextRequest) {
  const denegado = await requirePanel();

  if (denegado) return denegado;

  let body: Record<string, unknown>;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ok: false, error: "Body inválido."}, {status: 400});
  }

  const titulo = String(body.titulo ?? "").trim();

  if (!titulo) return NextResponse.json({ok: false, error: 'Falta "titulo".'}, {status: 400});
  if (titulo.length > 200) {
    return NextResponse.json(
      {ok: false, error: "El título admite hasta 200 caracteres."},
      {status: 400},
    );
  }

  const prioridad = String(body.prioridad ?? "MEDIA").toUpperCase();

  if (!esPrioridad(prioridad)) {
    return NextResponse.json(
      {ok: false, error: `Prioridad inválida: ${prioridad}.`},
      {status: 400},
    );
  }

  const etiquetas = (Array.isArray(body.etiquetas) ? body.etiquetas : [])
    .map((e) => String(e).trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, 10);
  const vence = /^\d{4}-\d{2}-\d{2}$/.test(String(body.vence ?? "")) ? String(body.vence) : null;
  const notas = body.notas ? String(body.notas).slice(0, 2000) : null;

  const supabase = await createClient();

  if (!supabase)
    return NextResponse.json({ok: false, error: "Supabase no disponible."}, {status: 500});

  const {data, error} = await supabase
    .from("tickets")
    .insert({
      titulo,
      prioridad,
      prioridad_inicial: prioridad,
      etiquetas,
      notas,
      vence,
      origen: "DASHBOARD",
    })
    .select("id")
    .single();

  if (error) {
    console.error(error);

    return NextResponse.json({ok: false, error: "No se pudo crear el ticket."}, {status: 502});
  }

  return NextResponse.json({ok: true, ticket_id: data.id}, {status: 201});
}
