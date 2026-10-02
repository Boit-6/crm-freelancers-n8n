import type {ReactNode} from "react";

import PanelShell from "./panel-shell";

import {esAdminPlataforma, getPanelUser} from "@/lib/auth";

// El gate del panel tiene que correr en cada request, no una sola vez al
// buildear: sin esto, si createClient() devuelve null (env vars de Supabase
// ausentes en build), la verificación de sesión nunca llama cookies() y
// Next.js puede prerenderizar el panel como estático.
export const dynamic = "force-dynamic";

// Estructura del panel: menú lateral en la PC y pestañas abajo en el celular.
// Envuelve también /dashboard/espacio, que es donde cae una cuenta nueva.
export default async function PanelLayout({children}: {children: ReactNode}) {
  const {user, espacio} = await getPanelUser();
  const admin = await esAdminPlataforma(user.id);

  return (
    <PanelShell
      admin={admin}
      configurado={Boolean(espacio.configurado_en)}
      email={user.email ?? ""}
      espacio={{nombre: espacio.nombre, slug: espacio.slug}}
    >
      {children}
    </PanelShell>
  );
}
