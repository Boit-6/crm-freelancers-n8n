import CobrosStripe from "./cobros-stripe";
import EspacioForm from "./espacio-form";
import PerfilForm from "./perfil-form";
import ServiciosForm from "./servicios-form";
import TelegramVinculo from "./telegram-vinculo";

import {getPanelUser} from "@/lib/auth";

export default async function EspacioPage() {
  const {espacio} = await getPanelUser();
  const bienvenida = !espacio.configurado_en;

  return (
    <div className="max-w-xl">
      <div className="border-rule mb-10 border-b pb-8">
        <p className="text-ochre mb-4 text-[10px] tracking-[0.22em] uppercase">
          {bienvenida ? "Bienvenido" : "Tu espacio"}
        </p>
        <h1 className="text-ink font-serif text-[clamp(2.4rem,6vw,3rem)] leading-none tracking-tight">
          {bienvenida ? "Armá tu espacio." : "Nombre y dirección."}
        </h1>
        <p className="text-muted mt-5 text-[14.5px] leading-relaxed">
          {bienvenida
            ? "Elegí cómo te van a ver tus clientes y la dirección de tu formulario. Lo podés cambiar después."
            : "El nombre aparece en tu formulario. Si cambiás la dirección, el link anterior deja de funcionar."}
        </p>
      </div>

      <EspacioForm bienvenida={bienvenida} espacio={espacio} />

      {!bienvenida && (
        <CobrosStripe
          inicial={{
            conectada: Boolean(espacio.stripe_account_id),
            activo: espacio.stripe_cobros_activos,
          }}
        />
      )}

      {!bienvenida && <TelegramVinculo vinculado={Boolean(espacio.telegram_chat_id)} />}

      {!bienvenida && <PerfilForm espacio={espacio} />}

      {!bienvenida && <ServiciosForm espacio={espacio} />}
    </div>
  );
}
