import type {Database} from "@/types/supabase";

import {createBrowserClient} from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Solo se usa la publishable / anon key (pública por diseño). La secret key NUNCA va al front.
// Si faltan las variables (p. ej. un build en Vercel sin configurar todavía), exportamos null
// en lugar de romper el build: los consumidores lo detectan y muestran un aviso claro.
export function createClient() {
  if (!supabaseUrl || !supabaseAnonKey) return null;

  return createBrowserClient<Database>(supabaseUrl, supabaseAnonKey);
}
