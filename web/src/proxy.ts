import type {NextRequest} from "next/server";

import {updateSession} from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

// Sólo donde el servidor usa la sesión: el panel, sus route handlers y el
// callback de confirmación/cierre de sesión. updateSession() hace un viaje a
// Supabase Auth (getUser) por request; antes corría también en las páginas
// públicas (formulario, aceptación de propuesta, privacidad, resultado del
// pago), que no leen la sesión, y cada visita pagaba esa latencia. Login y
// registro usan el cliente del navegador, que maneja sus propias cookies.
export const config = {
  matcher: ["/dashboard/:path*", "/cliente/:path*", "/publicar", "/api/:path*", "/auth/:path*"],
};
