# FormularioLeads — front

Capa de presentación del proyecto (ver la [documentación técnica](../docs/guia-tecnica.md) para
la arquitectura completa). Next.js 16 (App Router) + React 19 + Tailwind v4 +
Supabase Auth/Realtime. Las operaciones autorizadas del panel (por ejemplo,
tickets y datos del espacio) usan Supabase con RLS; las acciones del CRM pasan
por n8n, directamente desde páginas públicas o mediante el proxy del servidor.

## Stack

- **Next.js 16** (App Router, Turbopack) · **React 19** · **Tailwind v4**
- **Supabase** — Auth, Realtime y cliente `anon` bajo sesión (nunca la
  `service_role` desde el front)
- Consumidor HTTP de los webhooks de **n8n** (`workflow/crm_postgres.json`, en
  la raíz del monorepo). El backend usa además `workflow/tickets.json` y
  `workflow/avisos.json`; el frontend no consume esos subflujos directamente.

## Levantar el entorno de desarrollo

```bash
cd web
cp .env.example .env.local   # completar los valores, ver detalle abajo
npm install
npm run dev                  # http://localhost:3000
```

Requiere Node **20+** (ver `.nvmrc` en la raíz del repo).

## Variables de entorno

Detalladas y comentadas en [`.env.example`](.env.example). Resumen:

| Variable                               | Requerida | Qué es                                                                                                                             |
| -------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_N8N_BASE`                 | Sí        | Base de los webhooks de n8n para llamadas desde el navegador                                                                       |
| `NEXT_PUBLIC_SUPABASE_URL`             | Sí        | Project URL de Supabase                                                                                                            |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`        | Sí        | anon/publishable key (no es secreta; RLS protege los datos)                                                                        |
| `N8N_BASE`                             | No        | Base de n8n para llamadas server-side del proxy `/api/crm`; si falta, cae a `NEXT_PUBLIC_N8N_BASE`                                 |
| `CRM_PANEL_HEADER` / `CRM_PANEL_TOKEN` | No\*      | Credencial de los webhooks internos del panel (`/api/crm/*`) — debe coincidir con la credencial `CRM - Header Auth (panel)` de n8n |
| `NEXT_PUBLIC_EMAIL_CONTACTO`           | No        | Dirección que se muestra en enlaces vencidos/inválidos de la página de aceptación                                                  |

\* Sin configurar la credencial del panel, `/api/crm/[accion]` devuelve `503`
en vez de reenviar una mutación sin autenticar. `/api/tickets` usa la sesión
del desarrollador y RLS del espacio; no utiliza `TICKETS_API_KEY`.

## Scripts

```bash
npm run dev         # servidor de desarrollo (Turbopack)
npm run build        # build de producción
npm run start         # sirve el build de producción
npm run lint          # ESLint (usa --max-warnings 0 en CI)
npm run typecheck     # tsc --noEmit
```

Desde la raíz del monorepo también hay atajos: `npm run dev:front`,
`npm run lint:front`, `npm run typecheck:front` y `npm run check` (corre toda
la suite del repo + lint + typecheck del front).

## Estructura relevante

```
src/app/
├── f/[slug]/                   # Formulario de captación de cada desarrollador
├── (plataforma)/aceptar/[leadId]/ # Página de aceptación de propuesta
├── (panel)/dashboard/         # Panel del desarrollador (sesión + espacio)
├── (panel)/dashboard/(secciones)/tickets/ # Tickets (columnas + drag & drop)
├── api/crm/[accion]/          # Proxy server-side hacia los webhooks internos del panel
├── api/tickets/               # Route handlers con sesión + RLS
├── (plataforma)/login/ · (plataforma)/register/ # Autenticación (Supabase)
└── auth/                      # Confirmación y salida de sesión
src/lib/supabase/               # Clientes de Supabase (client / server / middleware)
```

## Despliegue

Pensado para Vercel. El build no necesita credenciales configuradas: los
clientes de Supabase devuelven `null` cuando faltan las variables en vez de
romper (ver `src/lib/supabase/client.ts` y `server.ts`).

El `docker-compose.yml` de la raíz expone n8n sólo en `127.0.0.1:5678`.
`NEXT_PUBLIC_N8N_BASE` debe ser una URL HTTPS realmente accesible desde el
navegador remoto, publicada mediante un proxy/túnel con controles de acceso
al editor; definir `N8N_PUBLIC_URL` por sí solo no abre ese puerto.
