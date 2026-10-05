import Link from "next/link";

import EntrarClienteForm from "./entrar-form";

import {cuentasDemo} from "@/lib/demo";

export default function EntrarClientePage() {
  return (
    <main className="mx-auto w-full max-w-md px-6 pt-10 pb-20 sm:px-10">
      <div className="border-rule mb-10 border-b pb-8">
        <p className="text-ochre mb-4 text-[10px] tracking-[0.22em] uppercase">Para clientes</p>
        <h1 className="text-ink font-serif text-[clamp(2.4rem,6vw,3rem)] leading-none tracking-tight">
          Tus proyectos.
        </h1>
        <p className="text-muted mt-5 text-[14.5px] leading-relaxed">
          Entrá con tu correo: te mandamos un enlace, sin contraseña. Si es la primera vez, se crea
          tu cuenta.
        </p>
      </div>

      {cuentasDemo().length > 0 && (
        <p className="border-ochre bg-ochre/5 text-ink mb-8 border-l-2 px-5 py-3.5 text-[13px]">
          En la demo el enlace no llega a tu correo.{" "}
          <Link className="text-ochre underline-offset-4 hover:underline" href="/login">
            Entrá con la cuenta de cliente de prueba
          </Link>
          .
        </p>
      )}

      <EntrarClienteForm />
    </main>
  );
}
