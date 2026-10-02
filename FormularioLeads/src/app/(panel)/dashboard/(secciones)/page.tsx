import AvisosPanel from "../avisos-panel";
import EncabezadoPagina from "../encabezado-pagina";

import InicioSecciones from "./inicio-secciones";

import {esAdminPlataforma, getPanelUser} from "@/lib/auth";
import {createClient} from "@/lib/supabase/server";

// Las disputas que el admin de la plataforma puede resolver; null para el
// resto (la base igual rechaza la consulta) o si no se pudo contar.
async function contarDisputasAbiertas(userId: string): Promise<number | null> {
  if (!(await esAdminPlataforma(userId))) return null;
  const supabase = await createClient();

  if (!supabase) return null;
  const {data, error} = await supabase.rpc("disputas_abiertas");

  if (error) {
    console.error("No se pudieron contar las disputas abiertas:", error.message);

    return null;
  }

  return data.filter((d) => d.puede_resolver).length;
}

export default async function InicioPage() {
  const {user, espacio} = await getPanelUser();

  return (
    <>
      <EncabezadoPagina titulo="Inicio" />
      <InicioSecciones
        cantidadDisputasAbiertas={await contarDisputasAbiertas(user.id)}
        cobrosActivos={espacio.stripe_cobros_activos}
      />
      <div className="mt-14">
        <AvisosPanel />
      </div>
    </>
  );
}
