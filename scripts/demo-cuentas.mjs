// Crea (o restaura) las dos cuentas públicas de la demo de portfolio:
// un desarrollador con su espacio ya configurado y un cliente.
// Usa la API de administración de Supabase, así que funciona con el registro
// apagado. Se corre desde tu PC, nunca en el servidor de n8n: necesita la
// service_role. Idempotente: si la cuenta existe, le restaura la clave.
//
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
//   DEMO_DESARROLLADOR_EMAIL=... DEMO_DESARROLLADOR_CLAVE=... \
//   DEMO_CLIENTE_EMAIL=... DEMO_CLIENTE_CLAVE=... \
//   node scripts/demo-cuentas.mjs
//
// Opcionales: DEMO_ESPACIO_SLUG (estudio-demo), DEMO_ESPACIO_NOMBRE (Estudio Demo).

const requerida = (nombre) => {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Falta la variable ${nombre}`);
  return valor;
};

const BASE = requerida("SUPABASE_URL").replace(/\/+$/, "");
const CLAVE_SERVICIO = requerida("SUPABASE_SERVICE_ROLE_KEY");
const ESPACIO_SLUG = process.env.DEMO_ESPACIO_SLUG || "estudio-demo";
const ESPACIO_NOMBRE = process.env.DEMO_ESPACIO_NOMBRE || "Estudio Demo";

const CUENTAS = [
  {
    tipo: "desarrollador",
    email: requerida("DEMO_DESARROLLADOR_EMAIL").toLowerCase(),
    clave: requerida("DEMO_DESARROLLADOR_CLAVE"),
  },
  {
    tipo: "cliente",
    email: requerida("DEMO_CLIENTE_EMAIL").toLowerCase(),
    clave: requerida("DEMO_CLIENTE_CLAVE"),
  },
];

async function pedir(metodo, ruta, cuerpo, encabezados = {}) {
  const respuesta = await fetch(BASE + ruta, {
    method: metodo,
    headers: {
      apikey: CLAVE_SERVICIO,
      Authorization: `Bearer ${CLAVE_SERVICIO}`,
      "Content-Type": "application/json",
      ...encabezados,
    },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const texto = await respuesta.text();
  if (!respuesta.ok) throw new Error(`${metodo} ${ruta} → ${respuesta.status}: ${texto}`);
  return texto ? JSON.parse(texto) : null;
}

async function buscarUsuario(email) {
  for (let pagina = 1; ; pagina++) {
    const {users} = await pedir("GET", `/auth/v1/admin/users?page=${pagina}&per_page=200`);
    const usuario = users.find((u) => u.email?.toLowerCase() === email);
    if (usuario || users.length < 200) return usuario ?? null;
  }
}

async function asegurarCuenta({tipo, email, clave}) {
  const existente = await buscarUsuario(email);
  const usuario = existente
    ? await pedir("PUT", `/auth/v1/admin/users/${existente.id}`, {password: clave, email_confirm: true})
    : await pedir("POST", "/auth/v1/admin/users", {
        email,
        password: clave,
        email_confirm: true,
        // handle_new_user() lee el tipo de acá, igual que en /cliente/entrar.
        user_metadata: tipo === "cliente" ? {tipo: "cliente"} : {},
      });

  const [perfil] = await pedir("GET", `/rest/v1/profiles?id=eq.${usuario.id}&select=tipo`);
  if (perfil?.tipo !== tipo) {
    throw new Error(`${email} es de tipo «${perfil?.tipo ?? "sin perfil"}» y se esperaba «${tipo}»`);
  }

  console.log(`${existente ? "Restaurada" : "Creada"}: ${email} (${tipo})`);
  return usuario.id;
}

async function configurarEspacio(duenoId, email) {
  const filas = await pedir(
    "PATCH",
    `/rest/v1/espacios?dueno_id=eq.${duenoId}`,
    {slug: ESPACIO_SLUG, nombre: ESPACIO_NOMBRE, email_contacto: email},
    {Prefer: "return=representation"},
  );
  if (filas.length !== 1) throw new Error(`El desarrollador demo no tiene espacio (${filas.length} filas)`);
  console.log(`Espacio: /f/${filas[0].slug} («${filas[0].nombre}»)`);
}

const [desarrolladorId] = await Promise.all(CUENTAS.map(asegurarCuenta));
await configurarEspacio(desarrolladorId, CUENTAS[0].email);
