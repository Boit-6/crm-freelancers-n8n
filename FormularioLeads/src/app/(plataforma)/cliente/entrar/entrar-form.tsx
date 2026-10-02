"use client";

import {useState} from "react";

import {createClient} from "@/lib/supabase/client";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Entrada de clientes con enlace mágico. `data: {tipo: 'cliente'}` sólo se usa
// si la cuenta es nueva: la base la marca como cliente y no le crea espacio.
// Si el correo ya es de una cuenta, Supabase manda el enlace para entrar.
export default function EntrarClienteForm() {
  const [email, setEmail] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valido = EMAIL_REGEX.test(email.trim());

  if (enviado) {
    return (
      <div className="border-rule-soft bg-card flex flex-col gap-3 border px-7 py-8" role="status">
        <h2 className="text-ink font-serif text-[26px] leading-tight">Revisá tu correo.</h2>
        <p className="text-muted text-[14.5px] leading-relaxed">
          Te mandamos un enlace a <b className="text-ink">{email.trim()}</b>. Abrilo en este mismo
          navegador para entrar.
        </p>
      </div>
    );
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-6"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valido || enviando) return;

        const supabase = createClient();

        if (!supabase) {
          setError("Faltan las variables de Supabase.");

          return;
        }

        setEnviando(true);
        setError(null);

        const {error: err} = await supabase.auth.signInWithOtp({
          email: email.trim(),
          options: {
            emailRedirectTo: `${window.location.origin}/auth/confirm?next=/cliente`,
            data: {tipo: "cliente"},
          },
        });

        setEnviando(false);
        if (err) setError("No pudimos mandar el enlace. Probá de nuevo en un rato.");
        else setEnviado(true);
      }}
    >
      <label className="flex flex-col gap-2">
        <span className="text-faint text-[10px] tracking-[0.16em] uppercase">Tu correo</span>
        <input
          required
          autoComplete="email"
          className="border-rule text-ink placeholder-mist hover:border-mist focus:border-ochre w-full border-b bg-transparent pt-1 pb-3 text-[15px] transition duration-200 outline-none"
          placeholder="tu@email.com"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      {error && (
        <p className="text-brick text-[13px]" role="alert">
          {error}
        </p>
      )}
      <button
        className="ease bg-ink text-paper hover:bg-ochre w-full py-4 text-[11px] font-medium tracking-[0.2em] uppercase transition duration-200 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={!valido || enviando}
        type="submit"
      >
        {enviando ? "Enviando…" : "Mandame el enlace"}
      </button>
    </form>
  );
}
