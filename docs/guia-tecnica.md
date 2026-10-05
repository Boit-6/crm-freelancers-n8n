# FormularioLeads — guía técnica

> Arquitectura, instalación, pruebas y seguridad. La presentación del proyecto está en el
> [README principal](../README.md).

---

## 📋 Descripción

El freelance profesional gestiona su ciclo comercial de forma **manual y fragmentada**: consultas dispersas, propuestas escritas a mano, seguimiento de memoria y cobros perseguidos por chat. Se pierden leads, se pierde tiempo y se proyecta poca profesionalidad.

Este proyecto automatiza **todo el ciclo de punta a punta** para un freelance

```
Lead entra → scoring → propuesta → (aceptar / rechazar / pedir cambios) → factura PDF → pago → seguimiento del trabajo → cierre → testimonio → métricas
```

Características técnicas clave:

- 🧩 **Arquitectura desacoplada en 3 capas** (presentación / orquestación / datos).
- 🗄️ **PostgreSQL como única fuente de verdad** con enums, integridad referencial, RLS y vistas calculadas en vivo.
- 🔑 **Aceptación segura y atómica** mediante token UUID validado contra la base (sin doble facturación en concurrencia).
- 🧾 **Facturación automática en PDF** (HTML → Gotenberg) y **cobro con Stripe Connect** en USD: cada desarrollador cobra en su cuenta y la plataforma se queda con su comisión. La reserva de Checkout y la conciliación de pagos reducen duplicados; los casos inciertos requieren revisión manual. Sin credenciales de Stripe, la factura única cae a un modo de desarrollo sin pasarela.
- 🎫 **Tablero de tickets propio** con envejecimiento de prioridades + alertas por **Telegram**.
- 📊 **Tablero interno en tiempo real** (Supabase Realtime) con gestión del estado del trabajo y de los pedidos de cambio.

---

## 🏗️ Arquitectura del Repositorio

El sistema está desacoplado en tres capas con responsabilidades claras:

```
┌─────────────────────────┐     ┌──────────────────────┐     ┌─────────────────────────┐
│  Presentación           │     │  Orquestación        │     │  Datos                  │
│  Next.js + Vercel       │ ──▶ │  n8n (webhooks)      │ ──▶ │  PostgreSQL / Supabase  │
│  • Formulario de leads  │     │  • Lógica de negocio │     │  • Fuente de verdad     │
│  • Página de aceptación │     │  • Integraciones     │     │  • Vistas / métricas    │
│  • Dashboard interno    │     │  • Automatizaciones  │     │  • RLS (por espacio)    │
└─────────────────────────┘     └──────────────────────┘     └─────────────────────────┘
```

> El front es público y **nunca** muta la base directo: habla con n8n por HTTP. n8n concentra la lógica y es el único que escribe en las tablas de negocio. El dashboard lee con la anon key bajo sesión (nunca la service key). Cada capa se cambia sin romper las otras.

La orquestación del flujo principal tiene **21 webhooks** y **9 procesos programados** (más logging y manejo de errores global), en **314 nodos funcionales** (339 en total, incluidas 25 notas de documentación). La tabla resume el ciclo comercial base:

| Disparador | Proceso | Qué hace |
|---|---|---|
| Webhook `lead-nuevo` | Captación + scoring + propuesta | Normaliza, califica (score/tier) y guarda; si es HOT/WARM avisa para fijar los términos de la propuesta |
| Webhook `lead-propuesta` (GET) | Lectura de propuesta | Devuelve datos para la página de aceptación (solo lectura) |
| Webhook `lead-acepta` | Aceptación (atómica) | Valida token → `UPDATE ... WHERE estado IN (...)` → factura PDF → email |
| Webhook `lead-rechaza` | Rechazo | Marca el lead como PERDIDO |
| Webhook `lead-modifica` | Pedido de cambios | Vuelve a EN_SEGUIMIENTO, guarda el mensaje y avisa por Telegram |
| Webhook `trabajo-estado` | Estado del trabajo | Actualiza `estado_trabajo` (PENDIENTE→…→ENTREGADO) |
| Webhook `lead-cancelar` | Cancelación | Cancela el lead desde el tablero (PERDIDO + Telegram) |
| Webhook `cambio-aceptar` / `cambio-rechazar` | Resolver pedidos de cambio | Reenvía la propuesta / mantiene la original |
| Webhook `pagar` (GET) | Enlace de pago de la factura | Reserva una sesión de Checkout o reutiliza una URL aún no expirada; casos inciertos requieren revisión manual; cobra a la cuenta del desarrollador con la comisión de la plataforma |
| Webhook `stripe` (POST) | Cobro con Stripe | Stripe avisa el pago (evento firmado) → se verifica la firma → marca la factura COBRADO (idempotente) |
| Webhooks `stripe-conectar` / `stripe-estado` (POST, panel) | Alta de cobros | Crea la cuenta Express del desarrollador, el enlace de onboarding, y lee si ya puede cobrar |
| Webhook `pago-confirmado` (GET) | Cobro — modo de desarrollo | Sin `STRIPE_SECRET_KEY` configurado, marca la factura COBRADO a mano (idempotente) |
| Webhook `proyecto-cerrado` | Cierre + testimonio | Cierra, calcula el ciclo y pide reseña |
| Cron L-V 9:00 | Follow-up | Seguimiento automático; marca PERDIDO tras N intentos |
| Cron 10:00 | Recordatorios | Avisos de facturas por vencer / vencidas |
| Cron 23:59 | Métricas | Reporte diario por Telegram |

### 🎫 Tickets

Un tablero tipo Trello en el dashboard (`/dashboard/tickets`) para las tareas del trabajo. Los tickets son una tabla más de la base (`tickets`, con RLS y tiempo real): se crean y se mueven desde el tablero, y al aceptarse una propuesta el CRM siembra los del proyecto (plantilla en `TICKETS_PLANTILLA_PROYECTO`).

Su particularidad es el **envejecimiento**: un ticket que nadie toca sube solo de prioridad (`BAJA → MEDIA → ALTA → CRITICA`) hasta que se atiende. Moverlo de columna o cambiarle la prioridad reinicia el reloj.

| Pieza | Qué hace |
|---|---|
| `/api/tickets` (GET / POST) | Lista el tablero (vista `tickets_tablero`, con score y días calculados al momento) y crea tickets con la sesión de un desarrollador; la RLS limita las filas a su espacio |
| `/api/tickets/estado` (POST) | Mueve de columna o cambia la prioridad |
| [`workflow/tickets.json`](../workflow/tickets.json) · Cron 8:00 | Escala en una sola sentencia SQL los tickets quietos y envía el resumen al subflujo de avisos por espacio |

Detalle: [`docs/modulo-tickets.md`](modulo-tickets.md).

### 💸 Pago protegido por hitos

El desarrollador divide el proyecto en hitos, el cliente paga cada uno por adelantado y la plataforma retiene la plata hasta que aprueba la entrega (o pasan 7 días sin respuesta). Recién ahí se transfiere al desarrollador, menos el 5 % de comisión. Es obligatorio en los proyectos que llegan por la plataforma y opcional con los clientes propios.

Si el cliente disputa un hito, el admin de la plataforma lo resuelve desde `/dashboard/disputas`: libera todo, reembolsa todo o parte el monto, con una nota que les llega a las dos partes. Ve el historial del hito y la conversación entre las partes, y no puede resolver una disputa de un proyecto propio.

| Pieza | Qué hace |
|---|---|
| `/proyecto/<token>` | El cliente paga, aprueba o disputa cada hito |
| Webhook `hito-pagar` (GET) | Crea el cobro de la plataforma en Stripe, sin transferir todavía |
| `/dashboard/disputas` | El admin revisa y resuelve las disputas |
| 💸 Cron - Hitos · cada 5 min (RAMA 14) | Libera entregas vencidas y reclama una vez cada movimiento externo; un resultado incierto queda para conciliación manual, sin reintento automático |

Detalle: [`docs/modulo-hitos.md`](modulo-hitos.md).

---

## 🛠️ Stack Tecnológico

**Presentación**
- Next.js 16 (App Router) · React 19 · Tailwind v4 · Supabase Auth + Realtime · Vercel

**Orquestación**
- n8n (motor de workflows low-code) · Gotenberg (HTML → PDF)

**Datos**
- PostgreSQL / Supabase (tablas, enums, vistas, triggers, RLS)

**Integraciones**
- Gmail (OAuth2) · Telegram Bot · Stripe Connect (Checkout + Webhooks)

**DevOps**
- Docker / Docker Compose

---

## ⚙️ Requisitos Previos

- **Docker** y **Docker Compose**
- **Node.js 18+** y **npm** (para el front)
- **Git**
- Cuentas/credenciales: **Supabase**, **bot de Telegram**, **Gmail (OAuth2)**

---

## 🚀 Levantar el proyecto desde cero

**1. Clonar el repo** (el front vive dentro del monorepo, no es submódulo):
```bash
git clone https://github.com/Boit-6/crm-freelancers-n8n.git
cd crm-freelancers-n8n
```

**2. Base de datos (Supabase):**
Ejecutar [`db/schema.sql`](../db/schema.sql) en el SQL Editor de Supabase (crea tablas, enums, vistas, triggers y las políticas RLS por espacio).

La plataforma es compartida: cada cuenta que confirma su email recibe su propio **espacio** y ve en el panel sólo lo de ese espacio. Sobre una base anterior a los espacios, el script pasa todo lo que había a un espacio `principal` a nombre del primer admin.

Después, dar de alta la dirección del administrador de la plataforma (el esquema no trae ninguna precargada):
```sql
INSERT INTO admin_emails (email) VALUES ('tu-correo@dominio.com');
```
Esa cuenta pasa a `admin` recién cuando confirma el email. El rol no da acceso a los datos de otros espacios.

Al entrar por primera vez, cada desarrollador elige el nombre de su espacio y la dirección de su formulario, que queda en `/f/<dirección>`: los pedidos que llegan por ahí van a su espacio. La raíz (`/`) es la portada de la plataforma, no un formulario. La asignación SQL de leads sin espacio al espacio del admin es una compatibilidad para entradas antiguas o externas, no una ruta pública vigente.

**3. Orquestación (n8n + Gotenberg):**

Además del flujo principal y el de tickets, hay que importar **las copias renderizadas**:
- `rendered-workflow/avisos.json`: los avisos a cada desarrollador (panel, correo y Telegram). Su id va en `AVISOS_WORKFLOW_ID`.
- `rendered-workflow/telegram_vincular.json` (opcional): el bot con el que cada desarrollador vincula su Telegram. Hay que registrar el webhook una vez con `setWebhook` y el `secret_token` de `TELEGRAM_WEBHOOK_SECRET` (el comando está en la nota del workflow), y poner el usuario del bot en `NEXT_PUBLIC_TELEGRAM_BOT`.

```bash
cp .env.example .env        # completá TELEGRAM_CHAT_ID, N8N_PUBLIC_URL…
docker compose up -d        # n8n en http://localhost:5678 + Gotenberg en la misma red
```
Antes de importar, generar copias de **todos** los JSON del directorio
`workflow/` con orígenes CORS literales; n8n 2.34.6 no evalúa expresiones en
`allowedOrigins`:

```bash
CORS_ORIGINS='http://localhost:3000,https://app.example' npm run workflow:render -- --out ./rendered-workflow
# Alternativa con Node 24 y .env local: node --env-file=.env scripts/render-workflows.mjs --out ./rendered-workflow
```

`CORS_ORIGINS` es obligatorio y debe enumerar orígenes exactos (`scheme://host[:port]`,
sin rutas, comodines ni expresiones); el directorio de salida debe ser **nuevo**
y no puede ser `workflow/` ni estar dentro de él. El comando no importa ni
activa nada: produce copias `*.json` y `render-manifest.json` con SHA-256 de
fuente y renderizado, pero **no copia `db/schema.sql`**. Importar y activar en
n8n los JSON de salida, no los archivos fuente. Cambiar `CORS_ORIGINS` o
reiniciar n8n no cambia workflows ya importados: generar un directorio nuevo
y volver a importar/activar. CORS no sustituye autenticación. No se validó
aquí un navegador contra un despliegue real.

El puerto de n8n se publica **sólo en `127.0.0.1:5678`**. `N8N_PUBLIC_URL`
configura los enlaces que genera n8n, pero no abre el puerto al exterior. Para
que un navegador remoto alcance los webhooks, hace falta un proxy HTTPS o
túnel hacia ese puerto, con el editor protegido y un proxy de confianza para
`X-Forwarded-For` (del que depende el rate limiting por IP). No exponer el
editor de n8n directamente a Internet.
Aplicar primero [`db/schema.sql`](../db/schema.sql) en el entorno previsto y
verificar sus permisos efectivos (incluidas las columnas nuevas de Checkout y
movimientos); sólo después importar/activar workflows que dependen del esquema.
El repositorio no demuestra que un despliegue ya haya recibido esa migración.

En n8n: importar **`rendered-workflow/crm_postgres.json`**, crear las credenciales y editar los valores marcados:

| Credencial (n8n) | Detalle |
|------------------|---------|
| `Postgres - CRM Supabase` | Conexión SSL con el rol acotado `n8n_writer` tras habilitarle `LOGIN` y configurar la credencial fuera del repo. Comprobar el usuario efectivo en cada instancia; no inferirlo del workflow exportado. |
| `Gmail - CRM Freelance` | OAuth2 |
| `Telegram - CRM Freelance` | Bot token |

> Valores a editar a mano: la URL del front, la URL pública de n8n (ngrok o dominio), la URL del Google Form de reseñas y el `chatId` de Telegram. Luego **publicar** el workflow.

> ⚠️ **Checklist de importación** — 7 nodos de este workflow referencian la credencial `CRM - Header Auth (panel)` con `id: "REEMPLAZAR_AL_IMPORTAR"`. Si se publica el workflow sin re-vincularla, esos nodos quedan rotos o corriendo sin la verificación de esa credencial, según cómo resuelva n8n el ID inexistente. Antes de publicar: abrir cada nodo marcado en rojo por n8n al importar y reasignarle la credencial real.

**4. Tickets:** importar **`rendered-workflow/tickets.json`** en n8n (usa las mismas credenciales de Postgres y Telegram) y publicarlo. La tabla ya la creó `db/schema.sql`.

Antes de transferir los artefactos de despliegue se puede crear y comprobar un
manifiesto **local** de SHA-256:

```bash
npm run --silent manifest:deployment > /tmp/tobi-manifiesto.json
npm run --silent manifest:verify -- /tmp/tobi-manifiesto.json
```

Este manifiesto cubre `db/schema.sql` y los `workflow/*.json` **fuente** locales.
Es distinto de `rendered-workflow/render-manifest.json`, que registra por
workflow el SHA-256 de la fuente y de la copia renderizada; ninguno prueba
el contenido de una instancia n8n remota. La
segunda orden comprueba esos archivos contra el manifiesto recibido; **no**
consulta n8n ni Supabase ni demuestra qué versión está importada o aplicada
remotamente. Para verificar el despliegue hay que cotejar allí los artefactos
y configuración por separado. No incluir secretos en el manifiesto.

**5. Presentación (front):**
```bash
cd web
cp .env.example .env.local   # completá los valores (Supabase + NEXT_PUBLIC_N8N_BASE)
npm install
npm run dev                  # http://localhost:3000
```

---

## 🧪 Pruebas

### Offline — no necesita n8n, ni base, ni credenciales

```bash
npm test
```

| Prueba | Qué verifica |
|---|---|
| `test:humo` | Ejecuta JavaScript de nodos `Code` con mocks de n8n (`$input`, `$`, `$json`, `$env`), para detectar errores de runtime sin levantar nada |
| `test:scoring` | Que la calificación de leads dé **idéntico a la tabla de referencia** en 9240 combinaciones, y que los umbrales sigan siendo configurables |
| `test:autherrores` | Que los **22 códigos** de error que Supabase Auth puede devolver en los flujos que usa la aplicación (`signUp`, `signInWithPassword` y `verifyOtp`) tengan mensaje en español. El conjunto alcanzable se declara código por código, con la operación que lo origina |
| `test:parametros` | Cómo los nodos Postgres le pasan los valores a su consulta: que usen la forma de arreglo (con la forma de texto n8n descarta los valores vacíos y parte los que traen comas), que la cantidad coincida con los `$N` del SQL y que ningún dato viaje concatenado dentro de la consulta |
| `test:edgecases` | Casos límite de `Code - Normalizar Lead`: el parser de presupuesto (formatos de moneda, notación científica, basura) y la validación de email |
| `test:backend` | Comprueba offline reservas, conciliación y transiciones financieras en esquema/workflow versionados; no ejecuta pagos reales |
| `test:herramientas` | Verifica offline helpers y el manifiesto SHA-256 local; no consulta un despliegue |

### Con Docker — base de datos

```bash
npm run test:docker
```

| Prueba | Qué verifica |
|---|---|
| `test:sql` | Compila con `PREPARE` las consultas SQL de los workflows contra el esquema real. Una columna mal escrita en un nodo Postgres se detecta acá y no en producción |
| `test:rls` | Aplica `db/schema.sql` **tal cual está en el repositorio** y prueba RLS rol por rol: que `anon` no acceda a datos protegidos, que cada desarrollador vea y opere sólo lo autorizado de su espacio, que la auditoría esté cerrada y que nadie pueda auto-ascenderse a admin |
| `test:idempotencia` | Ejecuta de verdad las consultas de deduplicación de leads y de reconciliación de facturas sobre el esquema real, leyendo el SQL del propio workflow: si un nodo deja de ser idempotente, se pone en rojo |

Ambas levantan un PostgreSQL desechable: no tocan ninguna instancia real.

### Con el sistema levantado — validación funcional

```bash
node tests/escenarios.mjs --verificar   # chequea configuración y conectividad
npm run test:escenarios                 # ejecuta el ciclo completo
```

Dispara los webhooks reales y verifica el estado resultante en la base: alta de leads HOT/COLD, lectura de propuesta, **dos aceptaciones concurrentes → una sola factura**, pago idempotente, rechazo, pedido de cambios, estado del trabajo y token vencido. Mide cada paso y escribe `reportes/escenarios.md` (fuera del repo).

> Qué riesgo cubre cada prueba: [`docs/seguridad.md`](seguridad.md).

---

## 📂 Estructura del proyecto

```
crm-freelancers-n8n/
├── web/                       # Front Next.js (App Router); en Vercel, Root Directory = web
│   └── src/
│       ├── app/(plataforma)/  # Portada, login, páginas del cliente (aceptar, proyecto, publicar…)
│       ├── app/(panel)/       # Panel del desarrollador (leads, facturas, trabajos, bolsa, tickets)
│       ├── app/f/[slug]/      # Formulario público de cada espacio
│       ├── app/api/           # Route handlers: proxy autenticado hacia n8n y tickets
│       └── lib/               # Supabase (cliente, servidor, sesión), auth, dominio
├── workflow/                  # Workflows de n8n (fuente): CRM, avisos, tickets y bot de Telegram
├── db/schema.sql              # Esquema PostgreSQL: tablas, enums, vistas, funciones y RLS
├── tests/                     # Pruebas del workflow y del esquema (offline, con Docker y de punta a punta)
│   └── rls/                   # Andamiaje de Supabase y casos de RLS
├── scripts/                   # Renderizado de CORS, manifiesto, orden del lienzo y cuentas de demo
├── docs/                      # Esta guía, seguridad, módulos y despliegue de la demo
├── .github/workflows/ci.yml   # CI: secretos, workflows + esquema + RLS, y front (lint, tipos, tests, build)
├── docker-compose.yml         # n8n + Gotenberg en una red propia
├── .env.example               # Variables del entorno de n8n
└── package.json               # Scripts de la raíz (`npm test`, `npm run check`…)
```

---

## 🔐 Seguridad

- **Token de aceptación:** UUID aleatorio por lead, validado contra la base (no falsificable) y **con vencimiento** (`TOKEN_VIGENCIA_DIAS`, 14 días por defecto). Las cuatro consultas que aceptan el token revalidan la vigencia.
- **Webhooks del panel con credencial:** las acciones internas (cancelar, resolver pedidos de cambio, mover el estado del trabajo) usan Header Auth y ya no se llaman desde el navegador: pasan por `/api/crm/[accion]`, que revalida la sesión, que el pedido sea del espacio de quien llama, y agrega el secreto del lado del servidor.
- **Aceptación atómica:** `UPDATE ... WHERE lead_id = $1 AND estado IN ('PROPUESTA_ENVIADA','EN_SEGUIMIENTO')` — evita doble facturación ante aceptaciones concurrentes.
- **Checkout y cobro:** una reserva atómica por factura/hito evita crear sesiones concurrentes; el UUID de intento impide que una respuesta obsoleta guarde otra sesión; la URL sólo se reutiliza antes de su vencimiento. Una reserva incierta o expirada no se renueva automáticamente: el flujo registra resultados sin ID y un cron barre reservas antiguas hacia `checkout_revisiones` para conciliación manual. El cron lee todas las revisiones pendientes sin ACK (incluidas las insertadas antes), espera la persistencia del aviso en el panel y sólo entonces marca `aviso_avisado_en`. Un fallo reintenta en el cron siguiente; una caída tras persistir y antes del ACK puede duplicar el aviso. El `UPDATE` condicional de la factura evita aplicar dos veces el mismo estado **en la base**, pero no impide por sí solo dos cargos externos. Un PaymentIntent confirmado que no se aplicó queda en `pagos_no_aplicados` para conciliación manual, no se reembolsa automáticamente.
- **Movimientos de hitos:** sin `STRIPE_SECRET_KEY` el cron no reclama transferencias ni devoluciones. Con clave, marca el intento antes de llamar a Stripe; si falta el ID externo después de 15 minutos, registra `hitos_movimientos_revision` y un aviso crítico, sin reintento automático.
- **Pago verificado:** el evento de Stripe (`/webhook/stripe`) sólo se aplica con la firma `Stripe-Signature` válida (HMAC SHA-256 del cuerpo crudo con `STRIPE_WEBHOOK_SECRET`, con tolerancia de 5 minutos contra reenvíos) y si el monto y la moneda coinciden con la factura. Detalle y procedimiento de revisión en [`docs/modulo-pagos.md`](modulo-pagos.md) y [`docs/modulo-hitos.md`](modulo-hitos.md).
- **Cierre y propuestas:** el cierre manual exige trabajo `ENTREGADO` y cobro registrado; no marca facturas pagadas a mano. La propuesta reclama un `propuesta_envio_intento_id` UUID y congela términos antes de Gmail; un fallo de envío exige verificarlo antes de reabrir. La finalización sólo aplica si siguen iguales el reclamo, token y espacio originales; un cambio concurrente devuelve conflicto 409 en vez de mutar al nuevo dueño. La reasignación de un pedido rechazado reinicia el reclamo y rota el token, sin prometer entrega atómica del correo. El ACK del subworkflow de avisos acredita persistencia en el panel, no entrega opcional por Gmail/Telegram.
- **Dashboard con control de acceso:** Supabase Auth + compuerta de espacio propio en la página y en cada route handler; lee con la anon key bajo sesión, nunca la service key. Las acciones que pasan por n8n comprueban antes que el pedido sea del espacio de quien llama.
- **RLS en la base:** las políticas de `authenticated` limitan las filas de negocio al espacio propio; las vistas usan `security_invoker` y `anon` no lee esas tablas. El rol de integración `n8n_writer` tiene políticas y permisos distintos (ver punto siguiente).
- **Rol de n8n acotado, no limitado a cuatro tablas:** el esquema concede a `n8n_writer` operaciones por tabla/columna sobre leads, facturas, seguimientos y logs, y también permisos necesarios para espacios, tickets, avisos, bolsa, mensajes e hitos, entre otros. No tiene `BYPASSRLS` ni `DELETE` por diseño; sus políticas de escritura no restringen por espacio. Consultar los `GRANT` y políticas de `db/schema.sql` para el alcance exacto. El repositorio no verifica qué credencial utiliza un despliegue concreto.
- **Secretos fuera del repo:** credenciales en n8n y en `.env.local` (ignorado por git). El workflow versionado usa `REEMPLAZAR_AL_IMPORTAR` en lugar de IDs reales, y **ninguna URL ni ID queda escrito a mano dentro de los nodos**: todo sale de variables de entorno.
- **RLS verificable, no sólo declarada:** `npm run test:rls` ejecuta la batería de casos del esquema versionado contra un PostgreSQL desechable (ver [`docs/seguridad.md`](seguridad.md)).
- **Rate limiting del formulario:** el workflow versionado usa un contador atómico por IP, ruta y ventana fija; toma el último tramo de `X-Forwarded-For` detrás de un proxy de confianza. Al exceder el umbral corta el procesamiento interno de `lead/nuevo`, pero esa ruta conserva el acuse inmediato y no devuelve 429. Siguen pendientes un captcha validado del lado del servidor y la verificación del despliegue concreto.
