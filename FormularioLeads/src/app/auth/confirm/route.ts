import type {EmailOtpType} from "@supabase/supabase-js";

import {NextResponse, type NextRequest} from "next/server";

import {createClient} from "@/lib/supabase/server";

// Evita el open redirect: `new URL(next, origin)` resuelve tal cual una URL
// absoluta en `next` (ignora `origin` como base), así que hay que comparar el
// origin resultante explícitamente en vez de confiar en el prefijo del string.
export function redirectSeguro(valor: string, origin: string): URL {
  try {
    const resuelta = new URL(valor, origin);

    return resuelta.origin === origin ? resuelta : new URL("/dashboard", origin);
  } catch {
    return new URL("/dashboard", origin);
  }
}

// Maneja los enlaces que manda Supabase Auth: la confirmación del registro
// de desarrolladores y el enlace mágico de los clientes (`emailRedirectTo:
// /auth/confirm?next=...`). Llegan de dos formas según la plantilla del correo:
// - `token_hash` + `type`: plantilla personalizada que apunta directo acá.
//   Anda aunque el enlace se abra en otro dispositivo.
// - `code`: plantilla por defecto (pasa por /auth/v1/verify y vuelve con el
//   código PKCE). Sólo se canjea en el mismo navegador donde se pidió, que es
//   el que guardó el verificador. Hasta el 24-sep-2026 esta forma no se
//   aceptaba: la cuenta quedaba confirmada pero sin sesión y con un error.
export async function GET(request: NextRequest) {
  const {searchParams, origin} = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";
  const supabase = tokenHash || code ? await createClient() : null;

  if (supabase && tokenHash && type) {
    const {error} = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });

    if (!error) return NextResponse.redirect(redirectSeguro(next, origin));
  } else if (supabase && code) {
    const {error} = await supabase.auth.exchangeCodeForSession(code);

    if (!error) return NextResponse.redirect(redirectSeguro(next, origin));
  }

  const errorUrl = new URL("/login", origin);

  errorUrl.searchParams.set("error", "No pudimos confirmar el email. Probá iniciar sesión.");

  return NextResponse.redirect(errorUrl);
}
