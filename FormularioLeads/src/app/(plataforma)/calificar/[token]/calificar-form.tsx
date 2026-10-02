"use client";

import {useState} from "react";

import {createClient} from "@/lib/supabase/client";

const ETIQUETAS = ["Muy malo", "Malo", "Bien", "Muy bien", "Excelente"];
const RUTA = "M12 2.8l2.8 5.7 6.3.9-4.6 4.4 1.1 6.2L12 17l-5.6 3 1.1-6.2L2.9 9.4l6.3-.9z";

const tarjetaClass =
  "border-rule-soft bg-card border shadow-[0_1px_2px_rgba(25,23,19,0.04),0_12px_32px_-18px_rgba(25,23,19,0.18)]";

function Aviso({titulo, children}: {titulo: string; children: React.ReactNode}) {
  return (
    <div className={`${tarjetaClass} flex flex-col gap-3 px-8 py-10`} role="status">
      <h2 className="text-ink font-serif text-[28px] leading-tight">{titulo}</h2>
      <p className="text-muted text-[14.5px] leading-relaxed">{children}</p>
    </div>
  );
}

// Estrellas como un grupo de radios: se eligen con el mouse, el dedo o las
// flechas del teclado, y cada una se anuncia con su etiqueta.
export default function CalificarForm({
  token,
  pendiente,
}: {
  token: string;
  pendiente: {
    espacio_nombre: string;
    cliente_nombre: string;
    ya_calificado: boolean;
  } | null;
}) {
  const [estrellas, setEstrellas] = useState(0);
  const [encima, setEncima] = useState(0);
  const [comentario, setComentario] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!pendiente) {
    return (
      <Aviso titulo="Este enlace no funciona.">
        Puede que esté incompleto, o que el proyecto todavía no figure como terminado. Abrilo de
        nuevo desde el correo.
      </Aviso>
    );
  }

  if (pendiente.ya_calificado) {
    return (
      <Aviso titulo="Ya calificaste este proyecto.">
        Gracias: tu calificación ya está en el perfil de {pendiente.espacio_nombre}.
      </Aviso>
    );
  }

  if (listo) {
    return (
      <Aviso titulo="¡Gracias!">
        Tu calificación ya aparece en el perfil de {pendiente.espacio_nombre} y ayuda a otros
        clientes a elegir.
      </Aviso>
    );
  }

  const mostradas = encima || estrellas;

  return (
    <form
      className={`${tarjetaClass} flex flex-col gap-7 px-8 py-8`}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!estrellas || enviando) return;

        const supabase = createClient();

        if (!supabase) return;

        setEnviando(true);
        setError(null);

        const {error: err} = await supabase.rpc("calificar", {
          p_token: token,
          p_estrellas: estrellas,
          p_comentario: comentario.trim() || null,
        });

        setEnviando(false);
        // Los mensajes de la base ya están escritos para una persona.
        if (err) setError(err.message);
        else setListo(true);
      }}
    >
      <p className="text-muted text-[14.5px] leading-relaxed">
        Hola {pendiente.cliente_nombre}: tu calificación se publica en su perfil, con tu nombre de
        pila.
      </p>

      <fieldset>
        <legend className="text-faint mb-3 text-[10px] tracking-[0.16em] uppercase">
          Estrellas <span className="text-ochre">*</span>
        </legend>
        <div className="flex items-center gap-1" onMouseLeave={() => setEncima(0)}>
          {ETIQUETAS.map((etiqueta, i) => {
            const valor = i + 1;

            return (
              <label
                key={valor}
                className="text-ochre has-[:focus-visible]:outline-ochre cursor-pointer p-1 has-[:focus-visible]:outline has-[:focus-visible]:outline-2"
                onMouseEnter={() => setEncima(valor)}
              >
                <input
                  checked={estrellas === valor}
                  className="sr-only"
                  name="estrellas"
                  type="radio"
                  value={valor}
                  onChange={() => setEstrellas(valor)}
                />
                <span className="sr-only">
                  {valor} {valor === 1 ? "estrella" : "estrellas"}: {etiqueta}
                </span>
                <svg aria-hidden="true" height={36} viewBox="0 0 24 24" width={36}>
                  <path
                    d={RUTA}
                    fill={valor <= mostradas ? "currentColor" : "transparent"}
                    stroke="currentColor"
                    strokeWidth={1.2}
                  />
                </svg>
              </label>
            );
          })}
          <span className="text-ink-soft ml-3 text-[14px]">
            {mostradas ? ETIQUETAS[mostradas - 1] : ""}
          </span>
        </div>
      </fieldset>

      <label className="flex flex-col gap-2">
        <span className="text-faint text-[10px] tracking-[0.16em] uppercase">
          Comentario (opcional)
        </span>
        <textarea
          className="border-rule text-ink placeholder-mist focus:border-ochre w-full resize-y border-b bg-transparent pb-3 text-[15px] leading-relaxed outline-none"
          maxLength={1000}
          placeholder="¿Qué destacarías de cómo trabajó?"
          rows={4}
          value={comentario}
          onChange={(e) => setComentario(e.target.value)}
        />
      </label>

      {error && (
        <p className="text-brick text-[13px]" role="alert">
          {error}
        </p>
      )}

      <button
        className="ease bg-ink text-paper hover:bg-ochre w-full py-4 text-[11px] font-medium tracking-[0.2em] uppercase transition duration-200 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={!estrellas || enviando}
        type="submit"
      >
        {enviando ? "Enviando…" : "Enviar calificación"}
      </button>
    </form>
  );
}
