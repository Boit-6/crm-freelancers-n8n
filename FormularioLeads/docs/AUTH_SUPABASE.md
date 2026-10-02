# Login / Register con Supabase Auth — resumen de la implementación

Este documento resume qué se hizo, por qué, y qué queda pendiente, para que cualquiera
que retome el proyecto tenga el contexto completo sin tener que reconstruirlo.

> **Registro histórico:** describe la incorporación inicial de Auth, no la estructura
> ni el estado operativo actual. Hoy `/` es la portada, los formularios están en
> `/f/<slug>`, el panel exige un espacio propio y el gestor de paquetes del repo
> es npm (`package-lock.json`). Para instrucciones vigentes, ver los README.

## 1. Contexto / problema original

El dashboard interno (`/dashboard`) mostraba métricas, leads (nombre, email, presupuesto)
y facturas, pero era **completamente público**: no existía ningún login, y además la
base de datos de Supabase no tenía Row Level Security (RLS), así que cualquiera con la
URL y la key pública del proyecto podía leer esas tablas directamente, sin pasar por la
app. Se agregó login/registro con Supabase Auth y se cerró el acceso tanto a nivel de
página (redirect si no hay sesión) como a nivel de base de datos (RLS).

## 2. Qué se implementó

### 2.1 Librería y clientes de Supabase

Se instaló `@supabase/ssr` (además de `@supabase/supabase-js` que ya estaba) y se
reemplazó el cliente único de navegador (`src/lib/supabase.ts`) por tres clientes,
siguiendo el patrón oficial de Supabase para Next.js App Router:

- `src/lib/supabase/client.ts` — cliente de navegador (`createBrowserClient`), para
  componentes `"use client"` (login, register, dashboard).
- `src/lib/supabase/server.ts` — cliente de servidor (`createServerClient` + cookies de
  `next/headers`), para Server Components y route handlers.
- `src/lib/supabase/middleware.ts` — helper `updateSession(request)` que refresca la
  sesión en cada request y redirige a `/login` si la ruta es protegida y no hay usuario.
  Las rutas protegidas están en el array `PROTECTED_ROUTES` (hoy solo `/dashboard`;
  agregar ahí cualquier ruta interna nueva).

Todos mantienen el mismo criterio defensivo que ya tenía el proyecto: si faltan las env
vars, devuelven `null` en vez de romper el build (para no tumbar un deploy de Vercel sin
configurar).

### 2.2 Protección de rutas — `src/proxy.ts`

Next.js 16.2.2 **deprecó el archivo `middleware.ts`** en favor de `proxy.ts` (con un
export llamado `proxy` en vez de `middleware`). Por eso el archivo se llama
`src/proxy.ts` y no `src/middleware.ts` — es la convención nueva, no un error. Corre
sólo en `/dashboard`, `/api` y `/auth` (desde el 23-sep-2026; antes, en cada request
salvo assets estáticos) y usa `updateSession` para decidir si redirige a `/login`. Las
páginas públicas no leen la sesión, así que no pagan el viaje a Supabase Auth.

### 2.3 Páginas nuevas

- `/login` (`src/app/login/page.tsx` + `login-form.tsx`) — `signInWithPassword`, redirige
  a `/dashboard` (o a `?redirectTo=` si vino de un redirect del proxy).
- `/register` (`src/app/register/page.tsx` + `register-form.tsx`) — **registro abierto**,
  cualquiera puede crear una cuenta. Usa `signUp`. Si el proyecto de Supabase tiene
  "Confirm email" activado, muestra pantalla de "revisá tu correo"; si está desactivado,
  entra directo al dashboard.
- `/auth/confirm` (`src/app/auth/confirm/route.ts`) — route handler que procesa el link
  de confirmación de email (`verifyOtp`) y redirige al dashboard.
- `/auth/signout` (`src/app/auth/signout/route.ts`) — route handler POST que cierra
  sesión y redirige a `/login`. Se dispara desde el botón "Salir" del dashboard.

Todas las páginas reutilizan la estética dark/mono/amber existente (mismas clases
Tailwind que `lead-form.tsx`).

### 2.4 Dashboard protegido

- `src/app/dashboard/page.tsx` ahora es `async`, verifica la sesión server-side con
  `supabase.auth.getUser()` y hace `redirect("/login")` si no hay usuario (defensa en
  profundidad, además del proxy). Muestra el email del usuario logueado y el botón
  "Salir".
- El entonces `src/app/dashboard/dashboard-client.tsx` — se migró del cliente
  viejo (`@/lib/supabase`) al nuevo cliente de navegador
  (`@/lib/supabase/client`). Ese archivo ya no existe: la carga y el canal
  Realtime viven hoy en `src/app/(panel)/dashboard/panel-datos.tsx`, con vistas
  separadas por sección.

### 2.5 Bug corregido en el formulario de leads

`src/app/components/lead-form.tsx` tenía la URL del webhook de n8n **hardcodeada**
(`http://localhost:5678/...`), ignorando la variable `NEXT_PUBLIC_N8N_BASE` que ya
existía en `.env.example`. Se corrigió para que use la env var (mismo patrón que ya
usaba `aceptar-propuesta.tsx`), y se agregó un mensaje de error claro si la variable no
está configurada.

### 2.6 Rutas públicas (sin cambios)

`/` (formulario de leads) y `/aceptar/[leadId]` (aceptación de propuesta, protegida por
un token de n8n) siguen siendo públicas a propósito.

## 3. Variables de entorno

Mismas variables de siempre, ahora también usadas por Auth:

```
NEXT_PUBLIC_SUPABASE_URL=https://ubgvfqfysymxlhsznlva.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...   # Publishable key (NO el secret ni service_role)
NEXT_PUBLIC_N8N_BASE=http://localhost:5678         # ver sección 5, pendiente para producción
```

**Importante:** en el dashboard de Supabase (Settings → API) hay dos sistemas de keys:

- **Nuevo** ("Publishable and secret API keys"): usar `sb_publishable_...`. Es el que
  usamos.
- **Legacy** ("anon, service_role"): el `anon` (JWT) también funcionaría, pero se
  prefiere el publishable key nuevo.
- **Nunca** usar `sb_secret_...` ni `service_role` en variables `NEXT_PUBLIC_*` ni en el
  frontend — esas keys se saltean RLS por completo.

### 3.1 Estado actual de configuración

- **Local** (`.env.local`): las 3 variables cargadas con valores reales (n8n sigue
  apuntando a `localhost:5678`).
- **Vercel** (proyecto `formulario-leads`, dominio
  `https://formulario-leads-psi.vercel.app`): cargadas en **Production**
  `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` (vía `vercel env add`).
  **`NEXT_PUBLIC_N8N_BASE` todavía NO está cargada en Vercel** a propósito: no tiene
  sentido apuntar a `localhost` en producción (ver sección 5).

⚠️ **Gotcha de `vercel link`**: correr `vercel link` (o `vercel env pull`) puede
sobreescribir tu `.env.local` local reemplazándolo por solo un `VERCEL_OIDC_TOKEN`. Si
vas a linkear el proyecto de nuevo, hacé un backup de `.env.local` antes.

## 4. Supabase — permisos y configuración de Auth

El proyecto de Supabase es de un tercero (no de quien está desarrollando esto), lo cual
generó fricción: varias configuraciones de Auth requieren rol **Administrator/Owner** y
no estaban disponibles con el rol actual. Configuración pendiente que **el dueño del
proyecto de Supabase** (o alguien con rol Administrator) debe hacer:

1. **Authentication → Sign In / Providers → Email → User Signups**: desactivar
   **"Confirm email"** (para que el registro abierto no dependa de que el email de
   confirmación llegue con una URL de redirect correcta). Alternativa si se deja
   activado: configurar bien el punto 2.
2. **Authentication → URL Configuration**:
   - **Site URL**: `https://formulario-leads-psi.vercel.app`
   - **Redirect URLs**:
     - `https://formulario-leads-psi.vercel.app/auth/confirm`
     - `http://localhost:3000/auth/confirm`

Mientras tanto, para poder probar login/dashboard sin depender de esto, se creó un
usuario de prueba manualmente desde **Authentication → Users → Add user** con **"Auto
Confirm User"** tildado (evita el flujo de confirmación por email por completo). Las
credenciales de ese usuario no se documentan acá por seguridad — pedirlas a quien hizo
la config, o crear un usuario nuevo de la misma forma.

### 4.1 Nota de seguridad

Durante la sesión de configuración se compartieron por chat (sin necesidad) la
**secret key** y la **service_role key** del proyecto de Supabase. Ninguna de las dos se
usó en el código ni se guardó en ningún archivo del repo, pero como quedaron expuestas en
una conversación, **se recomienda regenerarlas** desde Supabase → Settings → API cuando
sea posible, por las dudas.

## 5. Row Level Security (RLS)

Antes de esto, `leads`, `facturas` y las vistas `metrics_mensuales` /
`facturas_pendientes` eran legibles por el rol `anon` (público) sin ninguna
restricción. Se armaron policies para que **solo usuarios autenticados** puedan leer
estos datos. Los inserts/updates los sigue haciendo n8n con su propia key (no pasan por
RLS de todas formas), así que esto no afecta el flujo de creación de leads/facturas.

`metrics_mensuales` y `facturas_pendientes` son **vistas** (no tablas), calculadas a
partir de `leads` y `facturas`. Por default, una vista en Postgres corre con los
permisos del dueño de la vista y **no respeta el RLS de las tablas que lee**, por eso
hace falta el `security_invoker`.

SQL aplicado (correr en el SQL Editor de Supabase, como Administrator/Owner o alguien
con permiso de DDL):

```sql
-- Tabla leads
alter table public.leads enable row level security;

create policy "authenticated_read_leads"
on public.leads
for select
to authenticated
using (true);

-- Tabla facturas (tabla base de la vista facturas_pendientes y de metrics_mensuales)
alter table public.facturas enable row level security;

create policy "authenticated_read_facturas"
on public.facturas
for select
to authenticated
using (true);

-- Las vistas deben respetar el RLS de las tablas de abajo en vez de saltearlo
alter view public.metrics_mensuales set (security_invoker = on);
alter view public.facturas_pendientes set (security_invoker = on);
```

**Estado:** las policies de `leads` y el `security_invoker` de ambas vistas se armaron y
comunicaron durante la sesión. **Confirmar que el bloque de `facturas` (arriba) se haya
ejecutado realmente** en el SQL Editor — fue el último paso pendiente antes de cerrar
este tema.

## 6. Pendiente — n8n en la PC de un amigo

`NEXT_PUBLIC_N8N_BASE` apunta a `http://localhost:5678`, que es el n8n corriendo en la
PC de un amigo. Esto trae dos problemas para producción:

1. El navegador de cualquier visitante de la web (no la PC del amigo) intenta pegarle a
   su propio `localhost:5678`, que no tiene nada corriendo — el form de leads y la
   aceptación de propuesta van a fallar en producción hasta que n8n tenga una URL
   pública real.
2. Opciones evaluadas (sin decidir todavía): exponer n8n con un túnel (Cloudflare
   Tunnel / ngrok), conseguir una IP pública fija con port-forwarding, o migrar n8n a un
   hosting (VPS, n8n cloud).

Hasta que se resuelva, el sitio funciona igual para **login/registro/dashboard**; solo
el formulario público de leads y la página de aceptar propuesta quedan sin funcionar en
producción.

## 7. Cómo probar

**Local:**

```bash
npm run dev
```

- `/` y `/aceptar/[leadId]` — públicas, sin cambios funcionales (salvo que necesitan que
  n8n esté accesible).
- `/dashboard` sin sesión → redirige a `/login`.
- `/login` con el usuario de prueba (auto-confirmado) → entra al dashboard, ve los datos
  y el email arriba a la derecha, botón "Salir" funciona.
- `/register` → crea una cuenta nueva (si "Confirm email" sigue activo en Supabase, va a
  pedir confirmar por correo antes de poder loguearse).

**Producción (Vercel):** el push a `main` dispara un deploy automático. Repetir las
mismas pruebas contra `https://formulario-leads-psi.vercel.app`.

## 8. Archivos tocados en esta sesión

**Nuevos:**

- `src/lib/supabase/{client,server,middleware}.ts`
- `src/proxy.ts`
- `src/app/login/{page,login-form}.tsx`
- `src/app/register/{page,register-form}.tsx`
- `src/app/auth/confirm/route.ts`
- `src/app/auth/signout/route.ts`
- `docs/AUTH_SUPABASE.md` (este archivo)

**Modificados:**

- `src/app/dashboard/page.tsx`
- `src/app/dashboard/dashboard-client.tsx` (nombre histórico; ya retirado)
- `src/app/components/lead-form.tsx` (fix de la URL hardcodeada)
- `.env.example`
- `package.json` / `package-lock.json` (dependencia `@supabase/ssr`; lockfile actual)

**Borrado:**

- `src/lib/supabase.ts` (reemplazado por `src/lib/supabase/`)
