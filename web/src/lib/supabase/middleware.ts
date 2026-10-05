import {createServerClient} from "@supabase/ssr";
import {NextResponse, type NextRequest} from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Rutas internas que requieren sesión, y a dónde se entra en cada caso: los
// desarrolladores con contraseña, los clientes con enlace mágico.
const PROTECTED_ROUTES = [
  {prefijo: "/dashboard", entrada: "/login"},
  {prefijo: "/cliente", entrada: "/cliente/entrar", salvo: "/cliente/entrar"},
];

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({request});

  // Si faltan las env vars dejamos pasar el request tal cual: el consumidor final
  // (páginas/componentes) ya muestra un aviso claro cuando `supabase` es null.
  if (!supabaseUrl || !supabaseAnonKey) return supabaseResponse;

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const {name, value} of cookiesToSet) {
          request.cookies.set(name, value);
        }

        supabaseResponse = NextResponse.next({request});

        for (const {name, value, options} of cookiesToSet) {
          supabaseResponse.cookies.set(name, value, options);
        }
      },
    },
  });

  // No usar getSession() acá: getUser() revalida el token contra Supabase Auth en
  // vez de confiar en la cookie tal cual.
  const {
    data: {user},
  } = await supabase.auth.getUser();

  const {pathname} = request.nextUrl;
  const protegida = PROTECTED_ROUTES.find(
    (r) => pathname.startsWith(r.prefijo) && !(r.salvo && pathname.startsWith(r.salvo)),
  );

  if (protegida && !user) {
    const url = request.nextUrl.clone();

    url.pathname = protegida.entrada;
    url.searchParams.set("redirectTo", request.nextUrl.pathname);

    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
