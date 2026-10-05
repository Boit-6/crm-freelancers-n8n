import {NextResponse, type NextRequest} from "next/server";

import {redirectSeguro} from "../confirm/route";

import {createClient} from "@/lib/supabase/server";

// `?next=`: a dónde volver. El panel de desarrolladores vuelve al login; el de
// clientes, a su página de entrada. Sólo rutas propias (redirectSeguro).
// 303: el navegador sigue el redirect con GET y no reenvía el POST.
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  if (supabase) await supabase.auth.signOut();

  const {origin, searchParams} = new URL(request.url);

  return NextResponse.redirect(redirectSeguro(searchParams.get("next") ?? "/login", origin), 303);
}
