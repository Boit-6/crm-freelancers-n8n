import type {Database} from "@/types/supabase";

import {createServerClient} from "@supabase/ssr";
import {cookies} from "next/headers";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Cliente para Server Components / route handlers. Lee y escribe la sesión vía cookies.
// Igual que el cliente de navegador: si faltan las env vars devolvemos null en lugar de
// romper el build.
export async function createClient() {
  if (!supabaseUrl || !supabaseAnonKey) return null;

  const cookieStore = await cookies();

  return createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const {name, value, options} of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // `setAll` fue llamado desde un Server Component. Se puede ignorar si hay
          // middleware refrescando la sesión en cada request.
        }
      },
    },
  });
}
