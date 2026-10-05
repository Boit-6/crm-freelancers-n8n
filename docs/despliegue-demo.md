# Despliegue de la demo de portfolio

Cómo publicar una demo pública, sin costo y sin riesgo para terceros. Los pasos operativos generales
(esquema, credenciales de n8n, renderizado de CORS) están en el [README técnico](guia-tecnica.md); esta
guía agrega lo propio de la demo.

```
Navegador ──▶ Vercel (Next.js) ──▶ https://<sub>.duckdns.org (Caddy, VM de Oracle Free Tier)
                                        │  solo /webhook/* y /healthz
                                        ▼
                                  n8n + Gotenberg (Docker, 127.0.0.1)
                                        │
                                        ▼
                                  Supabase (Session pooler, rol n8n_writer)

El editor de n8n nunca es público: se entra por túnel SSH.
```

## Reglas

- **Ningún correo llega a un tercero.** Con `DEMO_EMAIL_SINK`, todos los Gmail de `crm_postgres.json` y
  `avisos.json` van a esa casilla, con el asunto `[DEMO → destinatario original] …`. Lo agrega
  `scripts/demo-email-sink.mjs`, que ya está aplicado a los workflows. Sin la variable, cada correo va a su
  destinatario.
- **Sin cobros reales.** `STRIPE_SECRET_KEY` vacía: la factura cae al pago simulado.
- **Registro apagado.** Las cuentas de la demo se crean con la API de administración, que funciona igual.
- **La `service_role` no va al servidor.** Solo se usa desde tu PC, para crear las cuentas.

## Variables

**Servidor (`.env` junto al compose).** Todo lo demás queda con su valor por defecto.

```
N8N_PUBLIC_URL=https://<sub>.duckdns.org/
FRONTEND_URL=https://<proyecto>.vercel.app
DEMO_EMAIL_SINK=<casilla de la demo>
N8N_PROXY_HOPS=1
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
AVISOS_WORKFLOW_ID=<id de avisos.json, después de importarlo>
```

**Vercel.** El proyecto se importa con **Root Directory = `web`**. Las `NEXT_PUBLIC_*` se incrustan al
compilar: después de cambiarlas hay que volver a desplegar.

```
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
NEXT_PUBLIC_SITE_URL=https://<proyecto>.vercel.app
NEXT_PUBLIC_N8N_BASE=https://<sub>.duckdns.org
N8N_BASE=https://<sub>.duckdns.org
CRM_PANEL_HEADER=x-crm-token
CRM_PANEL_TOKEN=<el valor de la credencial «CRM - Header Auth (panel)»>
NEXT_PUBLIC_EMAIL_CONTACTO=<casilla de la demo>
NEXT_PUBLIC_DEMO=1
NEXT_PUBLIC_DEMO_DESARROLLADOR_EMAIL=<correo del desarrollador demo>
NEXT_PUBLIC_DEMO_DESARROLLADOR_CLAVE=<clave pública>
NEXT_PUBLIC_DEMO_CLIENTE_EMAIL=<correo del cliente demo>
NEXT_PUBLIC_DEMO_CLIENTE_CLAVE=<clave pública>
```

Con `NEXT_PUBLIC_DEMO=1`, todas las páginas muestran el aviso de demo, el login ofrece «Entrar como
desarrollador» y «Entrar como cliente» con un clic, y `/cliente/entrar` explica que el enlace mágico no llega.

## Cuentas de la demo

Desde tu PC, con el esquema ya aplicado:

```bash
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service_role> \
DEMO_DESARROLLADOR_EMAIL=... DEMO_DESARROLLADOR_CLAVE=... \
DEMO_CLIENTE_EMAIL=... DEMO_CLIENTE_CLAVE=... \
node scripts/demo-cuentas.mjs
```

Crea el desarrollador con su espacio ya configurado (`/f/estudio-demo`, «Estudio Demo») y el cliente con
`tipo = 'cliente'`. Si las cuentas existen, les restaura la clave. Se puede correr las veces que haga falta.

## Caddy

Solo se exponen los webhooks y el chequeo de salud; el editor y la API REST de n8n quedan cerrados.

```
<sub>.duckdns.org {
    handle /webhook/* {
        reverse_proxy localhost:5678
    }
    handle /healthz {
        reverse_proxy localhost:5678
    }
    handle {
        respond 404
    }
}
```

Caddy reemplaza el `X-Forwarded-For` que manda el cliente por la IP real. El rate limiting toma el último
tramo de ese encabezado, así que limita por la IP de quien llama.

## Reinicio nocturno de las cuentas

Las claves son públicas: cualquiera podría cambiarlas y dejar afuera al siguiente visitante. Un cron de
Supabase (extensión `pg_cron`) las restaura todas las noches. `0 7 * * *` son las 07:00 UTC, las 04:00 en
Argentina.

```sql
select cron.schedule('reset-demo', '0 7 * * *', $$
  update auth.users
     set encrypted_password = extensions.crypt('<clave desarrollador>', extensions.gen_salt('bf'))
   where email = '<correo desarrollador>';
  update auth.users
     set encrypted_password = extensions.crypt('<clave cliente>', extensions.gen_salt('bf'))
   where email = '<correo cliente>';
  update public.espacios e
     set nombre = 'Estudio Demo', slug = 'estudio-demo', email_contacto = '<correo desarrollador>'
    from auth.users u
   where u.id = e.dueno_id and u.email = '<correo desarrollador>';
$$);
```

La actualización de la clave con `crypt` se probó contra el Supabase local: después de aplicarla, el login
sigue funcionando. Borrar cada noche los leads, las facturas y los demás datos de prueba queda pendiente:
el esquema tiene claves `ON DELETE RESTRICT` y tablas de auditoría, y ese borrado hay que escribirlo y
probarlo aparte.

## Verificación

- [ ] `curl -I https://<sub>.duckdns.org/` y `/rest/login` responden 404.
- [ ] `curl https://<sub>.duckdns.org/healthz` responde ok.
- [ ] Recorrido completo desde el navegador: formulario → lead en el panel → propuesta → aceptación →
      factura PDF → pago simulado → panel actualizado.
- [ ] Todos los correos llegan a la casilla demo con `[DEMO → …]` en el asunto.
- [ ] `select * from rate_limit_cuotas limit 20;` muestra tu IP pública (`curl ifconfig.me`), no `127.0.0.1`
      ni `172.x`.
- [ ] Un POST sin firma a `/webhook/stripe` se rechaza.
- [ ] «Entrar como desarrollador» y «Entrar como cliente» funcionan en la URL pública.
