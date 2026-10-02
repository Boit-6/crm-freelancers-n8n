import type {NextRequest} from "next/server";

import {NextResponse} from "next/server";

import {getPanelStatus, requirePanel} from "@/lib/auth";
import {createClient} from "@/lib/supabase/server";

// Proxy server-side de las acciones del panel interno hacia n8n.
//
// Estos webhooks mutan el estado del negocio (cancelar un pedido, resolver un
// pedido de cambios, mover el estado del trabajo) y antes se llamaban directo
// desde el navegador, sin credencial: cualquiera que conociera la URL de n8n
// podía dispararlos. Ahora exigen un header que sólo vive en el servidor.
//
// El formulario público y los enlaces del cliente NO pasan por acá: no pueden
// llevar un secreto (el navegador lo expondría) y se protegen con el token UUID.
//
// Con la plataforma compartida, la credencial del panel es la misma para todos
// los desarrolladores y n8n actúa sobre el lead_id o factura_id que le llegue.
// Por eso, antes de reenviar, se comprueba con la sesión de quien llama que ese
// pedido o esa factura sean de su espacio. La RLS sólo le deja ver los suyos,
// así que uno ajeno aparece como inexistente.

const N8N_BASE = process.env.N8N_BASE ?? process.env.NEXT_PUBLIC_N8N_BASE;
const PANEL_TOKEN = process.env.CRM_PANEL_TOKEN;
const PANEL_HEADER = process.env.CRM_PANEL_HEADER ?? "x-crm-token";

// Lista blanca: la ruta viene de la URL, así que no puede ser cualquier cosa.
const ACCIONES: Record<string, string> = {
  cancelar: "lead-cancelar",
  "cambio-aceptar": "cambio-aceptar",
  "cambio-rechazar": "cambio-rechazar",
  "trabajo-estado": "trabajo-estado",
  cerrar: "proyecto-cerrado",
  "propuesta-enviar": "propuesta-enviar",
  "factura-anular": "factura-anular",
  // No puedo tomarlo: a la bolsa (si el cliente lo autorizó) o descartado.
  "pedido-rechazar": "pedido-rechazar",
  "stripe-conectar": "stripe-conectar",
  "stripe-estado": "stripe-estado",
};

// Acciones sobre el espacio mismo (el alta de cobros con Stripe), no sobre un
// pedido: el espacio lo pone este handler con la sesión, y lo que mande el
// navegador se ignora. Si no, bastaría con cambiar el id en el cuerpo para
// conectar o consultar la cuenta de otro desarrollador.
const ACCIONES_DE_ESPACIO = new Set(["stripe-conectar", "stripe-estado"]);

// Las acciones del panel mandan un lead_id, un factura_id, o los dos. `null` =
// no vino ninguno, o vino uno que no es texto.
async function esDeMiEspacio(body: Record<string, unknown>): Promise<boolean | null> {
  const {lead_id: leadId, factura_id: facturaId} = body;

  if (leadId === undefined && facturaId === undefined) return null;
  for (const id of [leadId, facturaId]) {
    if (id !== undefined && (typeof id !== "string" || !id)) return null;
  }

  const supabase = await createClient();

  if (!supabase) return false;

  if (typeof leadId === "string") {
    const {data} = await supabase
      .from("leads")
      .select("lead_id")
      .eq("lead_id", leadId)
      .maybeSingle();

    if (!data) return false;
  }

  if (typeof facturaId === "string") {
    const {data} = await supabase
      .from("facturas")
      .select("factura_id")
      .eq("factura_id", facturaId)
      .maybeSingle();

    if (!data) return false;
  }

  return true;
}

export async function POST(request: NextRequest, {params}: {params: Promise<{accion: string}>}) {
  const denegado = await requirePanel();

  if (denegado) return denegado;

  const {accion} = await params;
  const ruta = ACCIONES[accion];

  if (!ruta) {
    return NextResponse.json({ok: false, error: `Acción desconocida: ${accion}`}, {status: 404});
  }

  if (!N8N_BASE) {
    return NextResponse.json(
      {
        ok: false,
        error: "Falta N8N_BASE / NEXT_PUBLIC_N8N_BASE en el servidor.",
      },
      {status: 500},
    );
  }

  // Sin la credencial, este proxy es exactamente lo que la nota de arriba
  // dice que ya no puede pasar: mandar la mutación sin ella la deja abierta
  // del lado de n8n. Mejor no mandarla.
  if (!PANEL_TOKEN) {
    return NextResponse.json({ok: false, error: "Configuración incompleta"}, {status: 503});
  }

  let body: unknown;

  if (ACCIONES_DE_ESPACIO.has(accion)) {
    const {espacio} = await getPanelStatus();

    if (!espacio) {
      return NextResponse.json({ok: false, error: "La cuenta no tiene un espacio."}, {status: 403});
    }
    body = {espacio_id: espacio.id};
  } else {
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ok: false, error: "Body inválido."}, {status: 400});
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ok: false, error: "Body inválido."}, {status: 400});
    }

    const propio = await esDeMiEspacio(body as Record<string, unknown>);

    if (propio === null) {
      return NextResponse.json({ok: false, error: "Falta lead_id o factura_id."}, {status: 400});
    }

    // 404 y no 403: no se confirma que exista algo en otro espacio.
    if (!propio) return NextResponse.json({ok: false, error: "No encontrado."}, {status: 404});
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    [PANEL_HEADER]: PANEL_TOKEN,
  };

  // El aviso de ngrok solo aparece detrás de un túnel de desarrollo.
  if (process.env.NODE_ENV === "development") {
    headers["ngrok-skip-browser-warning"] = "true";
  }

  try {
    const res = await fetch(`${N8N_BASE}/webhook/${ruta}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const texto = await res.text();

    if (res.status === 403) {
      return NextResponse.json(
        {
          ok: false,
          error: "n8n rechazó la credencial del panel. Revisá CRM_PANEL_TOKEN.",
        },
        {status: 502},
      );
    }

    // Varias de estas ramas responden HTML o vacío: se normaliza a JSON.
    if (!texto) return NextResponse.json({ok: res.ok}, {status: res.ok ? 200 : res.status});

    try {
      return NextResponse.json(JSON.parse(texto), {status: res.status});
    } catch {
      return NextResponse.json({ok: res.ok, respuesta: texto.slice(0, 500)}, {status: res.status});
    }
  } catch (err) {
    console.error(err);

    return NextResponse.json({ok: false, error: "No se pudo contactar a n8n."}, {status: 502});
  }
}
