"use client";

import {useState} from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";

import {createClient} from "@/lib/supabase/client";
import {translateAuthError} from "@/lib/supabase/auth-errors";
import {cuentasDemo, type CuentaDemo} from "@/lib/demo";

const inputClass =
  "w-full border-b border-rule bg-transparent pt-1 pb-3 text-[15px] text-ink placeholder-mist outline-none transition duration-200 ease hover:border-mist focus:border-ochre";

const labelClass = "mb-2 block text-[10px] tracking-[0.16em] text-faint uppercase";

// Evita el open redirect: un prefijo tipo `startsWith("/")` no alcanza porque
// `/\evil.com` también empieza con "/" y los navegadores normalizan `\` a `/`
// al resolver la URL, terminando en `https://evil.com`. Resolver con `URL` y
// comparar el origin explícitamente cierra ese bypass.
export function redirectSeguro(valor: string | null): string {
  if (!valor) return "/dashboard";
  try {
    const resuelta = new URL(valor, window.location.origin);

    return resuelta.origin === window.location.origin
      ? resuelta.pathname + resuelta.search + resuelta.hash
      : "/dashboard";
  } catch {
    return "/dashboard";
  }
}

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ingresar(credenciales: {email: string; password: string}) {
    setError(null);

    const supabase = createClient();

    if (!supabase) {
      setError("Faltan las variables NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.");

      return;
    }

    setLoading(true);
    try {
      const {error: signInError} = await supabase.auth.signInWithPassword(credenciales);

      if (signInError) throw signInError;

      const redirectTo = new URLSearchParams(window.location.search).get("redirectTo");

      router.push(redirectSeguro(redirectTo));
      router.refresh();
    } catch (err) {
      setError(translateAuthError(err, "No pudimos iniciar sesión."));
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void ingresar({email: email.trim(), password});
  }

  function entrarComoDemo(cuenta: CuentaDemo) {
    setEmail(cuenta.email);
    setPassword(cuenta.clave);
    void ingresar({email: cuenta.email, password: cuenta.clave});
  }

  return (
    <form className="flex flex-col gap-8" onSubmit={handleSubmit}>
      {error && (
        <div
          className="border-brick bg-brick/5 text-brick border-l-2 px-5 py-3.5 text-[13px]"
          id="login-error"
          role="alert"
        >
          {error}
        </div>
      )}

      <div>
        <label className={labelClass} htmlFor="email">
          Email
        </label>
        <input
          required
          aria-describedby={error ? "login-error" : undefined}
          aria-invalid={!!error}
          autoComplete="email"
          className={inputClass}
          id="email"
          name="email"
          placeholder="tu@email.com"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor="password">
          Contraseña
        </label>
        <input
          required
          aria-describedby={error ? "login-error" : undefined}
          aria-invalid={!!error}
          autoComplete="current-password"
          className={inputClass}
          id="password"
          name="password"
          placeholder="••••••••"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      <button
        className="ease bg-ink text-paper hover:bg-ochre w-full py-4.5 text-[11px] font-medium tracking-[0.2em] uppercase transition duration-200 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={loading}
        type="submit"
      >
        {loading ? "Ingresando..." : "Ingresar"}
      </button>

      {cuentasDemo().length > 0 && (
        <div className="border-rule flex flex-col gap-3 border-t pt-6">
          <p className="text-faint text-[10px] tracking-[0.16em] uppercase">Cuentas de la demo</p>
          {cuentasDemo().map((cuenta) => (
            <button
              key={cuenta.email}
              className="border-rule hover:border-ochre ease flex flex-col items-start gap-1 border px-4 py-3 text-left transition duration-200 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={loading}
              type="button"
              onClick={() => entrarComoDemo(cuenta)}
            >
              <span className="text-ink text-[13px]">Entrar como {cuenta.rol.toLowerCase()}</span>
              <span className="text-muted text-[12px]">
                {cuenta.email} · {cuenta.clave}
              </span>
            </button>
          ))}
        </div>
      )}

      <p className="text-muted text-center text-[13px]">
        ¿No tenés cuenta?{" "}
        <Link className="text-ochre underline-offset-4 hover:underline" href="/register">
          Registrate
        </Link>
      </p>
    </form>
  );
}
