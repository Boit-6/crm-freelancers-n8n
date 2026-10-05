import type {ServicioTipo} from "@/types/supabase";
import type {User} from "@supabase/supabase-js";

import {redirect} from "next/navigation";
import {cache} from "react";
import {NextResponse} from "next/server";

import {createClient} from "@/lib/supabase/server";

// El espacio del desarrollador: la plataforma es compartida y cada cuenta
// confirmada tiene uno (lo crea la base al confirmar el correo).
export interface Espacio {
  id: string;
  slug: string;
  nombre: string;
  // A dónde le llegan las respuestas de los clientes (Reply-To).
  email_contacto: string | null;
  // Telegram vinculado para los avisos (opcional).
  telegram_chat_id: string | null;
  // Cobros con Stripe Connect: la cuenta del desarrollador y si ya puede cobrar.
  stripe_account_id: string | null;
  stripe_cobros_activos: boolean;
  // NULL hasta que el dueño elige nombre y dirección (alta).
  configurado_en: string | null;
  // Perfil público (/d/<slug>).
  presentacion: string | null;
  habilidades: string[];
  portfolio_urls: string[];
  // Servicios que ofrece (directorio y alertas) y preferencias de alerta.
  servicios: ServicioTipo[];
  alerta_presupuesto_min: number | null;
  alertas_correo: boolean;
}

export interface EstadoPanel {
  user: User | null;
  espacio: Espacio | null;
  supabaseDisponible: boolean;
}

// Núcleo compartido de la compuerta del panel: sesión + un espacio propio.
// Hasta el 23-sep-2026 se exigía profiles.role === 'admin'; ese rol quedó para
// el administrador de la plataforma y no da acceso a los datos de nadie.
// No redirige ni responde nada — cada consumidor decide cómo comunicar el
// resultado (una Server Component redirige, un route handler responde JSON).
export async function getPanelStatus(): Promise<EstadoPanel> {
  const supabase = await createClient();

  if (!supabase) return {user: null, espacio: null, supabaseDisponible: false};

  const {
    data: {user},
  } = await supabase.auth.getUser();

  if (!user) return {user: null, espacio: null, supabaseDisponible: true};

  const {data: espacio} = await supabase
    .from("espacios")
    .select(
      "id, slug, nombre, email_contacto, telegram_chat_id, stripe_account_id, stripe_cobros_activos, configurado_en, presentacion, habilidades, portfolio_urls, servicios, alerta_presupuesto_min, alertas_correo",
    )
    .eq("dueno_id", user.id)
    .maybeSingle();

  return {user, espacio: espacio ?? null, supabaseDisponible: true};
}

// Compuerta de las páginas del panel: exige sesión + espacio, o redirige (sin
// sesión -> /login; una cuenta de cliente -> su panel; otra cuenta sin
// espacio, que es una sin confirmar -> /).
export async function getPanelUser(): Promise<{
  user: User;
  espacio: Espacio;
}> {
  const {user, espacio} = await getPanelStatus();

  if (!user) redirect("/login");
  if (!espacio) redirect((await tipoDeCuenta()) === "cliente" ? "/cliente" : "/");

  return {user, espacio};
}

// ¿La cuenta con sesión es el admin de la plataforma? Sólo le suma la
// sección de disputas (etapa 11): no le da acceso a los datos de nadie. Cada
// uno lee sólo su fila de profiles; la base vuelve a exigir el rol en cada
// función de disputas. cache(): el layout y la página lo piden en el mismo
// request, y así se consulta una sola vez. Si la consulta falla, no es admin.
export const esAdminPlataforma = cache(async (userId: string): Promise<boolean> => {
  const supabase = await createClient();

  if (!supabase) return false;

  const {data, error} = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error) console.error("No se pudo leer el rol de la cuenta:", error.message);

  return data?.role === "admin";
});

export type TipoCuenta = "desarrollador" | "cliente";

// El tipo de la cuenta con sesión (lo fija la base al crearla), o null sin
// sesión. Cada uno lee sólo su fila de profiles.
export async function tipoDeCuenta(): Promise<TipoCuenta | null> {
  const supabase = await createClient();

  if (!supabase) return null;

  const {
    data: {user},
  } = await supabase.auth.getUser();

  if (!user) return null;

  const {data} = await supabase.from("profiles").select("tipo").eq("id", user.id).maybeSingle();

  return data?.tipo === "cliente" ? "cliente" : "desarrollador";
}

// Compuerta del panel de clientes: sin sesión, a la página de entrada; una
// cuenta de desarrollador, a su panel.
export async function getClienteUser(): Promise<User> {
  const supabase = await createClient();

  if (!supabase) redirect("/cliente/entrar");

  const {
    data: {user},
  } = await supabase.auth.getUser();

  if (!user) redirect("/cliente/entrar");
  if ((await tipoDeCuenta()) !== "cliente") redirect("/dashboard");

  return user;
}

// Compuerta de los route handlers: no pasan por el gate de /dashboard, así que
// cada uno revalida sesión + espacio por su cuenta. La RLS vuelve a exigir el
// espacio del lado de la base.
export async function requirePanel() {
  const {user, espacio, supabaseDisponible} = await getPanelStatus();

  if (!supabaseDisponible) {
    return NextResponse.json(
      {ok: false, error: "Faltan las variables de Supabase en el servidor."},
      {status: 500},
    );
  }

  if (!user) return NextResponse.json({ok: false, error: "No autenticado."}, {status: 401});

  if (!espacio) {
    return NextResponse.json({ok: false, error: "La cuenta no tiene un espacio."}, {status: 403});
  }

  return null;
}
