-- =====================================================================
-- Esquema de la base de datos — FormularioLeads
-- PostgreSQL / Supabase. Idempotente: se puede ejecutar varias veces.
--
-- Este archivo es la fuente de verdad del modelo de datos y de la
-- seguridad a nivel de fila (RLS); ver docs/seguridad.md.
--
-- Modelo de seguridad:
--   • La ESCRITURA la realiza n8n con el rol `n8n_writer`: sin BYPASSRLS,
--     con políticas propias sobre las tablas que usa el workflow, incluido
--     el registro financiero y las cuotas de tasa. No tiene BYPASSRLS ni
--     acceso general a profiles. El radio de daño debe evaluarse contra
--     los GRANT y las políticas vigentes más abajo. `service_role`
--     sigue existiendo (GRANT más abajo) para uso administrativo puntual,
--     pero deja de ser la credencial que usa la conexión de n8n.
--   • La plataforma es compartida: cada desarrollador tiene un ESPACIO
--     (tabla `espacios`, se crea al confirmar la cuenta) y todas las filas
--     de negocio llevan `espacio_id`. La LECTURA del tablero exige que la
--     fila sea del espacio de quien consulta; estar autenticado no alcanza.
--     `profiles.role = 'admin'` queda para el administrador de la
--     plataforma y no da acceso a los datos de ningún espacio.
--   • El rol `anon` (público, sin sesión) no tiene acceso a las tablas
--     de negocio (deny por defecto de la RLS). El formulario público no
--     lee la base: envía los datos a n8n por webhook.
--   • Las vistas se declaran con `security_invoker = true` para que
--     respeten las políticas de las tablas subyacentes.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- Tipos enumerados
-- ---------------------------------------------------------------------
DO $$ BEGIN CREATE TYPE urgencia_tipo AS ENUM ('alta','media','baja');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE servicio_tipo AS ENUM
  ('desarrollo_web','ecommerce','app_movil','automatizacion','diseno_ui','consultoria','soporte','marketing','seo');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE tier_tipo AS ENUM ('HOT','WARM','COLD');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE lead_estado AS ENUM
  ('NUEVO','PROPUESTA_ENVIADA','EN_SEGUIMIENTO','ACEPTADO','FACTURADO','CERRADO','PERDIDO');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE pago_estado AS ENUM ('PENDIENTE','COBRADO','VENCIDA','ANULADA');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE log_nivel AS ENUM
  ('INFO','RECORDATORIO','HOY','VENCIDA','URGENTE','WARN','ERROR');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Estado del TRABAJO (ejecución del proyecto, distinto del estado del lead/venta)
DO $$ BEGIN CREATE TYPE trabajo_estado AS ENUM ('PENDIENTE','EN_PROGRESO','EN_REVISION','ENTREGADO');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ---------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------

-- Espacios (23-sep-2026): la plataforma pasa a ser compartida. Cada
-- desarrollador que se registra tiene el suyo, con su marca, y todo lo de
-- negocio (leads, facturas, seguimientos, tickets, logs) pertenece a un
-- espacio. La RLS deja ver a cada uno sólo lo de su espacio.
-- `dueno_id` UNIQUE: un espacio por cuenta. ON DELETE SET NULL y no CASCADE:
-- las facturas son registro contable y no se pueden ir con la cuenta.
CREATE TABLE IF NOT EXISTS espacios (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Identificador público del formulario (/f/<slug>).
  slug       TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  -- La marca que ve el cliente en el formulario, los correos y la factura.
  nombre     TEXT NOT NULL CHECK (length(btrim(nombre)) BETWEEN 1 AND 80),
  dueno_id   UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  -- A dónde van las respuestas de los clientes (Reply-To de los correos, que
  -- salen de la casilla de la plataforma). Arranca con el correo de la cuenta.
  email_contacto TEXT CHECK (email_contacto IS NULL OR email_contacto ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  -- Telegram, opcional: el chat al que le llegan los avisos. Se vincula desde
  -- el panel con un código de un solo uso que el desarrollador le manda al
  -- bot de la plataforma (workflow/telegram_vincular.json).
  telegram_chat_id      TEXT,
  telegram_codigo       TEXT UNIQUE,
  telegram_codigo_vence TIMESTAMPTZ,
  -- Cobros: la cuenta conectada de Stripe (Express) del desarrollador, a la
  -- que va lo que pagan sus clientes menos la comisión de la plataforma. La
  -- crea y la consulta n8n (workflow/crm_postgres.json, RAMA de cobros).
  stripe_account_id     TEXT UNIQUE,
  stripe_cobros_activos BOOLEAN NOT NULL DEFAULT false,
  -- NULL hasta que el dueño elige el nombre y la dirección por primera vez:
  -- mientras tanto, el panel lo manda a completar su alta. Lo fija el
  -- trigger trg_espacios_configurado, no quien edita.
  configurado_en TIMESTAMPTZ,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leads (
  id                        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lead_id                   TEXT UNIQUE NOT NULL,
  espacio_id                UUID NOT NULL REFERENCES espacios(id),
  nombre                    TEXT NOT NULL,
  email                     TEXT NOT NULL CHECK (position('@' in email) > 1),
  telefono                  TEXT,
  presupuesto               NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (presupuesto >= 0),
  urgencia                  urgencia_tipo NOT NULL DEFAULT 'media',
  servicio                  servicio_tipo NOT NULL DEFAULT 'desarrollo_web',
  descripcion               TEXT,
  fuente                    TEXT DEFAULT 'webhook',
  estado                    lead_estado NOT NULL DEFAULT 'NUEVO',
  estado_trabajo            trabajo_estado NOT NULL DEFAULT 'PENDIENTE',
  score                     INT NOT NULL DEFAULT 0,
  tier                      tier_tipo,
  seguimientos              INT NOT NULL DEFAULT 0,
  operador_asignado         TEXT,
  notas                     TEXT,
  accept_token              UUID NOT NULL DEFAULT gen_random_uuid(),
  -- Vigencia del enlace de aceptación. La estampa n8n al enviar la propuesta
  -- (`now() + TOKEN_VIGENCIA_DIAS`) y la revalidan todas las consultas que
  -- aceptan el token. NULL = sin vencimiento (leads anteriores a la columna).
  token_expira_en           TIMESTAMPTZ,
  fecha_ingreso             TIMESTAMPTZ NOT NULL DEFAULT now(),
  fecha_propuesta           TIMESTAMPTZ,
  fecha_ultimo_seguimiento  TIMESTAMPTZ,
  fecha_aceptacion          TIMESTAMPTZ,
  fecha_cierre              TIMESTAMPTZ,
  dias_ciclo_completo       INT,
  creado_en                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS facturas (
  id                     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  factura_id             TEXT UNIQUE NOT NULL,
  -- Siempre el del lead: lo fija el trigger trg_facturas_espacio.
  espacio_id             UUID NOT NULL REFERENCES espacios(id),
  -- RESTRICT (no CASCADE): las facturas son el registro financiero/legal del
  -- negocio. Un DELETE FROM leads (vía service_role, que evade RLS) no puede
  -- llevarse puestas las facturas asociadas en silencio.
  lead_id                TEXT NOT NULL REFERENCES leads(lead_id) ON DELETE RESTRICT,
  cliente                TEXT NOT NULL,
  email                  TEXT NOT NULL,
  servicio               servicio_tipo,
  monto                  NUMERIC(12,2) NOT NULL CHECK (monto >= 0),
  -- 'USD' desde el 24-sep-2026: la plataforma cobra en dólares con Stripe.
  -- 'ARS' queda admitido por las facturas emitidas con MercadoPago.
  moneda                 TEXT NOT NULL DEFAULT 'USD' CHECK (moneda IN ('ARS','USD')),
  estado_pago            pago_estado NOT NULL DEFAULT 'PENDIENTE',
  recordatorios_enviados INT NOT NULL DEFAULT 0,
  fecha_emision          TIMESTAMPTZ NOT NULL DEFAULT now(),
  fecha_vencimiento      TIMESTAMPTZ NOT NULL,
  fecha_cobro            TIMESTAMPTZ,
  -- Cobro con Stripe Connect (24-sep-2026). La sesión de pago se crea recién
  -- cuando el cliente abre el enlace de la factura: `stripe_checkout_id` es
  -- la última (para expirarla si se anula) y `stripe_pago_id` el PaymentIntent
  -- que la pagó. `comision_plataforma` es lo que se queda la plataforma
  -- (COMISION_PLATAFORMA_PORCENTAJE, 1% por defecto): Stripe la separa sola
  -- como application fee y el resto va a la cuenta del desarrollador.
  -- `mp_*` quedan por las facturas cobradas con MercadoPago.
  stripe_checkout_id     TEXT,
  stripe_pago_id         TEXT,
  mp_preference_id       TEXT,
  mp_payment_id          TEXT,
  comision_plataforma    NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- NULL = todavía no se confirmó el envío del PDF inicial por Gmail (falla
  -- de Gotenberg o de Gmail después de insertada la factura). No dispara un
  -- reintento por sí sola: el cron de recordatorios de pago ya avisa al
  -- cliente con el link igual, aunque nunca haya recibido el PDF. Sirve para
  -- poder auditar cuántas facturas quedaron así.
  fecha_envio_email      TIMESTAMPTZ,
  creado_en              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS seguimientos (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lead_id      TEXT NOT NULL REFERENCES leads(lead_id) ON DELETE CASCADE,
  espacio_id   UUID NOT NULL REFERENCES espacios(id),
  numero       INT NOT NULL,
  canal        TEXT NOT NULL DEFAULT 'email',
  asunto       TEXT,
  cuerpo       TEXT,
  enviado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS logs (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workflow    TEXT,
  lead_id     TEXT,
  -- NULL en los eventos que no son de un lead (crons, errores generales).
  espacio_id  UUID REFERENCES espacios(id),
  evento      TEXT,
  nivel       log_nivel NOT NULL DEFAULT 'INFO',
  detalle     TEXT,
  error_msg   TEXT,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Rol de aplicación por usuario. 'admin' es el administrador de la plataforma
-- y no da acceso a los datos de ningún espacio (ver la sección de RLS).
-- Se completa sola vía trigger al registrarse (ver handle_new_user más abajo).
CREATE TABLE IF NOT EXISTS profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Supabase Auth admite registros solo-teléfono (email=NULL): antes esta
  -- columna era NOT NULL y el INSERT del trigger handle_new_user() abortaba
  -- para esos usuarios, dejando la cuenta sin fila en profiles.
  email      TEXT,
  role       TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tipo de cuenta (24-sep-2026, clientes que publican proyectos): una cuenta
-- es de desarrollador (tiene espacio y panel) o de cliente (entra con enlace
-- mágico y ve sus proyectos). Lo fija handle_new_user() al crear la cuenta,
-- según lo que pidió la página de alta; el usuario no puede cambiarlo después
-- (profiles no tiene permiso de escritura para authenticated). Las cuentas
-- anteriores son todas de desarrollador.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'desarrollador';
DO $$ BEGIN
  ALTER TABLE profiles ADD CONSTRAINT chk_profiles_tipo CHECK (tipo IN ('desarrollador','cliente'));
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Whitelist de admins editable sin tocar este archivo (antes era un string
-- literal comparado en handle_new_user(), lo que además de forzar un cambio
-- de schema para sumar un admin, era un vector de privilege escalation: quien
-- sea que registrara esa dirección exacta se auto-promovía). Sin RLS propia:
-- solo la consulta el trigger SECURITY DEFINER y se administra a mano vía
-- service_role, igual que el resto de las tablas sin política para
-- authenticated/anon.
CREATE TABLE IF NOT EXISTS admin_emails (
  email TEXT PRIMARY KEY
);
-- Sin semilla a propósito. Hasta el 23-sep-2026 se insertaba 'admin@gmail.com',
-- una casilla pública real: quien fuera su dueño se registraba y quedaba admin.
-- Para dar de alta al administrador, una vez y con la dirección real:
--   INSERT INTO admin_emails (email) VALUES ('tu-correo@dominio.com');
-- En una base ya creada, esa fila vieja sigue ahí hasta que se borre a mano
-- (DELETE FROM admin_emails WHERE email = 'admin@gmail.com'); no se borra
-- desde acá por si esa era, de verdad, la dirección del administrador.

-- Tickets: el tablero de trabajo del panel. Hasta el 23-sep-2026 vivían en una
-- base de Notion y n8n hacía de traductor; ahora son una tabla más, con RLS,
-- tiempo real y la regla de envejecimiento en SQL (ticket_dias_escalada más
-- abajo y el cron del workflow de tickets).
DO $$ BEGIN CREATE TYPE ticket_estado AS ENUM ('BACKLOG','EN_CURSO','BLOQUEADO','HECHO');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- El orden del enum ES la escala: el cron sube al valor siguiente.
DO $$ BEGIN CREATE TYPE ticket_prioridad AS ENUM ('BAJA','MEDIA','ALTA','CRITICA');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS tickets (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  espacio_id         UUID NOT NULL REFERENCES espacios(id),
  titulo             TEXT NOT NULL CHECK (length(btrim(titulo)) BETWEEN 1 AND 200),
  estado             ticket_estado NOT NULL DEFAULT 'BACKLOG',
  prioridad          ticket_prioridad NOT NULL DEFAULT 'MEDIA',
  prioridad_inicial  ticket_prioridad NOT NULL DEFAULT 'MEDIA',
  etiquetas          TEXT[] NOT NULL DEFAULT '{}',
  origen             TEXT NOT NULL DEFAULT 'DASHBOARD' CHECK (origen IN ('DASHBOARD','CRM')),
  -- El proyecto al que pertenece, si lo sembró la aceptación de una propuesta.
  lead_id            TEXT REFERENCES leads(lead_id) ON DELETE SET NULL,
  notas              TEXT CHECK (notas IS NULL OR length(notas) <= 2000),
  vence              DATE,
  escaladas          INT NOT NULL DEFAULT 0,
  -- Último cambio de estado o de prioridad (incluida una escalada): es el
  -- reloj del envejecimiento. Lo mantiene el trigger trg_tickets_movimiento.
  ultimo_movimiento  TIMESTAMPTZ NOT NULL DEFAULT now(),
  cerrado_en         TIMESTAMPTZ,
  creado_en          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Registro de invocaciones por IP/clave y ruta, para el rate limiting básico
-- de los cinco webhooks públicos que no admiten autenticación de origen
-- (Tabla 11, S1: lead/nuevo, lead-propuesta, lead-acepta, lead-rechaza,
-- lead-modifica — los invoca el navegador de un tercero, así que no puede
-- llevar un secreto compartido sin exponerlo). Cada invocación de esas rutas
-- inserta una fila acá antes de seguir; el propio nodo Postgres cuenta cuántas
-- hubo desde la misma clave en la ventana reciente y corta la cadena si se
-- pasó del umbral (ver workflow/crm_postgres.json, nodos «Postgres - Rate
-- Limit (...)» y docs/seguridad.md §5.3.1).
-- `ip_o_clave` es la IP de origen para los cuatro webhooks de token, y el
-- email declarado en el propio formulario (si vino) para `lead/nuevo`.
-- Avisos al desarrollador (23-sep-2026). Hasta entonces todo iba a un único
-- chat de Telegram; con la plataforma compartida, cada aviso es del espacio
-- del pedido que lo origina y se ve en su panel. El subflujo
-- workflow/avisos.json lo registra acá y además lo manda por correo (los que
-- piden una acción) y por Telegram (si el desarrollador lo vinculó).
-- `espacio_id` NULL = aviso de la plataforma (no es de ningún desarrollador).
CREATE TABLE IF NOT EXISTS avisos (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  espacio_id  UUID REFERENCES espacios(id),
  tipo        TEXT NOT NULL CHECK (length(tipo) BETWEEN 1 AND 60),
  -- 'atencion' pide una acción del desarrollador y además va por correo;
  -- 'critico' también le llega a la plataforma.
  nivel       TEXT NOT NULL DEFAULT 'info' CHECK (nivel IN ('info','atencion','critico')),
  mensaje     TEXT NOT NULL CHECK (length(mensaje) <= 4000),
  lead_id     TEXT,
  factura_id  TEXT,
  leido_en    TIMESTAMPTZ,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rate_limit_log (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ip_o_clave  TEXT NOT NULL,
  ruta        TEXT NOT NULL,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Contador atómico por ventana fija: ON CONFLICT serializa llamadas paralelas
-- de la misma clave. rate_limit_log sigue como auditoría, no como contador.
CREATE TABLE IF NOT EXISTS rate_limit_cuotas (
  ip_o_clave TEXT NOT NULL,
  ruta TEXT NOT NULL,
  ventana_inicio TIMESTAMPTZ NOT NULL,
  intentos INT NOT NULL DEFAULT 0 CHECK (intentos >= 0),
  PRIMARY KEY (ip_o_clave, ruta, ventana_inicio)
);

-- Limpieza periódica (pendiente, documentada y no implementada): esta tabla
-- crece sin techo, igual que `logs`. No hay un cron dedicado a purgarla; se
-- podría sumar `DELETE FROM rate_limit_log WHERE creado_en < now() - interval
-- '7 days';` al cron ♻️ Cron - Reconciliar Facturas (RAMA 9, cada 30 minutos)
-- o a uno propio. No se implementó acá porque `n8n_writer` está deliberadamente
-- sin privilegio de DELETE (ningún nodo del flujo borra filas hoy — ver 5.1
-- más abajo) y sumarle uno solo para esta tabla rompería esa invariante sin
-- necesidad real a la escala del MVP.

-- =====================================================================
-- Migraciones para bases YA creadas (idempotentes; no afectan a una base
-- nueva, donde las definiciones de arriba ya incluyen estas columnas/valores)
--
-- Tienen que ir ACÁ, entre las tablas y los índices, y no al final del
-- archivo: los índices y las vistas de más abajo referencian estas columnas.
-- Sobre una base nueva da igual el orden, porque los CREATE TABLE ya las
-- traen; sobre una base vieja, en cambio, el índice se crearía antes de que
-- exista la columna y el script aborta.
-- =====================================================================

-- Notion salió del sistema (23-sep-2026): el lead ya no tiene una tarjeta
-- espejo, así que `card_id` no apunta a nada.
ALTER TABLE leads DROP COLUMN IF EXISTS card_id;

-- Columna de estado del trabajo (para bases creadas antes de agregarla).
ALTER TABLE leads ADD COLUMN IF NOT EXISTS estado_trabajo trabajo_estado NOT NULL DEFAULT 'PENDIENTE';

-- Vigencia del enlace de aceptación (para bases ya creadas). Se deja NULL en
-- las filas existentes: los enlaces ya emitidos siguen siendo válidos y las
-- consultas los aceptan con `token_expira_en IS NULL`.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS token_expira_en TIMESTAMPTZ;

-- Servicios marketing/seo que ofrece el formulario (para bases ya creadas).
ALTER TYPE servicio_tipo ADD VALUE IF NOT EXISTS 'marketing';
ALTER TYPE servicio_tipo ADD VALUE IF NOT EXISTS 'seo';

-- Coherencia de fechas de facturación. NOT VALID: se aplica a las filas nuevas
-- sin exigir que las existentes la cumplan, para que el script siga siendo
-- ejecutable sobre una base con datos.
DO $$ BEGIN
  ALTER TABLE facturas ADD CONSTRAINT chk_facturas_fechas
    CHECK (fecha_vencimiento >= fecha_emision) NOT VALID;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Cobro real con MercadoPago (para bases ya creadas). Ver RAMA 8 del
-- workflow y docs/modulo-pagos.md.
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS mp_preference_id TEXT;
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS mp_payment_id TEXT;
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS comision_plataforma NUMERIC(12,2) NOT NULL DEFAULT 0;
DO $$ BEGIN
  ALTER TABLE facturas ADD CONSTRAINT chk_facturas_comision
    CHECK (comision_plataforma >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Enlace de pago de la factura (para bases ya creadas). Se calculaba al emitir
-- el comprobante y vivía sólo en esa ejecución, de modo que los recordatorios
-- de vencimiento —que leen la factura días después— reclamaban el pago sin
-- poder ofrecer ninguna forma de hacerlo. Guardarlo con la factura, que es de
-- lo que es propiedad, permite que cualquier aviso posterior lo incluya.
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS pay_url TEXT;

-- Token del modo de desarrollo de pago (S1 de la Tabla 11, para bases ya
-- creadas). El endpoint GET /webhook/pago-confirmado sólo exigía factura_id
-- —formato FAC-<año>-<4 dígitos>, 10.000 combinaciones adivinables por año—
-- y ninguna credencial: cualquiera que adivinara o interceptara el
-- identificador podía marcar una factura como cobrada. Mismo mecanismo que
-- accept_token: un valor aleatorio por recurso, verificado contra la base
-- en vez de un secreto compartido estático.
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS pago_token UUID NOT NULL DEFAULT gen_random_uuid();

-- Cómo se cobró la factura (23-sep-2026, para bases ya creadas). Cerrar el
-- proyecto desde el panel da la factura por COBRADO sin que haya entrado
-- ningún pago registrado (se asume cobrada por fuera del sistema); sin esta
-- columna ese cierre era indistinguible de un cobro real y engordaba
-- `cobrado` y `tasa_cobro_pct`. NULL = cobrada antes de la columna, o no
-- cobrada todavía.
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS metodo_cobro TEXT;
-- 'STRIPE' desde el 24-sep-2026. Se recrea en cada pasada para que una base
-- vieja tome la lista nueva; 'MERCADOPAGO' queda por las facturas anteriores.
ALTER TABLE facturas DROP CONSTRAINT IF EXISTS chk_facturas_metodo_cobro;
ALTER TABLE facturas ADD CONSTRAINT chk_facturas_metodo_cobro
  CHECK (metodo_cobro IS NULL OR metodo_cobro IN ('STRIPE','MERCADOPAGO','DESARROLLO','CIERRE_MANUAL')) NOT VALID;

-- Términos que fija el profesional antes de enviar la propuesta (para bases ya
-- creadas). Hasta su incorporación, el precio de la propuesta y el monto de la
-- factura salían de `leads.presupuesto`, es decir del valor que el propio
-- interesado elegía en el formulario: el sistema comprometía al profesional con
-- un importe que él nunca fijaba. `presupuesto` se conserva sin tocar porque es
-- la entrada del scoring y el registro de lo que el cliente declaró; el importe
-- que se factura es `precio_propuesto`.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS precio_propuesto  NUMERIC(12,2);
-- Una reserva con UUID bloquea Checkout concurrentes. No vence por reloj:
-- aunque la URL de Stripe haya expirado, el intento sólo se libera tras
-- verificar externamente su estado y resolver checkout_revisiones. El UUID
-- es el CAS que impide guardar una respuesta vieja sobre otra operación.
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS stripe_checkout_reservado_en TIMESTAMPTZ;
-- La marca se fija atómicamente antes de Gmail. Si el flujo falla, un operador
-- verifica la salida externa: si NO salió, puede limpiar esta marca para
-- reintentar; si salió, completa PROPUESTA_ENVIADA sin mandar otro correo.
-- Nunca se limpia automáticamente por antigüedad.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS propuesta_envio_iniciado_en TIMESTAMPTZ;
-- Identidad del reclamo: a diferencia de now(), sobrevive intacta al viaje
-- PostgreSQL → JSON/Date de n8n → PostgreSQL (sin perder microsegundos).
-- Reclamos legacy con fecha pero sin UUID quedan bloqueados para conciliación
-- manual; no se les inventa identidad ni se reenvía el correo automáticamente.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS propuesta_envio_intento_id UUID;
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS stripe_checkout_intento_id UUID;
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS stripe_checkout_expira_en TIMESTAMPTZ;
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS stripe_checkout_url TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS plazo_propuesto   TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS alcance_propuesto TEXT;
DO $$ BEGIN
  ALTER TABLE leads ADD CONSTRAINT chk_leads_precio_propuesto
    CHECK (precio_propuesto IS NULL OR precio_propuesto > 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Rango de presupuesto que eligió el cliente (formulario desde el 24-sep-2026,
-- que dejó el slider por rangos). `presupuesto` sigue siendo la entrada del
-- scoring y guarda el piso del rango (100 para «menos de 300»), que coincide
-- con los cortes de SCORING_PRESUPUESTO; este campo guarda lo que el cliente
-- dijo de verdad. NULL = lead anterior a los rangos o llegado por otra vía.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS presupuesto_rango TEXT;
DO $$ BEGIN
  ALTER TABLE leads ADD CONSTRAINT chk_leads_presupuesto_rango
    CHECK (presupuesto_rango IS NULL OR presupuesto_rango IN ('hasta_300','300_1000','1000_2000','2000_5000','mas_5000'));
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- profiles.email pasa a nullable (para bases ya creadas): Supabase Auth
-- admite registros solo-teléfono y el trigger handle_new_user() los rechazaba.
ALTER TABLE profiles ALTER COLUMN email DROP NOT NULL;

-- facturas.lead_id pasa de CASCADE a RESTRICT (para bases ya creadas). El
-- nombre de constraint es el que Postgres genera por defecto para una
-- REFERENCES inline en la columna.
ALTER TABLE facturas DROP CONSTRAINT IF EXISTS facturas_lead_id_fkey;
ALTER TABLE facturas ADD CONSTRAINT facturas_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES leads(lead_id) ON DELETE RESTRICT;

-- facturas.moneda: 'ARS' mientras se cobró con MercadoPago y 'USD' desde el
-- 24-sep-2026, con Stripe (para bases ya creadas). El CHECK va NOT VALID para
-- no exigirle a las filas existentes que ya lo cumplan (mismo criterio que
-- chk_facturas_fechas y chk_facturas_comision).
ALTER TABLE facturas ALTER COLUMN moneda SET DEFAULT 'USD';
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS stripe_checkout_id TEXT;
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS stripe_pago_id TEXT;
DO $$ BEGIN
  ALTER TABLE facturas ADD CONSTRAINT chk_facturas_moneda
    CHECK (moneda IN ('ARS','USD')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Espacios (23-sep-2026, para bases ya creadas). Todo lo que ya existía era de
-- un único dueño, así que va a un espacio "principal" a nombre del primer
-- admin. Si no hay ningún admin, el espacio queda sin dueño y se asigna a mano:
--   UPDATE espacios SET dueno_id = '<uuid de auth.users>' WHERE slug = 'principal';
ALTER TABLE leads        ADD COLUMN IF NOT EXISTS espacio_id UUID REFERENCES espacios(id);
ALTER TABLE facturas     ADD COLUMN IF NOT EXISTS espacio_id UUID REFERENCES espacios(id);
ALTER TABLE seguimientos ADD COLUMN IF NOT EXISTS espacio_id UUID REFERENCES espacios(id);
ALTER TABLE logs         ADD COLUMN IF NOT EXISTS espacio_id UUID REFERENCES espacios(id);
ALTER TABLE tickets      ADD COLUMN IF NOT EXISTS espacio_id UUID REFERENCES espacios(id);

DO $$
DECLARE
  principal uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM leads WHERE espacio_id IS NULL)
     OR EXISTS (SELECT 1 FROM tickets WHERE espacio_id IS NULL) THEN
    SELECT id INTO principal FROM espacios ORDER BY creado_en LIMIT 1;
    IF principal IS NULL THEN
      INSERT INTO espacios (slug, nombre, dueno_id)
      VALUES ('principal', 'Mi espacio',
              (SELECT id FROM profiles WHERE role = 'admin' ORDER BY creado_en LIMIT 1))
      RETURNING id INTO principal;
    END IF;

    -- Sin tocar actualizado_en: la migración no es un cambio del lead. Si el
    -- trigger todavía no existe (primera pasada sobre una base vieja), el
    -- DISABLE falla y se ignora.
    BEGIN
      ALTER TABLE leads DISABLE TRIGGER trg_leads_updated;
    EXCEPTION WHEN undefined_object THEN null;
    END;
    UPDATE leads SET espacio_id = principal WHERE espacio_id IS NULL;
    BEGIN
      ALTER TABLE leads ENABLE TRIGGER trg_leads_updated;
    EXCEPTION WHEN undefined_object THEN null;
    END;

    UPDATE tickets SET espacio_id = principal WHERE espacio_id IS NULL AND lead_id IS NULL;
  END IF;
END $$;

UPDATE facturas f     SET espacio_id = l.espacio_id FROM leads l WHERE f.lead_id = l.lead_id AND f.espacio_id IS NULL;
UPDATE seguimientos s SET espacio_id = l.espacio_id FROM leads l WHERE s.lead_id = l.lead_id AND s.espacio_id IS NULL;
UPDATE tickets t      SET espacio_id = l.espacio_id FROM leads l WHERE t.lead_id = l.lead_id AND t.espacio_id IS NULL;
UPDATE logs g         SET espacio_id = l.espacio_id FROM leads l WHERE g.lead_id = l.lead_id AND g.espacio_id IS NULL;

ALTER TABLE espacios ADD COLUMN IF NOT EXISTS configurado_en TIMESTAMPTZ;
ALTER TABLE espacios ADD COLUMN IF NOT EXISTS email_contacto TEXT;
ALTER TABLE espacios ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;
ALTER TABLE espacios ADD COLUMN IF NOT EXISTS telegram_codigo TEXT;
ALTER TABLE espacios ADD COLUMN IF NOT EXISTS telegram_codigo_vence TIMESTAMPTZ;
ALTER TABLE espacios ADD COLUMN IF NOT EXISTS stripe_account_id TEXT;
ALTER TABLE espacios ADD COLUMN IF NOT EXISTS stripe_cobros_activos BOOLEAN NOT NULL DEFAULT false;
DO $$ BEGIN
  ALTER TABLE espacios ADD CONSTRAINT espacios_stripe_account_id_key UNIQUE (stripe_account_id);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE espacios ADD CONSTRAINT espacios_telegram_codigo_key UNIQUE (telegram_codigo);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE espacios ADD CONSTRAINT espacios_email_contacto_check
    CHECK (email_contacto IS NULL OR email_contacto ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');
EXCEPTION WHEN duplicate_object THEN null; END $$;
-- Los espacios ya creados arrancan con el correo de su cuenta.
UPDATE espacios e SET email_contacto = u.email
FROM auth.users u
WHERE u.id = e.dueno_id AND e.email_contacto IS NULL AND u.email IS NOT NULL;

ALTER TABLE leads        ALTER COLUMN espacio_id SET NOT NULL;
ALTER TABLE facturas     ALTER COLUMN espacio_id SET NOT NULL;
ALTER TABLE seguimientos ALTER COLUMN espacio_id SET NOT NULL;
ALTER TABLE tickets      ALTER COLUMN espacio_id SET NOT NULL;


-- ---------------------------------------------------------------------
-- Índices
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_leads_estado       ON leads(estado);
CREATE INDEX IF NOT EXISTS idx_leads_tier         ON leads(tier);
CREATE INDEX IF NOT EXISTS idx_leads_fecha_ing    ON leads(fecha_ingreso);
CREATE INDEX IF NOT EXISTS idx_facturas_estado    ON facturas(estado_pago);
CREATE INDEX IF NOT EXISTS idx_facturas_lead      ON facturas(lead_id);
CREATE INDEX IF NOT EXISTS idx_seguimientos_lead  ON seguimientos(lead_id);

-- `logs` es la tabla de auditoría: crece sin techo y se consulta por lead y
-- por fecha. No tenía ningún índice.
CREATE INDEX IF NOT EXISTS idx_logs_creado_en     ON logs(creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_logs_lead          ON logs(lead_id);
CREATE INDEX IF NOT EXISTS idx_logs_nivel         ON logs(nivel) WHERE nivel IN ('WARN','ERROR');

-- El cron de recordatorios lee `facturas_pendientes` (estado_pago='PENDIENTE')
-- ordenando por vencimiento: el índice compuesto resuelve filtro y orden juntos.
CREATE INDEX IF NOT EXISTS idx_facturas_venc      ON facturas(estado_pago, fecha_vencimiento);

-- El INSERT de leads (Postgres - Insert Lead) filtra por lower(email) +
-- creado_en bajo el advisory lock de deduplicación: sin este índice funcional
-- hace un seq scan completo en la ruta más caliente del webhook público.
CREATE INDEX IF NOT EXISTS idx_leads_dedup ON leads (lower(email), creado_en);

-- `rate_limit_log`: cada webhook protegido cuenta "cuántas filas con esta
-- clave y esta ruta en los últimos N minutos", que es exactamente lo que el
-- índice compuesto resuelve sin recorrer la tabla entera.
CREATE INDEX IF NOT EXISTS idx_rate_limit_clave_ruta_fecha
  ON rate_limit_log(ip_o_clave, ruta, creado_en);

-- idx_leads_token_venc (accept_token, token_expira_en) quedaba muerto: las
-- consultas de aceptación filtran primero por lead_id (ya UNIQUE) y comparan
-- accept_token::text = $2, y ese cast sobre la columna impide usar un índice
-- btree plano sobre accept_token. Se dropea acá para bases ya creadas; no
-- vuelve a declararse arriba.
DROP INDEX IF EXISTS idx_leads_token_venc;

-- Tickets: el tablero lee los abiertos, el cron busca los quietos, y la
-- siembra del CRM no puede duplicar un ticket del mismo proyecto.
CREATE INDEX IF NOT EXISTS idx_tickets_estado ON tickets(estado, ultimo_movimiento);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tickets_lead_titulo ON tickets(lead_id, titulo) WHERE lead_id IS NOT NULL;

-- Espacios: todas las políticas del tablero filtran por espacio_id.
CREATE INDEX IF NOT EXISTS idx_leads_espacio        ON leads(espacio_id, fecha_ingreso DESC);
CREATE INDEX IF NOT EXISTS idx_facturas_espacio     ON facturas(espacio_id);
CREATE INDEX IF NOT EXISTS idx_seguimientos_espacio ON seguimientos(espacio_id);
CREATE INDEX IF NOT EXISTS idx_tickets_espacio      ON tickets(espacio_id, estado);
CREATE INDEX IF NOT EXISTS idx_logs_espacio         ON logs(espacio_id) WHERE espacio_id IS NOT NULL;
-- El panel lee los avisos sin leer de su espacio, los más nuevos primero.
CREATE INDEX IF NOT EXISTS idx_avisos_espacio       ON avisos(espacio_id, creado_en DESC);

-- Nota de alcance: a la escala del MVP (decenas de filas) estos índices no
-- cambian los tiempos de forma observable. Se agregan porque las consultas que
-- los usan ya están escritas y son las que crecerían en un uso real.

-- ---------------------------------------------------------------------
-- Trigger: mantiene actualizado_en al día en cada UPDATE
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_actualizado_en() RETURNS trigger AS $$
BEGIN
  NEW.actualizado_en = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_leads_updated ON leads;
CREATE TRIGGER trg_leads_updated
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();

-- ---------------------------------------------------------------------
-- Tickets: reglas del envejecimiento
-- ---------------------------------------------------------------------
-- Días sin movimiento que tolera cada prioridad antes de subir un escalón.
-- CRITICA es el tope: no escala.
CREATE OR REPLACE FUNCTION ticket_dias_escalada(p ticket_prioridad) RETURNS int
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p WHEN 'BAJA' THEN 10 WHEN 'MEDIA' THEN 7 WHEN 'ALTA' THEN 4 END
$$;

-- Peso de la prioridad en el score (0-100) que ordena el tablero.
CREATE OR REPLACE FUNCTION ticket_peso(p ticket_prioridad) RETURNS int
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p WHEN 'BAJA' THEN 10 WHEN 'MEDIA' THEN 25 WHEN 'ALTA' THEN 50 WHEN 'CRITICA' THEN 80 END
$$;

-- Cambiar el estado o la prioridad cuenta como movimiento y reinicia el reloj
-- (desde el tablero, o el propio cron al escalar). Pasar a HECHO lo cierra.
CREATE OR REPLACE FUNCTION tickets_movimiento() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.estado IS DISTINCT FROM OLD.estado OR NEW.prioridad IS DISTINCT FROM OLD.prioridad THEN
    NEW.ultimo_movimiento := now();
  END IF;
  IF NEW.estado = 'HECHO' AND OLD.estado <> 'HECHO' THEN
    NEW.cerrado_en := now();
  ELSIF NEW.estado <> 'HECHO' THEN
    NEW.cerrado_en := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tickets_movimiento ON tickets;
CREATE TRIGGER trg_tickets_movimiento
  BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION tickets_movimiento();

-- ---------------------------------------------------------------------
-- Espacios: a qué espacio pertenece cada fila
-- ---------------------------------------------------------------------
-- Un lead sin espacio_id va al espacio del primer admin (o al "principal"
-- migrado). Es lo que llega del formulario de la raíz (/), que no es de ningún
-- desarrollador; el de cada uno está en /f/<slug> y n8n le resuelve el espacio
-- por la dirección. TRANSITORIO: se revisa cuando el rediseño decida qué es la
-- raíz. SECURITY DEFINER porque n8n_writer no lee profiles.
CREATE OR REPLACE FUNCTION public.leads_espacio_por_defecto() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.espacio_id IS NULL THEN
    SELECT e.id INTO NEW.espacio_id
    FROM espacios e
    LEFT JOIN profiles p ON p.id = e.dueno_id
    WHERE p.role = 'admin' OR e.slug = 'principal'
    ORDER BY (p.role = 'admin') DESC NULLS LAST, e.creado_en
    LIMIT 1;

    IF NEW.espacio_id IS NULL THEN
      RAISE EXCEPTION 'No hay ningún espacio al que asignar el lead %', NEW.lead_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leads_espacio ON leads;
CREATE TRIGGER trg_leads_espacio
  BEFORE INSERT ON leads
  FOR EACH ROW EXECUTE FUNCTION public.leads_espacio_por_defecto();

-- Lo que cuelga de un lead es del espacio del lead, siempre: nadie lo fija a
-- mano, ni n8n ni el tablero. Así una factura no puede quedar en un espacio
-- distinto del de su pedido, y un ticket que apunta al lead de otro espacio
-- queda en ESE espacio y la política del tablero lo rechaza.
-- Un ticket sin lead, creado desde el tablero, va al espacio de quien lo crea.
-- SECURITY DEFINER: tiene que ver el lead aunque la RLS se lo oculte a quien
-- inserta; si no, un lead ajeno pasaría por "sin lead".
CREATE OR REPLACE FUNCTION public.espacio_desde_lead() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  del_lead uuid;
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    SELECT espacio_id INTO del_lead FROM leads WHERE lead_id = NEW.lead_id;
    IF del_lead IS NOT NULL THEN
      NEW.espacio_id := del_lead;
    END IF;
  END IF;

  IF NEW.espacio_id IS NULL AND TG_TABLE_NAME = 'tickets' THEN
    SELECT id INTO NEW.espacio_id FROM espacios WHERE dueno_id = auth.uid();
    -- Sin sesión (n8n): mismo criterio transitorio que los leads.
    IF NEW.espacio_id IS NULL THEN
      SELECT e.id INTO NEW.espacio_id
      FROM espacios e
      LEFT JOIN profiles p ON p.id = e.dueno_id
      WHERE p.role = 'admin' OR e.slug = 'principal'
      ORDER BY (p.role = 'admin') DESC NULLS LAST, e.creado_en
      LIMIT 1;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_facturas_espacio ON facturas;
CREATE TRIGGER trg_facturas_espacio
  BEFORE INSERT OR UPDATE ON facturas
  FOR EACH ROW EXECUTE FUNCTION public.espacio_desde_lead();
DROP TRIGGER IF EXISTS trg_seguimientos_espacio ON seguimientos;
CREATE TRIGGER trg_seguimientos_espacio
  BEFORE INSERT OR UPDATE ON seguimientos
  FOR EACH ROW EXECUTE FUNCTION public.espacio_desde_lead();
DROP TRIGGER IF EXISTS trg_logs_espacio ON logs;
CREATE TRIGGER trg_logs_espacio
  BEFORE INSERT OR UPDATE ON logs
  FOR EACH ROW EXECUTE FUNCTION public.espacio_desde_lead();
DROP TRIGGER IF EXISTS trg_tickets_espacio ON tickets;
CREATE TRIGGER trg_tickets_espacio
  BEFORE INSERT OR UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION public.espacio_desde_lead();

-- Un lead que cambia de espacio se lleva lo suyo. Hoy nada lo mueve; lo va a
-- hacer la bolsa de proyectos (etapa 5), cuando otro desarrollador tome un
-- pedido. Alcanza con "tocar" las filas: el trigger de arriba las recalcula.
CREATE OR REPLACE FUNCTION public.leads_propagar_espacio() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE facturas     SET espacio_id = NEW.espacio_id WHERE lead_id = NEW.lead_id;
  UPDATE seguimientos SET espacio_id = NEW.espacio_id WHERE lead_id = NEW.lead_id;
  UPDATE tickets      SET espacio_id = NEW.espacio_id WHERE lead_id = NEW.lead_id;
  UPDATE logs         SET espacio_id = NEW.espacio_id WHERE lead_id = NEW.lead_id;
  UPDATE avisos       SET espacio_id = NEW.espacio_id WHERE lead_id = NEW.lead_id;
  RETURN NULL;
END;
$$;

-- El alta queda completa la primera vez que el dueño cambia el nombre o la
-- dirección. Por trigger y no con una columna editable, para que nadie la
-- marque sin haber elegido nada.
CREATE OR REPLACE FUNCTION public.espacios_configurado() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.configurado_en := OLD.configurado_en;
  IF NEW.configurado_en IS NULL
     AND (NEW.nombre IS DISTINCT FROM OLD.nombre OR NEW.slug IS DISTINCT FROM OLD.slug) THEN
    NEW.configurado_en := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_espacios_configurado ON espacios;
CREATE TRIGGER trg_espacios_configurado
  BEFORE UPDATE ON espacios
  FOR EACH ROW EXECUTE FUNCTION public.espacios_configurado();

-- Lo que el formulario público necesita saber de un espacio para mostrarse:
-- su nombre, a partir de la dirección. `anon` no lee la tabla, así que pasa
-- por acá y no ve ninguna otra columna (ni el dueño, ni nada que venga).
CREATE OR REPLACE FUNCTION public.espacio_publico(p_slug text)
RETURNS TABLE (slug text, nombre text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.slug, e.nombre FROM espacios e WHERE e.slug = lower(p_slug)
$$;
REVOKE ALL ON FUNCTION public.espacio_publico(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.espacio_publico(text) TO anon, authenticated;

-- Vinculación de Telegram. El panel pide un código (vale 30 minutos) y el
-- desarrollador se lo manda al bot; n8n lo canjea por el chat. El código no
-- sirve para nada más: sólo dice a qué espacio va ese chat.
CREATE OR REPLACE FUNCTION public.generar_codigo_telegram() RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  codigo text := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
BEGIN
  UPDATE espacios SET telegram_codigo = codigo, telegram_codigo_vence = now() + interval '30 minutes'
  WHERE dueno_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'La cuenta no tiene un espacio'; END IF;
  RETURN codigo;
END;
$$;

CREATE OR REPLACE FUNCTION public.desvincular_telegram() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE espacios SET telegram_chat_id = NULL, telegram_codigo = NULL, telegram_codigo_vence = NULL
  WHERE dueno_id = auth.uid();
$$;

-- La usa n8n cuando el bot recibe "/start <código>". Devuelve el nombre del
-- espacio vinculado, o nada si el código no existe o venció.
CREATE OR REPLACE FUNCTION public.vincular_telegram(p_codigo text, p_chat_id text)
RETURNS TABLE (nombre text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE espacios SET telegram_chat_id = p_chat_id, telegram_codigo = NULL, telegram_codigo_vence = NULL
  WHERE telegram_codigo = upper(btrim(p_codigo)) AND telegram_codigo_vence > now()
  RETURNING espacios.nombre;
$$;

REVOKE ALL ON FUNCTION public.generar_codigo_telegram() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.desvincular_telegram() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.vincular_telegram(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generar_codigo_telegram() TO authenticated;
GRANT EXECUTE ON FUNCTION public.desvincular_telegram() TO authenticated;
GRANT EXECUTE ON FUNCTION public.vincular_telegram(text, text) TO n8n_writer;

DROP TRIGGER IF EXISTS trg_leads_propagar_espacio ON leads;
CREATE TRIGGER trg_leads_propagar_espacio
  AFTER UPDATE OF espacio_id ON leads
  FOR EACH ROW
  WHEN (OLD.espacio_id IS DISTINCT FROM NEW.espacio_id)
  EXECUTE FUNCTION public.leads_propagar_espacio();

-- ---------------------------------------------------------------------
-- Trigger: crea el perfil (rol 'user' por defecto) al registrarse.
-- Se promueve a 'admin' si el email está en `admin_emails` (whitelist
-- editable con un INSERT/DELETE puntual, sin tocar este archivo) Y ya está
-- confirmado. Un email NULL (registro solo-teléfono) nunca matchea la
-- whitelist: NULL = NULL no es true en SQL, así que cae a 'user' sin caso
-- especial.
-- La confirmación importa: el INSERT en auth.users ocurre al registrarse,
-- antes de que nadie pruebe ser dueño de la casilla. Si el rol se asignara
-- acá sin mirarla, alcanzaría con desactivar "Confirm email" en Supabase
-- (o con un registro que quedara a medio confirmar) para que cualquiera que
-- escribiera la dirección de la whitelist obtuviera una fila 'admin'. Con
-- "Confirm email" desactivado, Supabase ya trae `email_confirmed_at` en el
-- INSERT, así que ese caso se resuelve acá mismo; si no, lo resuelve
-- handle_user_confirmed() al confirmarse.
-- `SECURITY DEFINER` es necesario porque el usuario recién registrado
-- todavía no tiene fila en `profiles` desde la que autorizarse solo.
-- ---------------------------------------------------------------------
-- Cada cuenta confirmada tiene su espacio (registro abierto, 23-sep-2026). Se
-- crea con un slug provisorio derivado del id, que es único, y el nombre sale
-- de la casilla; el desarrollador los cambia al completar su alta (etapa 2).
-- ON CONFLICT: una cuenta que ya tiene espacio (por ejemplo, el admin al que
-- la migración le dio el "principal") no recibe otro.
-- Las cuentas de cliente no tienen espacio: no reciben pedidos.
CREATE OR REPLACE FUNCTION public.crear_espacio_propio(uid uuid, correo text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO espacios (slug, nombre, dueno_id, email_contacto)
  SELECT 'e-' || replace(uid::text, '-', ''),
         coalesce(nullif(left(split_part(correo, '@', 1), 80), ''), 'Mi espacio'),
         uid, correo
  WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = uid AND p.tipo = 'cliente')
  ON CONFLICT DO NOTHING;
$$;
REVOKE ALL ON FUNCTION public.crear_espacio_propio(uuid, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role, tipo)
  VALUES (
    NEW.id,
    NEW.email,
    CASE WHEN NEW.email_confirmed_at IS NOT NULL
          AND EXISTS (SELECT 1 FROM public.admin_emails WHERE email = NEW.email)
      THEN 'admin' ELSE 'user' END,
    -- La página de clientes pide {tipo: 'cliente'} en los metadatos. Cualquier
    -- otra cosa (o nada, como /register) es una cuenta de desarrollador.
    CASE WHEN NEW.raw_user_meta_data ->> 'tipo' = 'cliente' THEN 'cliente' ELSE 'desarrollador' END
  )
  ON CONFLICT (id) DO NOTHING;

  IF NEW.email_confirmed_at IS NOT NULL THEN
    PERFORM public.crear_espacio_propio(NEW.id, NEW.email);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Promoción al confirmar el email por primera vez. Sólo en esa transición
-- (NULL → fecha): un admin bajado de rol a mano no vuelve a subir solo por
-- un evento posterior de su cuenta.
CREATE OR REPLACE FUNCTION public.handle_user_confirmed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.profiles SET role = 'admin'
  WHERE id = NEW.id
    AND role = 'user'
    AND EXISTS (SELECT 1 FROM public.admin_emails WHERE email = NEW.email);

  PERFORM public.crear_espacio_propio(NEW.id, NEW.email);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_confirmed ON auth.users;
CREATE TRIGGER on_auth_user_confirmed
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW
  WHEN (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
  EXECUTE FUNCTION public.handle_user_confirmed();

-- Backfill: cuentas ya existentes (creadas antes de este trigger) también
-- necesitan su fila en `profiles`. Idempotente vía ON CONFLICT: una fila que
-- ya existe (por ejemplo porque un admin real bajó de rol a mano) no se
-- vuelve a tocar acá, así que re-aplicar el schema nunca re-promueve a nadie.
INSERT INTO public.profiles (id, email, role)
SELECT id, email, CASE WHEN email_confirmed_at IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.admin_emails a WHERE a.email = auth.users.email)
  THEN 'admin' ELSE 'user' END
FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- Backfill de espacios: cuentas confirmadas antes de que existieran.
DO $$ BEGIN
  PERFORM public.crear_espacio_propio(u.id, u.email)
  FROM auth.users u
  WHERE u.email_confirmed_at IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM espacios e WHERE e.dueno_id = u.id);
END $$;

-- ---------------------------------------------------------------------
-- Vistas (con security_invoker: respetan la RLS de las tablas base)
-- ---------------------------------------------------------------------
-- Se dropean antes de recrearlas porque `CREATE OR REPLACE VIEW` sólo admite
-- agregar columnas AL FINAL: si cambia el nombre, el tipo o el orden de una
-- columna existente, Postgres aborta con «cannot change name of view column».
-- Eso es exactamente lo que pasa al actualizar una base creada antes de las
-- columnas de MercadoPago, que es el caso de uso que este script promete
-- soportar. Sin el DROP, re-ejecutarlo sobre una base vieja falla.
-- Son vistas sin estado: dropearlas no toca ningún dato.
DROP VIEW IF EXISTS metrics_mensuales;
DROP VIEW IF EXISTS facturas_pendientes;
DROP VIEW IF EXISTS tickets_tablero;

CREATE OR REPLACE VIEW metrics_mensuales
  WITH (security_invoker = true) AS
WITH lead_mes AS (
  SELECT
    espacio_id,
    to_char(date_trunc('month', fecha_ingreso), 'YYYY-MM')              AS mes,
    count(*)                                                            AS total_leads,
    count(*) FILTER (WHERE tier = 'HOT')                               AS leads_hot,
    count(*) FILTER (WHERE tier = 'WARM')                              AS leads_warm,
    count(*) FILTER (WHERE estado = 'CERRADO')                         AS leads_cerrados,
    count(*) FILTER (WHERE estado = 'PERDIDO')                         AS leads_perdidos,
    round(100.0 * count(*) FILTER (WHERE estado = 'CERRADO')
                 / NULLIF(count(*), 0), 1)                             AS conversion_pct,
    round(avg(dias_ciclo_completo) FILTER (WHERE estado = 'CERRADO'), 1) AS tiempo_prom_dias
  FROM leads
  GROUP BY 1, 2
),
fact_mes AS (
  SELECT
    espacio_id,
    to_char(date_trunc('month', fecha_emision), 'YYYY-MM')             AS mes,
    -- Una factura ANULADA no es facturación: no suma al total, ni a lo
    -- pendiente, ni al denominador de la tasa de cobro. Hasta el 23-sep-2026
    -- sí sumaba (pendiente era `estado_pago <> 'COBRADO'`), así que anular una
    -- factura no movía el pendiente del tablero y bajaba la tasa de cobro.
    coalesce(sum(monto) FILTER (WHERE estado_pago <> 'ANULADA'), 0)    AS facturacion,
    coalesce(sum(monto) FILTER (WHERE estado_pago = 'COBRADO'), 0)     AS cobrado,
    coalesce(sum(monto) FILTER (WHERE estado_pago IN ('PENDIENTE','VENCIDA')), 0) AS pendiente,
    -- Hasta el 01-sep-2026 esto se inferia contando PENDIENTE + fecha_vencimiento
    -- < now(), porque ningun nodo escribia la transicion VENCIDA (limitacion
    -- declarada en §4.8 y en el punto 7 del Capitulo 8). Con "🟠 Cron -
    -- Recordatorios Pago 10AM" marcando VENCIDA a las facturas PENDIENTE que
    -- superan FACTURA_VENCIDA_DIAS_GRACIA dias de atraso (workflow/crm_postgres.json),
    -- el indicador de la Tabla 8 pasa a contar el estado real en vez de inferirlo:
    -- una factura ANULADA (tambien nueva) no debe sumar acá, y con la inferencia
    -- vieja sí lo habria hecho mientras siguiera con fecha_vencimiento pasada.
    count(*) FILTER (WHERE estado_pago = 'VENCIDA')                    AS facturas_vencidas,
    round(100.0 * coalesce(sum(monto) FILTER (WHERE estado_pago = 'COBRADO'), 0)
                 / NULLIF(sum(monto) FILTER (WHERE estado_pago <> 'ANULADA'), 0), 1) AS tasa_cobro_pct,
    -- Comisión de la plataforma (MP_COMISION_PORCENTAJE) realizada sobre lo
    -- efectivamente cobrado. Es contable: MercadoPago no la separa sola.
    coalesce(sum(comision_plataforma) FILTER (WHERE estado_pago = 'COBRADO'), 0) AS comision_cobrada,
    -- Parte de `cobrado` que sólo se dio por cobrada al cerrar el proyecto,
    -- sin un pago registrado por el sistema.
    coalesce(sum(monto) FILTER (WHERE estado_pago = 'COBRADO' AND metodo_cobro = 'CIERRE_MANUAL'), 0) AS cobrado_cierre_manual
  FROM facturas
  GROUP BY 1, 2
)
SELECT
  coalesce(l.mes, f.mes)            AS mes,
  coalesce(l.total_leads, 0)        AS total_leads,
  coalesce(l.leads_hot, 0)          AS leads_hot,
  coalesce(l.leads_warm, 0)         AS leads_warm,
  coalesce(l.leads_cerrados, 0)     AS leads_cerrados,
  coalesce(l.leads_perdidos, 0)     AS leads_perdidos,
  coalesce(l.conversion_pct, 0)     AS conversion_pct,
  coalesce(l.tiempo_prom_dias, 0)   AS tiempo_prom_dias,
  coalesce(f.facturacion, 0)        AS facturacion,
  coalesce(f.cobrado, 0)            AS cobrado,
  coalesce(f.pendiente, 0)          AS pendiente,
  coalesce(f.facturas_vencidas, 0)  AS facturas_vencidas,
  coalesce(f.tasa_cobro_pct, 0)     AS tasa_cobro_pct,
  coalesce(f.comision_cobrada, 0)   AS comision_cobrada,
  coalesce(f.cobrado_cierre_manual, 0) AS cobrado_cierre_manual,
  -- Por espacio (23-sep-2026): el panel ve sólo las filas de su espacio (RLS)
  -- y n8n arma un reporte por desarrollador.
  coalesce(l.espacio_id, f.espacio_id) AS espacio_id
FROM lead_mes l
FULL OUTER JOIN fact_mes f ON l.mes = f.mes AND l.espacio_id = f.espacio_id
ORDER BY mes DESC;

-- Sigue filtrando sólo PENDIENTE a propósito (01-sep-2026): es la que alimenta
-- los recordatorios de cobro (RAMA 4) y la sección IV del tablero. Una factura
-- que ya pasó a VENCIDA (más de FACTURA_VENCIDA_DIAS_GRACIA días de atraso) o a
-- ANULADA sale de esta lista sin que haga falta agregar un WHERE: ambos son
-- estados distintos de PENDIENTE. El conteo de vencidas para la Tabla 8 vive en
-- `metrics_mensuales.facturas_vencidas`, no acá.
-- `espacio_nombre` y `espacio_email`: el recordatorio de cobro sale con la
-- marca del desarrollador y las respuestas le llegan a él.
CREATE OR REPLACE VIEW facturas_pendientes
  WITH (security_invoker = true) AS
SELECT
  f.*,
  (f.fecha_vencimiento::date - now()::date) AS dias_al_vencimiento,
  e.nombre         AS espacio_nombre,
  e.email_contacto AS espacio_email
FROM facturas f
LEFT JOIN espacios e ON e.id = f.espacio_id
WHERE f.estado_pago = 'PENDIENTE';

-- Lo que pinta el tablero: el ticket, el cliente del proyecto y los números
-- del envejecimiento calculados al momento (nada de esto se guarda, así no
-- hay un score viejo esperando al cron).
CREATE OR REPLACE VIEW tickets_tablero
  WITH (security_invoker = true) AS
SELECT
  t.*,
  l.nombre                                               AS cliente,
  (now()::date - t.creado_en::date)                      AS dias_abierto,
  (now()::date - t.ultimo_movimiento::date)              AS dias_quieto,
  CASE WHEN t.estado = 'HECHO' THEN 0
       ELSE least(100, ticket_peso(t.prioridad) + 2 * (now()::date - t.creado_en::date))
  END                                                    AS score,
  CASE WHEN t.estado = 'HECHO' OR t.prioridad = 'CRITICA' THEN NULL
       ELSE greatest(0, ticket_dias_escalada(t.prioridad) - (now()::date - t.ultimo_movimiento::date))
  END                                                    AS dias_para_escalar
FROM tickets t
LEFT JOIN leads l USING (lead_id);

-- =====================================================================
-- Seguridad a nivel de fila (RLS) — RNF1, RNF2, §4.6, Anexo C
-- =====================================================================

-- 1) Habilitar RLS en todas las tablas de negocio. Con RLS activa y sin
--    política aplicable, el acceso queda denegado por defecto.
ALTER TABLE leads           ENABLE ROW LEVEL SECURITY;
ALTER TABLE facturas        ENABLE ROW LEVEL SECURITY;
ALTER TABLE seguimientos    ENABLE ROW LEVEL SECURITY;
ALTER TABLE logs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_log  ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_cuotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_emails    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets         ENABLE ROW LEVEL SECURITY;
ALTER TABLE espacios        ENABLE ROW LEVEL SECURITY;
ALTER TABLE avisos          ENABLE ROW LEVEL SECURITY;

-- 1.1) FORCE: sin esto, el OWNER de la tabla evade la RLS igual que si
--      tuviera BYPASSRLS (una tarea de backup o una migración conectada con
--      el rol dueño de las tablas, no con service_role, se saltearía todas
--      las políticas). No afecta a `service_role`: ese ya tiene BYPASSRLS
--      explícito, que manda por sobre FORCE.
ALTER TABLE leads           FORCE ROW LEVEL SECURITY;
ALTER TABLE facturas        FORCE ROW LEVEL SECURITY;
ALTER TABLE seguimientos    FORCE ROW LEVEL SECURITY;
ALTER TABLE logs            FORCE ROW LEVEL SECURITY;
ALTER TABLE profiles        FORCE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_log  FORCE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_cuotas FORCE ROW LEVEL SECURITY;
ALTER TABLE admin_emails    FORCE ROW LEVEL SECURITY;
ALTER TABLE tickets         FORCE ROW LEVEL SECURITY;
ALTER TABLE espacios        FORCE ROW LEVEL SECURITY;
ALTER TABLE avisos          FORCE ROW LEVEL SECURITY;

-- 2) Políticas de LECTURA sobre las tablas que alimentan el tablero.
--    Cada desarrollador ve sólo lo de su espacio (23-sep-2026). Hasta
--    entonces se exigía `profiles.role = 'admin'` y el admin veía todo: con
--    la plataforma compartida, `role` pasó a ser sólo del administrador de
--    la plataforma y ya no da acceso a los datos de nadie.
--    La subconsulta sobre `espacios` pasa por su propia política (cada uno
--    lee su fila), así que no hace falta una función SECURITY DEFINER.
--    `(SELECT auth.uid())` y no `auth.uid()` suelto: así Postgres la evalúa
--    una vez por consulta y no una vez por fila.
--    No se crean políticas de escritura: la escritura la hace n8n.
DROP POLICY IF EXISTS espacios_select_dueno ON espacios;
CREATE POLICY espacios_select_dueno ON espacios
  FOR SELECT TO authenticated USING (dueno_id = (SELECT auth.uid()));

-- El dueño elige el nombre y la dirección de su espacio (alta, etapa 2). El
-- GRANT es por columna: no puede tocar ni el dueño ni `configurado_en`. La
-- dirección la validan el CHECK del formato y el UNIQUE.
DROP POLICY IF EXISTS espacios_update_dueno ON espacios;
CREATE POLICY espacios_update_dueno ON espacios
  FOR UPDATE TO authenticated
  USING (dueno_id = (SELECT auth.uid()))
  WITH CHECK (dueno_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS leads_select_authenticated ON leads;
CREATE POLICY leads_select_authenticated ON leads
  FOR SELECT TO authenticated
  USING (espacio_id IN (SELECT id FROM espacios WHERE dueno_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS facturas_select_authenticated ON facturas;
CREATE POLICY facturas_select_authenticated ON facturas
  FOR SELECT TO authenticated
  USING (espacio_id IN (SELECT id FROM espacios WHERE dueno_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS seguimientos_select_authenticated ON seguimientos;
CREATE POLICY seguimientos_select_authenticated ON seguimientos
  FOR SELECT TO authenticated
  USING (espacio_id IN (SELECT id FROM espacios WHERE dueno_id = (SELECT auth.uid())));

-- 2.1) `profiles`: cada usuario solo puede leer su propia fila (para que
--      el frontend sepa si mostrar el link al dashboard). Nadie puede
--      escribir su propio rol: solo la service_role o el trigger
--      (SECURITY DEFINER) tocan esta tabla.
DROP POLICY IF EXISTS profiles_select_own ON profiles;
CREATE POLICY profiles_select_own ON profiles
  FOR SELECT TO authenticated USING (id = auth.uid());

-- 3) `logs` (auditoría/errores) no tiene ninguna política para
--    `authenticated`: `service_role` (que evade la RLS) y `n8n_writer`
--    (por las políticas `logs_{select,insert,update}_n8n_writer` de la
--    sección 5.1) pueden escribir y consultar, pero `authenticated` y
--    `anon` no acceden. Es intencional: la auditoría no se expone al
--    tablero. `admin_emails` tampoco tiene política: solo la lee la función
--    SECURITY DEFINER handle_new_user() y se administra a mano vía
--    service_role.

-- 4) Privilegios de tabla (GRANT). La RLS filtra filas, pero el rol
--    igual necesita el privilegio SELECT sobre el objeto.
GRANT SELECT ON leads, facturas, seguimientos, profiles, espacios TO authenticated;
GRANT UPDATE (nombre, slug, email_contacto) ON espacios TO authenticated;

-- Avisos: cada desarrollador lee los de su espacio y los marca como leídos
-- (sólo esa columna). Los de la plataforma (espacio_id NULL) no los ve nadie
-- desde el panel.
DROP POLICY IF EXISTS avisos_select_espacio ON avisos;
CREATE POLICY avisos_select_espacio ON avisos
  FOR SELECT TO authenticated
  USING (espacio_id IN (SELECT id FROM espacios WHERE dueno_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS avisos_update_espacio ON avisos;
CREATE POLICY avisos_update_espacio ON avisos
  FOR UPDATE TO authenticated
  USING (espacio_id IN (SELECT id FROM espacios WHERE dueno_id = (SELECT auth.uid())))
  WITH CHECK (espacio_id IN (SELECT id FROM espacios WHERE dueno_id = (SELECT auth.uid())));
GRANT SELECT ON avisos TO authenticated;
GRANT UPDATE (leido_en) ON avisos TO authenticated;

-- 4.1) Tickets: a diferencia del resto, el tablero SÍ escribe (crear y mover
--      tickets desde /api/tickets, con la sesión del desarrollador), siempre
--      dentro de su espacio. Sin DELETE. El WITH CHECK es lo que impide
--      llevarse un ticket a otro espacio o colgarlo del lead de otro: el
--      trigger trg_tickets_espacio le pone el espacio de ese lead.
--      Hasta el 23-sep-2026 se llamaban tickets_*_admin y exigían el rol admin.
DROP POLICY IF EXISTS tickets_select_admin ON tickets;
DROP POLICY IF EXISTS tickets_select_espacio ON tickets;
CREATE POLICY tickets_select_espacio ON tickets
  FOR SELECT TO authenticated
  USING (espacio_id IN (SELECT id FROM espacios WHERE dueno_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS tickets_insert_admin ON tickets;
DROP POLICY IF EXISTS tickets_insert_espacio ON tickets;
CREATE POLICY tickets_insert_espacio ON tickets
  FOR INSERT TO authenticated
  WITH CHECK (espacio_id IN (SELECT id FROM espacios WHERE dueno_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS tickets_update_admin ON tickets;
DROP POLICY IF EXISTS tickets_update_espacio ON tickets;
CREATE POLICY tickets_update_espacio ON tickets
  FOR UPDATE TO authenticated
  USING (espacio_id IN (SELECT id FROM espacios WHERE dueno_id = (SELECT auth.uid())))
  WITH CHECK (espacio_id IN (SELECT id FROM espacios WHERE dueno_id = (SELECT auth.uid())));
GRANT SELECT, INSERT, UPDATE ON tickets TO authenticated;
GRANT SELECT ON tickets_tablero TO authenticated;
GRANT SELECT ON metrics_mensuales, facturas_pendientes TO authenticated;

-- 5) `service_role` se conserva para acceso administrativo (SQL editor,
--    tareas puntuales) y como red de contención, pero deja de ser la
--    credencial de la conexión de n8n (véase 5.1). En Supabase este rol ya
--    trae privilegios plenos; en un PostgreSQL vanilla (p. ej. el
--    autoalojado del docker-compose) NO, y BYPASSRLS solo evade la RLS, no
--    otorga el privilegio de tabla. Se conceden explícitamente para que
--    funcione en ambos entornos.
GRANT SELECT, INSERT, UPDATE, DELETE ON leads, facturas, seguimientos, logs, profiles, rate_limit_log, rate_limit_cuotas, admin_emails, tickets, espacios, avisos TO service_role;
GRANT SELECT ON tickets_tablero TO service_role;
GRANT SELECT ON metrics_mensuales, facturas_pendientes TO service_role;

-- Nota: la `service_role` posee además BYPASSRLS, por lo que sus escrituras
-- no quedan sujetas a las políticas de fila.

-- 5.1) Rol acotado para la conexión de n8n (cierra S4 de la Tabla 11).
--    `service_role` evade la RLS por completo y, en un proyecto de Supabase
--    real, alcanza más que las cinco tablas de este esquema: si esa
--    credencial se filtra —ya ocurrió una vez, incidente S7, véase §6.3—,
--    el radio de daño es el de un superusuario de facto. `n8n_writer` es el
--    rol que debe usar la credencial Postgres del nodo homónimo de n8n en
--    su lugar: sin BYPASSRLS, sin acceso a `profiles` ni al esquema `auth`,
--    y sin DELETE, porque ningún nodo del flujo borra filas (verificado
--    contra los 38 nodos Postgres del flujo exportado (01-sep-2026),
--    workflow/crm_postgres.json, y con evidencia ejecutable en
--    tests/rls/casos.sql y tests/idempotencia.mjs).
DO $$ BEGIN CREATE ROLE n8n_writer NOLOGIN;
EXCEPTION WHEN duplicate_object THEN null; END $$;

GRANT USAGE ON SCHEMA public TO n8n_writer;
GRANT SELECT, INSERT, UPDATE ON leads, facturas, seguimientos, logs TO n8n_writer;
-- `rate_limit_log` es sólo de lectura+escritura de una fila por invocación
-- (registrar el intento y contar los recientes): nunca se actualiza una fila
-- ya escrita, así que no lleva UPDATE.
GRANT SELECT, INSERT ON rate_limit_log TO n8n_writer;
GRANT SELECT, INSERT, UPDATE ON rate_limit_cuotas TO n8n_writer;
DROP POLICY IF EXISTS rate_limit_cuotas_select_n8n_writer ON rate_limit_cuotas;
CREATE POLICY rate_limit_cuotas_select_n8n_writer ON rate_limit_cuotas FOR SELECT TO n8n_writer USING (true);
DROP POLICY IF EXISTS rate_limit_cuotas_insert_n8n_writer ON rate_limit_cuotas;
CREATE POLICY rate_limit_cuotas_insert_n8n_writer ON rate_limit_cuotas FOR INSERT TO n8n_writer WITH CHECK (true);
DROP POLICY IF EXISTS rate_limit_cuotas_update_n8n_writer ON rate_limit_cuotas;
CREATE POLICY rate_limit_cuotas_update_n8n_writer ON rate_limit_cuotas FOR UPDATE TO n8n_writer USING (true) WITH CHECK (true);
GRANT SELECT ON metrics_mensuales, facturas_pendientes TO n8n_writer;
REVOKE ALL ON profiles FROM n8n_writer;
REVOKE ALL ON admin_emails FROM n8n_writer;
-- `espacios`: n8n la lee para saber a qué espacio va un pedido del formulario
-- (por la dirección, /f/<slug>) y con qué marca y Reply-To escribirle al
-- cliente. Sólo esas columnas; el dueño no lo necesita.
REVOKE ALL ON espacios FROM n8n_writer;
GRANT SELECT (id, slug, nombre, email_contacto, telegram_chat_id, stripe_account_id, stripe_cobros_activos) ON espacios TO n8n_writer;
-- Cobros: n8n guarda la cuenta de Stripe que crea para el espacio y si ya
-- puede cobrar. Nada más de la fila.
GRANT UPDATE (stripe_account_id, stripe_cobros_activos) ON espacios TO n8n_writer;
DROP POLICY IF EXISTS espacios_update_n8n_writer ON espacios;
CREATE POLICY espacios_update_n8n_writer ON espacios
  FOR UPDATE TO n8n_writer USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS espacios_select_n8n_writer ON espacios;
CREATE POLICY espacios_select_n8n_writer ON espacios
  FOR SELECT TO n8n_writer USING (true);

-- Avisos: n8n los registra (subflujo workflow/avisos.json). Sin UPDATE: el
-- único cambio posterior es "leído", y lo hace el desarrollador.
GRANT SELECT, INSERT ON avisos TO n8n_writer;
DROP POLICY IF EXISTS avisos_select_n8n_writer ON avisos;
CREATE POLICY avisos_select_n8n_writer ON avisos FOR SELECT TO n8n_writer USING (true);
DROP POLICY IF EXISTS avisos_insert_n8n_writer ON avisos;
CREATE POLICY avisos_insert_n8n_writer ON avisos FOR INSERT TO n8n_writer WITH CHECK (true);

-- Políticas de escritura de `n8n_writer`. No filtran filas (USING/WITH CHECK
-- en true): a diferencia de las políticas de `authenticated`, el límite de
-- este rol no es «qué fila» sino «qué tabla y qué operación», y eso ya lo
-- resuelve el GRANT de arriba. Sin estas políticas, con RLS habilitada y sin
-- BYPASSRLS, el rol no podría hacer nada aunque tuviera el GRANT: la RLS
-- deniega por omisión toda operación sin una política permisiva.
--
-- Una política por comando (no `FOR ALL`) a propósito: `FOR ALL` alcanza
-- también a DELETE a nivel de RLS, así que un GRANT DELETE futuro por error
-- quedaría habilitado en silencio por esta política preexistente. Separando
-- por comando, agregar DELETE requeriría además una policy nueva explícita.
DROP POLICY IF EXISTS leads_rw_n8n_writer ON leads;
DROP POLICY IF EXISTS leads_select_n8n_writer ON leads;
CREATE POLICY leads_select_n8n_writer ON leads
  FOR SELECT TO n8n_writer USING (true);
DROP POLICY IF EXISTS leads_insert_n8n_writer ON leads;
CREATE POLICY leads_insert_n8n_writer ON leads
  FOR INSERT TO n8n_writer WITH CHECK (true);
DROP POLICY IF EXISTS leads_update_n8n_writer ON leads;
CREATE POLICY leads_update_n8n_writer ON leads
  FOR UPDATE TO n8n_writer USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS facturas_rw_n8n_writer ON facturas;
DROP POLICY IF EXISTS facturas_select_n8n_writer ON facturas;
CREATE POLICY facturas_select_n8n_writer ON facturas
  FOR SELECT TO n8n_writer USING (true);
DROP POLICY IF EXISTS facturas_insert_n8n_writer ON facturas;
CREATE POLICY facturas_insert_n8n_writer ON facturas
  FOR INSERT TO n8n_writer WITH CHECK (true);
DROP POLICY IF EXISTS facturas_update_n8n_writer ON facturas;
CREATE POLICY facturas_update_n8n_writer ON facturas
  FOR UPDATE TO n8n_writer USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS seguimientos_rw_n8n_writer ON seguimientos;
DROP POLICY IF EXISTS seguimientos_select_n8n_writer ON seguimientos;
CREATE POLICY seguimientos_select_n8n_writer ON seguimientos
  FOR SELECT TO n8n_writer USING (true);
DROP POLICY IF EXISTS seguimientos_insert_n8n_writer ON seguimientos;
CREATE POLICY seguimientos_insert_n8n_writer ON seguimientos
  FOR INSERT TO n8n_writer WITH CHECK (true);
DROP POLICY IF EXISTS seguimientos_update_n8n_writer ON seguimientos;
CREATE POLICY seguimientos_update_n8n_writer ON seguimientos
  FOR UPDATE TO n8n_writer USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS logs_rw_n8n_writer ON logs;
DROP POLICY IF EXISTS logs_select_n8n_writer ON logs;
CREATE POLICY logs_select_n8n_writer ON logs
  FOR SELECT TO n8n_writer USING (true);
DROP POLICY IF EXISTS logs_insert_n8n_writer ON logs;
CREATE POLICY logs_insert_n8n_writer ON logs
  FOR INSERT TO n8n_writer WITH CHECK (true);
DROP POLICY IF EXISTS logs_update_n8n_writer ON logs;
CREATE POLICY logs_update_n8n_writer ON logs
  FOR UPDATE TO n8n_writer USING (true) WITH CHECK (true);

-- Sin policy de UPDATE: coincide con el GRANT de más arriba (SELECT, INSERT
-- nomás) — nunca se actualiza una fila de rate_limit_log ya escrita.
DROP POLICY IF EXISTS rate_limit_log_rw_n8n_writer ON rate_limit_log;
DROP POLICY IF EXISTS rate_limit_log_select_n8n_writer ON rate_limit_log;
CREATE POLICY rate_limit_log_select_n8n_writer ON rate_limit_log
  FOR SELECT TO n8n_writer USING (true);
DROP POLICY IF EXISTS rate_limit_log_insert_n8n_writer ON rate_limit_log;
CREATE POLICY rate_limit_log_insert_n8n_writer ON rate_limit_log
  FOR INSERT TO n8n_writer WITH CHECK (true);

-- Tickets: el CRM siembra los del proyecto al aceptarse una propuesta y el
-- cron de envejecimiento los escala. Sin DELETE, como el resto.
GRANT SELECT, INSERT, UPDATE ON tickets TO n8n_writer;
GRANT SELECT ON tickets_tablero TO n8n_writer;
DROP POLICY IF EXISTS tickets_select_n8n_writer ON tickets;
CREATE POLICY tickets_select_n8n_writer ON tickets FOR SELECT TO n8n_writer USING (true);
DROP POLICY IF EXISTS tickets_insert_n8n_writer ON tickets;
CREATE POLICY tickets_insert_n8n_writer ON tickets FOR INSERT TO n8n_writer WITH CHECK (true);
DROP POLICY IF EXISTS tickets_update_n8n_writer ON tickets;
CREATE POLICY tickets_update_n8n_writer ON tickets FOR UPDATE TO n8n_writer USING (true) WITH CHECK (true);

-- Paso operativo pendiente, fuera del alcance de este script porque no debe
-- versionar contraseñas: en el proyecto de Supabase real, dar LOGIN y una
-- contraseña a `n8n_writer` (`ALTER ROLE n8n_writer WITH LOGIN PASSWORD
-- '<secreto generado>';`, guardada en un gestor de secretos y no en este
-- archivo) y reemplazar la credencial Postgres del nodo homónimo de n8n por
-- esa nueva conexión. Mientras ese paso no se haga, el esquema queda listo
-- pero la conexión real de n8n sigue usando `service_role`.

-- 6) El rol público (`anon`) no debe leer las tablas de negocio ni las
--    vistas. Se revoca explícitamente por si el default privilege de la
--    plataforma lo hubiera otorgado.
REVOKE ALL ON leads, facturas, seguimientos, logs, profiles, rate_limit_log, admin_emails, tickets, espacios, avisos FROM anon;
REVOKE ALL ON metrics_mensuales, facturas_pendientes, tickets_tablero FROM anon;

-- 7) Realtime: el tablero se suscribe a los cambios de `leads`
--    (postgres_changes, §4.2.5 / RNF6 / escenario E7) y, desde el
--    23-sep-2026, de `facturas`: el pago de MercadoPago, el cron que marca
--    VENCIDA y la anulación cambian la factura sin tocar su lead, y el
--    tablero no se enteraba hasta recargar. Se agregan las tablas a la
--    publicación de Supabase, de forma idempotente y sin romper en un
--    PostgreSQL vanilla donde esa publicación no exista. La RLS sigue
--    aplicando: cada desarrollador recibe sólo los eventos de su espacio.
DO $$
DECLARE
  t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH t IN ARRAY ARRAY['leads', 'facturas', 'tickets', 'avisos'] LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      END IF;
    END LOOP;
  END IF;
END $$;

-- =====================================================================
-- 8) Bolsa de proyectos (etapa 5, 24-sep-2026)
-- =====================================================================
-- Cuando un desarrollador no puede tomar un pedido, lo puede mandar a la
-- bolsa: otros desarrolladores de la plataforma se postulan y el cliente
-- elige a uno. El pedido se ve sin datos personales hasta la asignación.
--
-- Nadie del panel lee estas tablas directo: pasa por bolsa_abierta() y
-- postularme(), que devuelven y validan sólo lo que corresponde. Publicar,
-- asignar y vencer lo hace n8n (manda los correos).

-- Consentimiento del cliente para que, si el desarrollador elegido no puede
-- tomar el pedido, lo vean otros (ley 25.326: casilla aparte, opcional y sin
-- marcar de antemano, porque es un uso distinto del que motivó la consulta).
-- Sin él, el pedido no puede ir a la bolsa: lo exige trg_bolsa_publicar.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS compartir_bolsa BOOLEAN NOT NULL DEFAULT false;

DO $$ BEGIN CREATE TYPE bolsa_estado AS ENUM ('ABIERTO','EN_ELECCION','ASIGNADO','VENCIDO');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS bolsa_pedidos (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Un pedido va a la bolsa una sola vez.
  lead_id             TEXT UNIQUE NOT NULL REFERENCES leads(lead_id) ON DELETE RESTRICT,
  -- Quien lo rechazó: no se puede postular a su propio pedido.
  origen_espacio_id   UUID NOT NULL REFERENCES espacios(id),
  -- Lo escribe (o revisa) quien lo rechaza, sin datos personales: es lo único
  -- del pedido que se ve en texto libre antes de la asignación.
  resumen             TEXT NOT NULL CHECK (length(btrim(resumen)) BETWEEN 20 AND 2000),
  -- Copiados del lead por el trigger (no los elige quien publica).
  servicio            servicio_tipo NOT NULL,
  urgencia            urgencia_tipo NOT NULL,
  presupuesto_rango   TEXT,
  presupuesto         NUMERIC(12,2) NOT NULL,
  estado              bolsa_estado NOT NULL DEFAULT 'ABIERTO',
  -- Tope y vencimiento los fija n8n al publicar (BOLSA_TOPE, BOLSA_DIAS).
  tope_postulaciones  INT NOT NULL DEFAULT 5 CHECK (tope_postulaciones > 0),
  postulaciones       INT NOT NULL DEFAULT 0,
  vence_en            TIMESTAMPTZ NOT NULL DEFAULT now() + interval '7 days',
  -- Enlace de la página donde el cliente elige (/elegir/<token>).
  eleccion_token      UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  publicado_en        TIMESTAMPTZ NOT NULL DEFAULT now(),
  asignado_espacio_id UUID REFERENCES espacios(id),
  cerrado_en          TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS postulaciones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id       UUID NOT NULL REFERENCES bolsa_pedidos(id) ON DELETE CASCADE,
  espacio_id      UUID NOT NULL REFERENCES espacios(id),
  mensaje         TEXT NOT NULL CHECK (length(btrim(mensaje)) BETWEEN 10 AND 1000),
  precio_estimado NUMERIC(12,2) NOT NULL CHECK (precio_estimado > 0),
  plazo           TEXT NOT NULL CHECK (length(btrim(plazo)) BETWEEN 1 AND 80),
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pedido_id, espacio_id)
);
CREATE INDEX IF NOT EXISTS idx_bolsa_pedidos_estado ON bolsa_pedidos (estado, vence_en);
-- Cuándo se le mandó al cliente el correo para elegir (al llegar al tope o al
-- vencer con postulaciones). Lo marca el cron de la bolsa, así no se repite.
ALTER TABLE bolsa_pedidos ADD COLUMN IF NOT EXISTS eleccion_avisada_en TIMESTAMPTZ;

-- Proyectos que publica un cliente directo (etapa 6, 24-sep-2026). No vienen
-- de un lead ni de un espacio: los datos de contacto quedan acá, sin salir
-- por bolsa_abierta(), y el lead recién se crea en el espacio que el cliente
-- elige (ahí se completa lead_id). Los pedidos por rechazo siguen igual.
ALTER TABLE bolsa_pedidos ALTER COLUMN lead_id DROP NOT NULL;
ALTER TABLE bolsa_pedidos ALTER COLUMN origen_espacio_id DROP NOT NULL;
ALTER TABLE bolsa_pedidos ADD COLUMN IF NOT EXISTS cliente_id UUID REFERENCES profiles(id) ON DELETE RESTRICT;
ALTER TABLE bolsa_pedidos ADD COLUMN IF NOT EXISTS titulo TEXT
  CHECK (titulo IS NULL OR length(btrim(titulo)) BETWEEN 5 AND 120);
ALTER TABLE bolsa_pedidos ADD COLUMN IF NOT EXISTS contacto_nombre TEXT;
ALTER TABLE bolsa_pedidos ADD COLUMN IF NOT EXISTS contacto_email TEXT;
ALTER TABLE bolsa_pedidos ADD COLUMN IF NOT EXISTS contacto_telefono TEXT;
DO $$ BEGIN
  ALTER TABLE bolsa_pedidos ADD CONSTRAINT chk_bolsa_origen CHECK (
    (cliente_id IS NULL AND lead_id IS NOT NULL AND origen_espacio_id IS NOT NULL)
    OR (cliente_id IS NOT NULL AND origen_espacio_id IS NULL AND titulo IS NOT NULL
        AND contacto_nombre IS NOT NULL AND contacto_email IS NOT NULL)
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;
CREATE INDEX IF NOT EXISTS idx_bolsa_pedidos_cliente ON bolsa_pedidos (cliente_id);

-- Etapa 10: etiquetas de habilidades opcionales que suma el cliente al
-- publicar (hasta 8, limpias por publicar_proyecto()) y la marca de que ya
-- se mandaron las alertas a los desarrolladores a los que les encaja.
ALTER TABLE bolsa_pedidos ADD COLUMN IF NOT EXISTS etiquetas TEXT[] NOT NULL DEFAULT '{}'
  CHECK (cardinality(etiquetas) <= 8);
ALTER TABLE bolsa_pedidos ADD COLUMN IF NOT EXISTS alertas_enviadas_en TIMESTAMPTZ;

-- Al publicar un pedido rechazado: exige el consentimiento y copia del lead
-- los datos que se muestran, para que quien publica no pueda poner otros (ni
-- personales). Los proyectos de un cliente llegan armados por
-- publicar_proyecto(), que valida lo suyo.
CREATE OR REPLACE FUNCTION public.bolsa_publicar() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  l leads%ROWTYPE;
BEGIN
  IF NEW.cliente_id IS NULL THEN
    SELECT * INTO l FROM leads WHERE lead_id = NEW.lead_id;
    IF NOT l.compartir_bolsa THEN
      RAISE EXCEPTION 'El cliente no aceptó compartir el pedido con otros desarrolladores';
    END IF;
    NEW.origen_espacio_id := l.espacio_id;
    NEW.servicio := l.servicio;
    NEW.urgencia := l.urgencia;
    NEW.presupuesto_rango := l.presupuesto_rango;
    NEW.presupuesto := l.presupuesto;
  END IF;
  NEW.estado := 'ABIERTO';
  NEW.postulaciones := 0;
  NEW.resumen := btrim(NEW.resumen);
  IF ocultar_contacto(NEW.resumen) <> NEW.resumen THEN
    RAISE EXCEPTION 'El resumen público no puede incluir datos de contacto';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_bolsa_publicar ON bolsa_pedidos;
CREATE TRIGGER trg_bolsa_publicar
  BEFORE INSERT ON bolsa_pedidos
  FOR EACH ROW EXECUTE FUNCTION public.bolsa_publicar();

-- Lo que ve un desarrollador en la bolsa: los pedidos abiertos y los que le
-- tocan (los que rechazó, a los que se postuló o que le asignaron). Sin
-- lead_id, sin token, sin datos de contacto y sin quién lo rechazó: sólo si
-- es propio. `directo`: lo publicó un cliente (trae título).
-- DROP antes de recrear: CREATE OR REPLACE no deja cambiar las columnas.
DROP FUNCTION IF EXISTS public.bolsa_abierta();
CREATE FUNCTION public.bolsa_abierta()
RETURNS TABLE (
  id uuid, resumen text, servicio servicio_tipo, urgencia urgencia_tipo,
  presupuesto_rango text, presupuesto numeric, estado bolsa_estado,
  postulaciones int, tope_postulaciones int, publicado_en timestamptz,
  vence_en timestamptz, propio boolean, me_postule boolean, asignado_a_mi boolean,
  titulo text, directo boolean, mi_postulacion uuid, etiquetas text[]
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH mio AS (
    SELECT e.id FROM espacios e WHERE e.dueno_id = auth.uid() AND e.configurado_en IS NOT NULL
  )
  SELECT b.id, b.resumen, b.servicio, b.urgencia, b.presupuesto_rango, b.presupuesto, b.estado,
         b.postulaciones, b.tope_postulaciones, b.publicado_en, b.vence_en,
         b.origen_espacio_id IS NOT DISTINCT FROM mio.id,
         EXISTS (SELECT 1 FROM postulaciones p WHERE p.pedido_id = b.id AND p.espacio_id = mio.id),
         b.asignado_espacio_id IS NOT DISTINCT FROM mio.id,
         b.titulo, b.cliente_id IS NOT NULL,
         -- La postulación propia: con ella se abre la conversación (etapa 9).
         (SELECT p.id FROM postulaciones p WHERE p.pedido_id = b.id AND p.espacio_id = mio.id),
         b.etiquetas
  FROM bolsa_pedidos b, mio
  WHERE (b.estado = 'ABIERTO' AND b.vence_en > now())
     OR b.origen_espacio_id = mio.id
     OR b.asignado_espacio_id = mio.id
     OR EXISTS (SELECT 1 FROM postulaciones p WHERE p.pedido_id = b.id AND p.espacio_id = mio.id)
  ORDER BY b.publicado_en DESC
$$;

-- Postularse a un pedido. Toda la validación vive acá y no en el panel: el
-- pedido tiene que estar abierto y sin vencer, no puede ser propio, una
-- postulación por espacio, y al llegar al tope pasa a EN_ELECCION (n8n le
-- avisa al cliente). El FOR UPDATE ordena dos postulaciones simultáneas
-- para que la sexta no entre.
CREATE OR REPLACE FUNCTION public.postularme(
  p_pedido uuid, p_mensaje text, p_precio numeric, p_plazo text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  mi_espacio uuid;
  b bolsa_pedidos%ROWTYPE;
BEGIN
  SELECT e.id INTO mi_espacio FROM espacios e
  WHERE e.dueno_id = auth.uid() AND e.configurado_en IS NOT NULL;
  IF mi_espacio IS NULL THEN RAISE EXCEPTION 'La cuenta no tiene un espacio configurado'; END IF;

  SELECT * INTO b FROM bolsa_pedidos WHERE id = p_pedido FOR UPDATE;
  IF NOT FOUND OR b.estado <> 'ABIERTO' OR b.vence_en <= now() THEN
    RAISE EXCEPTION 'El pedido ya no recibe postulaciones';
  END IF;
  IF b.origen_espacio_id = mi_espacio THEN
    RAISE EXCEPTION 'No podés postularte a un pedido que rechazaste';
  END IF;
  IF p_precio IS NULL OR p_precio < 0.01 OR p_precio > 9999999999.99
     OR p_precio <> round(p_precio, 2) THEN
    RAISE EXCEPTION 'El precio estimado debe tener hasta dos decimales y ser de al menos US$ 0,01';
  END IF;

  INSERT INTO postulaciones (pedido_id, espacio_id, mensaje, precio_estimado, plazo)
  VALUES (p_pedido, mi_espacio, btrim(p_mensaje), p_precio, btrim(p_plazo));

  UPDATE bolsa_pedidos
  SET postulaciones = postulaciones + 1,
      estado = CASE WHEN postulaciones + 1 >= tope_postulaciones THEN 'EN_ELECCION'::bolsa_estado ELSE estado END
  WHERE id = p_pedido;
END;
$$;

REVOKE ALL ON FUNCTION public.bolsa_abierta() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.postularme(uuid, text, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bolsa_abierta() TO authenticated;
GRANT EXECUTE ON FUNCTION public.postularme(uuid, text, numeric, text) TO authenticated;

-- Un cliente publica su proyecto directo en la bolsa (etapa 6). Sólo cuentas
-- de cliente. Tope de postulaciones y días de vigencia configurables por base
-- (ALTER DATABASE ... SET app.bolsa_tope_directo = '20'), con 15 y 7 por
-- defecto. Hasta 5 proyectos abiertos por cliente,
-- para que una cuenta no llene la bolsa. El importe es el piso del rango, con
-- la misma tabla que Code - Normalizar Lead.
-- p_etiquetas (etapa 10): opcionales. Se limpian, se sacan las repetidas y
-- se admiten hasta 8, de 1 a 40 caracteres cada una. Cambió la firma: se
-- borra la anterior para que no quede una sobrecarga ambigua.
DROP FUNCTION IF EXISTS public.publicar_proyecto(text, text, servicio_tipo, urgencia_tipo, text, text, text);
CREATE OR REPLACE FUNCTION public.publicar_proyecto(
  p_titulo text, p_descripcion text, p_servicio servicio_tipo, p_urgencia urgencia_tipo,
  p_presupuesto_rango text, p_nombre text, p_telefono text, p_etiquetas text[] DEFAULT '{}'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  correo text;
  piso numeric;
  nuevo uuid;
  tope int := coalesce(nullif(current_setting('app.bolsa_tope_directo', true), '')::int, 15);
  etiquetas text[];
  dias int := coalesce(nullif(current_setting('app.bolsa_dias', true), '')::int, 7);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND tipo = 'cliente') THEN
    RAISE EXCEPTION 'Sólo una cuenta de cliente puede publicar proyectos';
  END IF;
  SELECT u.email INTO correo FROM auth.users u
  WHERE u.id = auth.uid() AND u.email_confirmed_at IS NOT NULL;
  IF correo IS NULL THEN RAISE EXCEPTION 'Confirmá tu correo antes de publicar'; END IF;

  IF (SELECT count(*) FROM bolsa_pedidos
      WHERE cliente_id = auth.uid() AND estado IN ('ABIERTO','EN_ELECCION')) >= 5 THEN
    RAISE EXCEPTION 'Ya tenés 5 proyectos abiertos: elegí o esperá a que cierre alguno';
  END IF;
  IF length(btrim(coalesce(p_nombre, ''))) NOT BETWEEN 2 AND 100 THEN
    RAISE EXCEPTION 'El nombre tiene que tener entre 2 y 100 caracteres';
  END IF;
  IF ocultar_contacto(coalesce(p_titulo, '')) <> coalesce(p_titulo, '')
     OR ocultar_contacto(coalesce(p_descripcion, '')) <> coalesce(p_descripcion, '') THEN
    RAISE EXCEPTION 'El título y la descripción públicos no pueden incluir datos de contacto';
  END IF;

  -- Etiquetas: sin vacías ni repetidas (sin distinguir mayúsculas), en orden.
  SELECT coalesce(array_agg(e ORDER BY primera), '{}') INTO etiquetas FROM (
    SELECT min(btrim(x)) AS e, min(o) AS primera
    FROM unnest(coalesce(p_etiquetas, '{}')) WITH ORDINALITY u(x, o)
    WHERE btrim(x) <> ''
    GROUP BY lower(btrim(x))
  ) t;
  IF cardinality(etiquetas) > 8 THEN RAISE EXCEPTION 'Hasta 8 etiquetas'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(etiquetas) e WHERE length(e) > 40) THEN
    RAISE EXCEPTION 'Cada etiqueta puede tener hasta 40 caracteres';
  END IF;

  piso := CASE p_presupuesto_rango
    WHEN 'hasta_300' THEN 100 WHEN '300_1000' THEN 300 WHEN '1000_2000' THEN 1000
    WHEN '2000_5000' THEN 2000 WHEN 'mas_5000' THEN 5000 END;
  IF piso IS NULL THEN RAISE EXCEPTION 'Rango de presupuesto inválido'; END IF;

  INSERT INTO bolsa_pedidos (
    cliente_id, titulo, resumen, servicio, urgencia, presupuesto_rango, presupuesto,
    contacto_nombre, contacto_email, contacto_telefono, tope_postulaciones, vence_en, etiquetas
  ) VALUES (
    auth.uid(), btrim(p_titulo), btrim(p_descripcion), p_servicio, p_urgencia, p_presupuesto_rango, piso,
    btrim(p_nombre), correo, nullif(btrim(coalesce(p_telefono, '')), ''), tope, now() + make_interval(days => dias),
    etiquetas
  ) RETURNING id INTO nuevo;

  RETURN nuevo;
END;
$$;


REVOKE ALL ON FUNCTION public.publicar_proyecto(text, text, servicio_tipo, urgencia_tipo, text, text, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publicar_proyecto(text, text, servicio_tipo, urgencia_tipo, text, text, text, text[]) TO authenticated;

-- RLS sin políticas para authenticated ni anon: denegado por defecto. n8n
-- publica, lee las postulaciones para la página del cliente, asigna y vence.
ALTER TABLE bolsa_pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolsa_pedidos FORCE ROW LEVEL SECURITY;
ALTER TABLE postulaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE postulaciones FORCE ROW LEVEL SECURITY;
REVOKE ALL ON bolsa_pedidos, postulaciones FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON bolsa_pedidos, postulaciones TO service_role;
GRANT SELECT, INSERT, UPDATE ON bolsa_pedidos TO n8n_writer;
GRANT SELECT ON postulaciones TO n8n_writer;
-- Una política por operación, como el resto: FOR ALL también habilitaría un
-- DELETE si algún día se otorgara por error.
DROP POLICY IF EXISTS bolsa_pedidos_rw_n8n_writer ON bolsa_pedidos;
DROP POLICY IF EXISTS bolsa_pedidos_select_n8n_writer ON bolsa_pedidos;
CREATE POLICY bolsa_pedidos_select_n8n_writer ON bolsa_pedidos
  FOR SELECT TO n8n_writer USING (true);
DROP POLICY IF EXISTS bolsa_pedidos_insert_n8n_writer ON bolsa_pedidos;
CREATE POLICY bolsa_pedidos_insert_n8n_writer ON bolsa_pedidos
  FOR INSERT TO n8n_writer WITH CHECK (true);
DROP POLICY IF EXISTS bolsa_pedidos_update_n8n_writer ON bolsa_pedidos;
CREATE POLICY bolsa_pedidos_update_n8n_writer ON bolsa_pedidos
  FOR UPDATE TO n8n_writer USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS postulaciones_select_n8n_writer ON postulaciones;
CREATE POLICY postulaciones_select_n8n_writer ON postulaciones
  FOR SELECT TO n8n_writer USING (true);

-- =====================================================================
-- 9) Perfiles públicos y calificaciones (etapas 7 y 8, 24-sep-2026)
-- =====================================================================
-- Cada desarrollador tiene un perfil público (/d/<slug>) con su
-- presentación, habilidades, portfolio y reputación. Al cerrar un proyecto,
-- el cliente recibe un enlace para calificarlo con estrellas (1 a 5) y un
-- comentario opcional. Se califican todos los proyectos cerrados, y cada
-- reseña indica si el cliente llegó por la plataforma (bolsa) o por el
-- formulario propio del desarrollador.
--
-- Nadie lee ni escribe estas tablas directo desde afuera: el perfil, las
-- reseñas y la calificación pasan por funciones que devuelven y validan sólo
-- lo que corresponde.

ALTER TABLE espacios ADD COLUMN IF NOT EXISTS presentacion TEXT
  CHECK (presentacion IS NULL OR length(presentacion) <= 1500);
ALTER TABLE espacios ADD COLUMN IF NOT EXISTS habilidades TEXT[] NOT NULL DEFAULT '{}'
  CHECK (cardinality(habilidades) <= 15);
ALTER TABLE espacios ADD COLUMN IF NOT EXISTS portfolio_urls TEXT[] NOT NULL DEFAULT '{}'
  CHECK (cardinality(portfolio_urls) <= 5);
-- El dueño edita su perfil (la política espacios_update_dueno ya limita a su fila).
GRANT UPDATE (presentacion, habilidades, portfolio_urls) ON espacios TO authenticated;

-- Cada habilidad es una etiqueta corta y cada enlace del portfolio, una URL
-- http(s): el perfil es público y no debe poder llevar javascript: ni HTML.
CREATE OR REPLACE FUNCTION public.espacios_validar_perfil() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM unnest(NEW.habilidades) h WHERE length(btrim(h)) NOT BETWEEN 1 AND 40) THEN
    RAISE EXCEPTION 'Cada habilidad tiene que tener entre 1 y 40 caracteres';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(NEW.portfolio_urls) u
             WHERE u !~ '^https?://[^\s<>"]+$' OR length(u) > 300) THEN
    RAISE EXCEPTION 'Los enlaces del portfolio tienen que empezar con http:// o https://';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_espacios_validar_perfil ON espacios;
CREATE TRIGGER trg_espacios_validar_perfil
  BEFORE INSERT OR UPDATE OF habilidades, portfolio_urls ON espacios
  FOR EACH ROW EXECUTE FUNCTION public.espacios_validar_perfil();

-- Enlace para calificar que recibe el cliente al cerrarse el proyecto.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS calificacion_token UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_calificacion_token ON leads (calificacion_token);

CREATE TABLE IF NOT EXISTS calificaciones (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Una por proyecto.
  lead_id      TEXT UNIQUE NOT NULL REFERENCES leads(lead_id) ON DELETE CASCADE,
  -- El espacio que hizo el trabajo, fijo: si el lead se mudara después, la
  -- reseña sigue siendo de quien lo hizo.
  espacio_id   UUID NOT NULL REFERENCES espacios(id),
  estrellas    SMALLINT NOT NULL CHECK (estrellas BETWEEN 1 AND 5),
  comentario   TEXT CHECK (comentario IS NULL OR length(comentario) <= 1000),
  -- Sólo el nombre de pila, que es lo que se muestra.
  autor_nombre TEXT NOT NULL,
  origen       TEXT NOT NULL CHECK (origen IN ('plataforma','formulario')),
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_calificaciones_espacio ON calificaciones (espacio_id, creado_en DESC);

ALTER TABLE calificaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE calificaciones FORCE ROW LEVEL SECURITY;
REVOKE ALL ON calificaciones FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON calificaciones TO service_role;
GRANT SELECT ON calificaciones TO n8n_writer;
DROP POLICY IF EXISTS calificaciones_select_n8n_writer ON calificaciones;
CREATE POLICY calificaciones_select_n8n_writer ON calificaciones FOR SELECT TO n8n_writer USING (true);

-- Reputación de un espacio: promedio (con un decimal) y cantidad. La usan el
-- perfil, las postulaciones y el sorteo ponderado.
CREATE OR REPLACE FUNCTION public.reputacion(p_espacio uuid)
RETURNS TABLE (promedio numeric, cantidad int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT round(avg(c.estrellas)::numeric, 1), count(*)::int
  FROM calificaciones c WHERE c.espacio_id = p_espacio
$$;

-- Lo que ve la página /calificar/<token> antes de calificar: a quién y si ya
-- lo hizo. Sólo proyectos cerrados.
CREATE OR REPLACE FUNCTION public.calificacion_pendiente(p_token uuid)
RETURNS TABLE (espacio_nombre text, servicio servicio_tipo, cliente_nombre text, ya_calificado boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.nombre, l.servicio, split_part(btrim(l.nombre), ' ', 1),
         EXISTS (SELECT 1 FROM calificaciones c WHERE c.lead_id = l.lead_id)
  FROM leads l JOIN espacios e ON e.id = l.espacio_id
  WHERE l.calificacion_token = p_token AND l.estado = 'CERRADO'
$$;

-- El cliente califica con el token del correo. Una vez por proyecto, sólo
-- cerrados. El origen se decide acá: «plataforma» si el pedido pasó por la
-- bolsa y quedó asignado a este espacio.
CREATE OR REPLACE FUNCTION public.calificar(p_token uuid, p_estrellas int, p_comentario text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  l leads%ROWTYPE;
  marca text;
BEGIN
  SELECT * INTO l FROM leads WHERE calificacion_token = p_token AND estado = 'CERRADO';
  IF NOT FOUND THEN RAISE EXCEPTION 'El enlace no es válido o el proyecto no está cerrado'; END IF;
  IF p_estrellas IS NULL OR p_estrellas NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'Elegí entre 1 y 5 estrellas';
  END IF;

  INSERT INTO calificaciones (lead_id, espacio_id, estrellas, comentario, autor_nombre, origen)
  VALUES (
    l.lead_id, l.espacio_id, p_estrellas, nullif(btrim(coalesce(p_comentario, '')), ''),
    split_part(btrim(l.nombre), ' ', 1),
    CASE WHEN EXISTS (SELECT 1 FROM bolsa_pedidos b
                      WHERE b.lead_id = l.lead_id AND b.estado = 'ASIGNADO' AND b.asignado_espacio_id = l.espacio_id)
         THEN 'plataforma' ELSE 'formulario' END
  )
  ON CONFLICT (lead_id) DO NOTHING;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ya calificaste este proyecto'; END IF;

  SELECT e.nombre INTO marca FROM espacios e WHERE e.id = l.espacio_id;
  RETURN marca;
END;
$$;

-- El perfil público de un desarrollador, por su dirección. Sólo espacios con
-- el alta completa. Proyectos terminados = leads cerrados del espacio.
CREATE OR REPLACE FUNCTION public.perfil_publico(p_slug text)
RETURNS TABLE (
  slug text, nombre text, presentacion text, habilidades text[], portfolio_urls text[],
  promedio numeric, calificaciones int, proyectos_terminados int, miembro_desde timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.slug, e.nombre, e.presentacion, e.habilidades, e.portfolio_urls,
         r.promedio, r.cantidad,
         (SELECT count(*)::int FROM leads l WHERE l.espacio_id = e.id AND l.estado = 'CERRADO'),
         e.configurado_en
  FROM espacios e, LATERAL reputacion(e.id) r
  WHERE e.slug = lower(p_slug) AND e.configurado_en IS NOT NULL
$$;

-- Las reseñas de un perfil, de la más nueva a la más vieja.
CREATE OR REPLACE FUNCTION public.resenas_publicas(p_slug text)
RETURNS TABLE (estrellas smallint, comentario text, autor_nombre text, origen text, creado_en timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.estrellas, c.comentario, c.autor_nombre, c.origen, c.creado_en
  FROM calificaciones c JOIN espacios e ON e.id = c.espacio_id
  WHERE e.slug = lower(p_slug) AND e.configurado_en IS NOT NULL
  ORDER BY c.creado_en DESC
  LIMIT 50
$$;

REVOKE ALL ON FUNCTION public.reputacion(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.calificacion_pendiente(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.calificar(uuid, int, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.perfil_publico(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resenas_publicas(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reputacion(uuid) TO authenticated, n8n_writer;
GRANT EXECUTE ON FUNCTION public.calificacion_pendiente(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calificar(uuid, int, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.perfil_publico(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resenas_publicas(text) TO anon, authenticated;

-- «Que lo elija la plataforma»: sortea una postulación del pedido con chances
-- proporcionales a las estrellas de cada postulante. Quien no tiene
-- calificaciones cuenta como el promedio de la plataforma (o 3 si todavía no
-- hay ninguna), para no castigar a los nuevos. Método de Efraimidis-Spirakis:
-- cada uno saca -ln(U)/peso y gana el menor, lo que equivale a elegir con
-- probabilidad peso / suma de pesos. La usa n8n al asignar (bolsa-elegir).
CREATE OR REPLACE FUNCTION public.sortear_postulacion(p_pedido uuid) RETURNS uuid
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  SELECT po.id
  FROM postulaciones po
  CROSS JOIN LATERAL reputacion(po.espacio_id) r
  WHERE po.pedido_id = p_pedido
  ORDER BY -ln(1 - random())
           / GREATEST(COALESCE(r.promedio, (SELECT avg(c.estrellas) FROM calificaciones c), 3), 0.1)
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.sortear_postulacion(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sortear_postulacion(uuid) TO n8n_writer;


-- =====================================================================
-- 10) Mensajes (etapa 9, 24-sep-2026)
-- =====================================================================
-- Una conversación por postulación: el cliente y ese postulante. Pueden
-- empezarla los dos. Antes de la elección se ocultan teléfonos, correos y
-- enlaces de mensajería (los datos del cliente sólo le llegan a quien
-- elija). Después de elegir, la conversación sigue con el elegido, ya sin
-- ocultar nada, y se cierra para los demás. El cliente sin cuenta (pedidos
-- de la bolsa por rechazo) escribe desde /elegir con el token del enlace.

CREATE TABLE IF NOT EXISTS mensajes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  postulacion_id UUID NOT NULL REFERENCES postulaciones(id) ON DELETE CASCADE,
  autor          TEXT NOT NULL CHECK (autor IN ('cliente','desarrollador')),
  texto          TEXT NOT NULL CHECK (length(btrim(texto)) BETWEEN 1 AND 2000),
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Lo leyó la otra parte.
  leido_en       TIMESTAMPTZ,
  -- Se le mandó el correo de «tenés mensajes sin leer» (cron de mensajes).
  avisado_en     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_mensajes_postulacion ON mensajes (postulacion_id, creado_en);
CREATE INDEX IF NOT EXISTS idx_mensajes_sin_leer ON mensajes (creado_en) WHERE leido_en IS NULL;

-- Tapa teléfonos, correos y enlaces de mensajería. Un teléfono son 8 dígitos
-- o más separados por espacios, guiones o paréntesis; el punto no cuenta
-- como separador porque en un precio es el de miles («2.000 - 5.000»).
CREATE OR REPLACE FUNCTION public.ocultar_contacto(p_texto text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  t text := p_texto;
  m text[];
BEGIN
  t := regexp_replace(t, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[dato oculto]', 'g');
  t := regexp_replace(t, '(https?://)?(www\.)?(wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com|t\.me|telegram\.me|m\.me)/\S*', '[dato oculto]', 'gi');
  FOR m IN SELECT regexp_matches(t, '[+(]?\d[\d\s()-]{6,}\d', 'g') LOOP
    IF length(regexp_replace(m[1], '\D', '', 'g')) >= 8 THEN
      t := replace(t, m[1], '[dato oculto]');
    END IF;
  END LOOP;
  RETURN t;
END;
$$;

-- Quién es el que llama en una conversación y en qué estado está. Interna:
-- la usan las funciones de abajo.
--   rol: 'desarrollador' (dueño del espacio que se postuló), 'cliente' (el
--        de la cuenta que publicó, o quien trae el token del enlace) o NULL.
--   abierta: el pedido todavía recibe elección, o se asignó a este postulante.
--   ocultar: todavía no se eligió a este postulante.
CREATE OR REPLACE FUNCTION public.conversacion_rol(p_postulacion uuid, p_token uuid)
RETURNS TABLE (rol text, abierta boolean, ocultar boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
           WHEN EXISTS (SELECT 1 FROM espacios e WHERE e.id = po.espacio_id AND e.dueno_id = auth.uid())
             THEN 'desarrollador'
           WHEN (b.cliente_id IS NOT NULL AND b.cliente_id = auth.uid())
             OR (p_token IS NOT NULL AND p_token = b.eleccion_token)
             THEN 'cliente'
         END,
         b.estado IN ('ABIERTO','EN_ELECCION')
           OR (b.estado = 'ASIGNADO' AND b.asignado_espacio_id = po.espacio_id),
         NOT (b.estado = 'ASIGNADO' AND b.asignado_espacio_id = po.espacio_id)
  FROM postulaciones po JOIN bolsa_pedidos b ON b.id = po.pedido_id
  WHERE po.id = p_postulacion
$$;
REVOKE ALL ON FUNCTION public.conversacion_rol(uuid, uuid) FROM PUBLIC;

-- Abre la conversación: devuelve el rol, si está abierta y los mensajes, y
-- marca como leídos los de la otra parte.
CREATE OR REPLACE FUNCTION public.abrir_conversacion(p_postulacion uuid, p_token uuid DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c record;
BEGIN
  SELECT * INTO c FROM conversacion_rol(p_postulacion, p_token);
  IF c.rol IS NULL THEN RAISE EXCEPTION 'No tenés acceso a esta conversación'; END IF;

  UPDATE mensajes SET leido_en = now()
  WHERE postulacion_id = p_postulacion AND autor <> c.rol AND leido_en IS NULL;

  RETURN json_build_object(
    'rol', c.rol,
    'abierta', c.abierta,
    'ocultar', c.ocultar,
    'mensajes', COALESCE((
      SELECT json_agg(json_build_object(
               'id', m.id, 'autor', m.autor, 'texto', m.texto,
               'creado_en', m.creado_en, 'leido_en', m.leido_en) ORDER BY m.creado_en)
      FROM mensajes m WHERE m.postulacion_id = p_postulacion
    ), '[]'::json)
  );
END;
$$;

-- Envía un mensaje. El autor lo decide la base según quién llama; antes de la
-- elección se ocultan los datos de contacto.
CREATE OR REPLACE FUNCTION public.enviar_mensaje(p_postulacion uuid, p_texto text, p_token uuid DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c record;
  nuevo mensajes%ROWTYPE;
BEGIN
  SELECT * INTO c FROM conversacion_rol(p_postulacion, p_token);
  IF c.rol IS NULL THEN RAISE EXCEPTION 'No tenés acceso a esta conversación'; END IF;
  IF NOT c.abierta THEN RAISE EXCEPTION 'La conversación está cerrada'; END IF;
  IF length(btrim(coalesce(p_texto, ''))) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'El mensaje tiene que tener entre 1 y 2000 caracteres';
  END IF;

  INSERT INTO mensajes (postulacion_id, autor, texto)
  VALUES (p_postulacion, c.rol, CASE WHEN c.ocultar THEN ocultar_contacto(btrim(p_texto)) ELSE btrim(p_texto) END)
  RETURNING * INTO nuevo;

  RETURN json_build_object('id', nuevo.id, 'autor', nuevo.autor, 'texto', nuevo.texto,
                           'creado_en', nuevo.creado_en, 'leido_en', nuevo.leido_en);
END;
$$;

-- Mensajes sin leer de la cuenta con sesión, por postulación (para los
-- contadores del panel del desarrollador y de «Mis proyectos»).
CREATE OR REPLACE FUNCTION public.mensajes_sin_leer()
RETURNS TABLE (postulacion_id uuid, cantidad int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.postulacion_id, count(*)::int
  FROM mensajes m
  JOIN postulaciones po ON po.id = m.postulacion_id
  JOIN bolsa_pedidos b ON b.id = po.pedido_id
  WHERE m.leido_en IS NULL
    AND ((m.autor = 'cliente' AND EXISTS (SELECT 1 FROM espacios e WHERE e.id = po.espacio_id AND e.dueno_id = auth.uid()))
      OR (m.autor = 'desarrollador' AND b.cliente_id = auth.uid()))
  GROUP BY m.postulacion_id
$$;

-- Para la política de lectura (tiempo real): ¿esta cuenta participa de la
-- conversación? SECURITY DEFINER porque postulaciones y bolsa_pedidos no se
-- leen directo.
CREATE OR REPLACE FUNCTION public.participa_de(p_postulacion uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM postulaciones po JOIN bolsa_pedidos b ON b.id = po.pedido_id
    WHERE po.id = p_postulacion
      AND (EXISTS (SELECT 1 FROM espacios e WHERE e.id = po.espacio_id AND e.dueno_id = auth.uid())
           OR b.cliente_id = auth.uid())
  )
$$;

ALTER TABLE mensajes ENABLE ROW LEVEL SECURITY;
ALTER TABLE mensajes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON mensajes FROM anon, authenticated;
-- Sólo lectura directa, y sólo de las conversaciones propias: la usa el
-- tiempo real de Supabase. Escribir, sólo por enviar_mensaje().
GRANT SELECT ON mensajes TO authenticated;
DROP POLICY IF EXISTS mensajes_select_participantes ON mensajes;
CREATE POLICY mensajes_select_participantes ON mensajes
  FOR SELECT TO authenticated USING (participa_de(postulacion_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON mensajes TO service_role;
-- n8n: el cron de avisos lee los sin leer y marca avisado_en.
GRANT SELECT, UPDATE (avisado_en) ON mensajes TO n8n_writer;
DROP POLICY IF EXISTS mensajes_select_n8n_writer ON mensajes;
CREATE POLICY mensajes_select_n8n_writer ON mensajes FOR SELECT TO n8n_writer USING (true);
DROP POLICY IF EXISTS mensajes_update_n8n_writer ON mensajes;
CREATE POLICY mensajes_update_n8n_writer ON mensajes FOR UPDATE TO n8n_writer USING (true) WITH CHECK (true);

REVOKE ALL ON FUNCTION public.abrir_conversacion(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enviar_mensaje(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mensajes_sin_leer() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.participa_de(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.abrir_conversacion(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enviar_mensaje(uuid, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mensajes_sin_leer() TO authenticated;
GRANT EXECUTE ON FUNCTION public.participa_de(uuid) TO authenticated;

-- Tiempo real: el panel y «Mis proyectos» reciben los mensajes nuevos al
-- instante (la RLS filtra: cada uno recibe sólo los suyos).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'mensajes') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.mensajes;
  END IF;
END $$;

-- =====================================================================
-- 11) Directorio y alertas (etapa 10, 24-sep-2026)
-- =====================================================================
-- Cada desarrollador declara los servicios que ofrece: con eso aparece en el
-- directorio público (/desarrolladores) y recibe alertas de los proyectos
-- nuevos de la bolsa de esos tipos, con un presupuesto mínimo opcional.
ALTER TABLE espacios ADD COLUMN IF NOT EXISTS servicios servicio_tipo[] NOT NULL DEFAULT '{}';
ALTER TABLE espacios ADD COLUMN IF NOT EXISTS alerta_presupuesto_min NUMERIC(12,2)
  CHECK (alerta_presupuesto_min IS NULL OR alerta_presupuesto_min >= 0);
ALTER TABLE espacios ADD COLUMN IF NOT EXISTS alertas_correo BOOLEAN NOT NULL DEFAULT true;
GRANT UPDATE (servicios, alerta_presupuesto_min, alertas_correo) ON espacios TO authenticated;
-- n8n arma las alertas: necesita saber qué ofrece cada uno y si completó el alta.
GRANT SELECT (servicios, alerta_presupuesto_min, alertas_correo, configurado_en) ON espacios TO n8n_writer;

-- Los proyectos que ya estaban en la bolsa antes de las alertas no se
-- anuncian de golpe. Re-aplicar el esquema no pisa ninguno pendiente: el
-- cron los avisa en menos de 15 minutos, mucho antes de la hora de margen.
UPDATE bolsa_pedidos SET alertas_enviadas_en = publicado_en
WHERE alertas_enviadas_en IS NULL AND publicado_en < now() - interval '1 hour';

-- Directorio público: sólo espacios con el alta completa que declararon al
-- menos un servicio (así no aparecen perfiles vacíos). Filtra por tipo de
-- trabajo y por habilidad (sin distinguir mayúsculas), y ordena por estrellas.
CREATE OR REPLACE FUNCTION public.directorio_publico(p_servicio servicio_tipo DEFAULT NULL, p_habilidad text DEFAULT NULL)
RETURNS TABLE (
  slug text, nombre text, presentacion text, habilidades text[], servicios servicio_tipo[],
  promedio numeric, calificaciones int, proyectos_terminados int
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.slug, e.nombre, left(e.presentacion, 240), e.habilidades, e.servicios,
         r.promedio, r.cantidad,
         (SELECT count(*)::int FROM leads l WHERE l.espacio_id = e.id AND l.estado = 'CERRADO')
  FROM espacios e, LATERAL reputacion(e.id) r
  WHERE e.configurado_en IS NOT NULL
    AND cardinality(e.servicios) > 0
    AND (p_servicio IS NULL OR p_servicio = ANY (e.servicios))
    AND (nullif(btrim(coalesce(p_habilidad, '')), '') IS NULL
         OR EXISTS (SELECT 1 FROM unnest(e.habilidades) h WHERE lower(h) LIKE '%' || lower(btrim(p_habilidad)) || '%'))
  ORDER BY r.promedio DESC NULLS LAST, r.cantidad DESC, e.nombre
  LIMIT 100
$$;
REVOKE ALL ON FUNCTION public.directorio_publico(servicio_tipo, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.directorio_publico(servicio_tipo, text) TO anon, authenticated;

-- =====================================================================
-- 12) Pago protegido por hitos (etapa 11, 28-sep-2026)
-- =====================================================================
-- El desarrollador divide el proyecto en hitos. El cliente paga cada uno por
-- adelantado y la plataforma retiene la plata hasta que el cliente aprueba la
-- entrega: recién ahí se le transfiere al desarrollador, menos la comisión.
-- Si el cliente no aprueba ni disputa, la entrega se libera sola a los 7 días
-- (app.hitos_dias_liberacion). Una disputa la resuelve el admin de la
-- plataforma: libera, reembolsa o parte el monto.
--
-- Es obligatorio en los proyectos que llegaron por la plataforma (la bolsa o
-- /publicar). Con sus clientes propios, el desarrollador elige entre hitos y
-- la factura única de siempre.
--
-- La base decide y registra; la plata la mueve n8n con Stripe (la plataforma
-- cobra y, al liberar, transfiere aparte a la cuenta del desarrollador). Una
-- decisión que mueve plata deja la marca pendiente (monto_liberado sin
-- stripe_transfer_id, monto_reembolsado sin stripe_reembolso_id) y el cron de
-- n8n la ejecuta, con el id del hito como clave de idempotencia en Stripe.
--
-- Nadie escribe estas tablas directo: todo pasa por las funciones de abajo,
-- que deciden quién es el que llama (desarrollador, cliente o admin) y qué
-- puede hacer en cada estado.

-- 'factura': la factura única de siempre. 'hitos': pago protegido.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS cobro_modo TEXT NOT NULL DEFAULT 'factura';
DO $$ BEGIN
  ALTER TABLE leads ADD CONSTRAINT chk_leads_cobro_modo CHECK (cobro_modo IN ('factura','hitos'));
EXCEPTION WHEN duplicate_object THEN null; END $$;
-- Enlace de la página del proyecto (/proyecto/<token>): ahí el cliente sin
-- cuenta paga, aprueba y disputa los hitos. El que tiene cuenta entra también
-- desde «Mis proyectos».
ALTER TABLE leads ADD COLUMN IF NOT EXISTS proyecto_token UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_proyecto_token ON leads (proyecto_token);

-- PENDIENTE → FONDEADO → ENTREGADO → LIBERADO, con dos desvíos: EN_DISPUTA
-- (lo resuelve el admin) y REEMBOLSADO. ANULADO: el desarrollador lo sacó
-- antes de que se pagara.
DO $$ BEGIN CREATE TYPE hito_estado AS ENUM
  ('PENDIENTE','FONDEADO','ENTREGADO','EN_DISPUTA','LIBERADO','REEMBOLSADO','ANULADO');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS hitos (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- RESTRICT, como las facturas: es registro de plata.
  lead_id             TEXT NOT NULL REFERENCES leads(lead_id) ON DELETE RESTRICT,
  -- Siempre el del lead: lo fija trg_hitos_espacio.
  espacio_id          UUID NOT NULL REFERENCES espacios(id),
  orden               SMALLINT NOT NULL CHECK (orden BETWEEN 1 AND 10),
  titulo              TEXT NOT NULL CHECK (length(btrim(titulo)) BETWEEN 3 AND 120),
  descripcion         TEXT CHECK (descripcion IS NULL OR length(descripcion) <= 1000),
  monto               NUMERIC(12,2) NOT NULL CHECK (monto >= 1),
  -- Se fija al crear el hito (app.comision_hitos, 5 por defecto): cambiar la
  -- comisión de la plataforma no toca lo ya acordado.
  comision_porcentaje NUMERIC(5,2) NOT NULL CHECK (comision_porcentaje BETWEEN 0 AND 50),
  estado              hito_estado NOT NULL DEFAULT 'PENDIENTE',
  -- Cobro: la sesión de pago la crea n8n cuando el cliente toca «Pagar».
  stripe_checkout_id  TEXT,
  stripe_pago_id      TEXT,
  fondeado_en         TIMESTAMPTZ,
  -- Entrega: qué entregó el desarrollador y hasta cuándo puede el cliente
  -- aprobar o disputar antes de que se libere sola.
  entrega_nota        TEXT CHECK (entrega_nota IS NULL OR length(entrega_nota) <= 2000),
  entregado_en        TIMESTAMPTZ,
  libera_en           TIMESTAMPTZ,
  disputa_motivo      TEXT CHECK (disputa_motivo IS NULL OR length(disputa_motivo) <= 2000),
  disputa_abierta_en  TIMESTAMPTZ,
  -- Cierre: cuánto va al desarrollador, cuánto vuelve al cliente y cuánto se
  -- queda la plataforma (sobre lo liberado). resolucion_nota la escribe quien
  -- decidió una devolución o una disputa.
  monto_liberado      NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (monto_liberado >= 0),
  monto_reembolsado   NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (monto_reembolsado >= 0),
  comision            NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (comision >= 0),
  resolucion_nota     TEXT CHECK (resolucion_nota IS NULL OR length(resolucion_nota) <= 2000),
  cerrado_en          TIMESTAMPTZ,
  -- Los movimientos que ya hizo n8n en Stripe.
  stripe_transfer_id  TEXT,
  transferido_en      TIMESTAMPTZ,
  stripe_reembolso_id TEXT,
  reembolsado_en      TIMESTAMPTZ,
  creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lead_id, orden),
  CHECK (monto_liberado + monto_reembolsado <= monto),
  -- Un hito cerrado reparte el monto entero.
  CHECK (estado NOT IN ('LIBERADO','REEMBOLSADO') OR monto_liberado + monto_reembolsado = monto)
);
CREATE INDEX IF NOT EXISTS idx_hitos_lead ON hitos (lead_id, orden);
ALTER TABLE hitos ADD COLUMN IF NOT EXISTS stripe_checkout_reservado_en TIMESTAMPTZ;
ALTER TABLE hitos ADD COLUMN IF NOT EXISTS stripe_checkout_intento_id UUID;
ALTER TABLE hitos ADD COLUMN IF NOT EXISTS stripe_checkout_expira_en TIMESTAMPTZ;
ALTER TABLE hitos ADD COLUMN IF NOT EXISTS stripe_checkout_url TEXT;
-- Un intento de movimiento externo se reclama ANTES de llamar a Stripe.
-- Si falla Stripe o el registro posterior, queda para revisión manual y nunca
-- se reenvía sólo porque venció la retención de Idempotency-Key de Stripe.
ALTER TABLE hitos ADD COLUMN IF NOT EXISTS stripe_transfer_intentado_en TIMESTAMPTZ;
ALTER TABLE hitos ADD COLUMN IF NOT EXISTS stripe_reembolso_intentado_en TIMESTAMPTZ;
-- Pagos que Stripe confirmó pero no se pudieron aplicar. No se da por hecho
-- que un reembolso automático sea seguro: esta cola durable exige conciliación
-- por un operador y conserva un único registro por PaymentIntent.
CREATE TABLE IF NOT EXISTS pagos_no_aplicados (
  stripe_pago_id TEXT PRIMARY KEY,
  factura_id TEXT,
  hito_id UUID,
  motivo TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','resuelto')),
  detectado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  resuelto_en TIMESTAMPTZ,
  CHECK (factura_id IS NOT NULL OR hito_id IS NOT NULL)
);
-- Cola de conciliación: nunca se despeja una sesión externa sólo porque venza
-- la reserva local. Recuperación: bloquear la factura/hito con SELECT FOR
-- UPDATE; consultar Stripe por stripe_checkout_id o por checkout_intento_id
-- en metadata; si existe un pago, conciliarlo primero. Sólo tras comprobar
-- que la sesión expiró sin pago (o que jamás se creó), limpiar los cuatro
-- campos checkout_* de esa fila y marcar resuelto_en EN LA MISMA TRANSACCIÓN.
-- Si Stripe no puede confirmar el resultado, mantener el bloqueo manual.
-- aviso_avisado_en confirma sólo la inserción durable en avisos (panel). El
-- cron relee toda fila pendiente sin ACK, incluso si la insertó otro flujo;
-- un fallo tras insertar avisos y antes del ACK puede duplicar el aviso.
CREATE TABLE IF NOT EXISTS checkout_revisiones (
  tipo TEXT NOT NULL CHECK (tipo IN ('factura','hito')),
  referencia_id TEXT NOT NULL,
  identidad TEXT NOT NULL,
  stripe_checkout_id TEXT,
  motivo TEXT NOT NULL,
  detectado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  resuelto_en TIMESTAMPTZ,
  aviso_avisado_en TIMESTAMPTZ,
  PRIMARY KEY (tipo, referencia_id, identidad)
);
ALTER TABLE checkout_revisiones ADD COLUMN IF NOT EXISTS aviso_avisado_en TIMESTAMPTZ;
-- Intentos externos sin identificador de Stripe: pueden haber tenido éxito;
-- nunca se reemiten a ciegas, aun vencida la ventana de idempotencia.
CREATE TABLE IF NOT EXISTS hitos_movimientos_revision (
  hito_id UUID NOT NULL REFERENCES hitos(id) ON DELETE RESTRICT,
  movimiento TEXT NOT NULL CHECK (movimiento IN ('transferir','reembolsar')),
  detectado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  resuelto_en TIMESTAMPTZ,
  PRIMARY KEY (hito_id, movimiento)
);
ALTER TABLE hitos_movimientos_revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE hitos_movimientos_revision FORCE ROW LEVEL SECURITY;
REVOKE ALL ON hitos_movimientos_revision FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON hitos_movimientos_revision TO service_role;
GRANT SELECT, INSERT ON hitos_movimientos_revision TO n8n_writer;
DROP POLICY IF EXISTS hitos_movimientos_revision_select_n8n_writer ON hitos_movimientos_revision;
CREATE POLICY hitos_movimientos_revision_select_n8n_writer ON hitos_movimientos_revision FOR SELECT TO n8n_writer USING (true);
DROP POLICY IF EXISTS hitos_movimientos_revision_insert_n8n_writer ON hitos_movimientos_revision;
CREATE POLICY hitos_movimientos_revision_insert_n8n_writer ON hitos_movimientos_revision FOR INSERT TO n8n_writer WITH CHECK (true);
ALTER TABLE checkout_revisiones ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkout_revisiones FORCE ROW LEVEL SECURITY;
REVOKE ALL ON checkout_revisiones FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON checkout_revisiones TO service_role;
GRANT SELECT, INSERT, UPDATE (aviso_avisado_en) ON checkout_revisiones TO n8n_writer;
DROP POLICY IF EXISTS checkout_revisiones_select_n8n_writer ON checkout_revisiones;
CREATE POLICY checkout_revisiones_select_n8n_writer ON checkout_revisiones FOR SELECT TO n8n_writer USING (true);
DROP POLICY IF EXISTS checkout_revisiones_insert_n8n_writer ON checkout_revisiones;
CREATE POLICY checkout_revisiones_insert_n8n_writer ON checkout_revisiones FOR INSERT TO n8n_writer WITH CHECK (true);
DROP POLICY IF EXISTS checkout_revisiones_update_n8n_writer ON checkout_revisiones;
CREATE POLICY checkout_revisiones_update_n8n_writer ON checkout_revisiones
  FOR UPDATE TO n8n_writer USING (true) WITH CHECK (true);
INSERT INTO checkout_revisiones (tipo, referencia_id, identidad, stripe_checkout_id, motivo)
SELECT 'factura', factura_id, stripe_checkout_id, stripe_checkout_id, 'legacy_sin_expiracion_verificada'
FROM facturas WHERE stripe_checkout_id IS NOT NULL AND stripe_checkout_intento_id IS NULL
ON CONFLICT DO NOTHING;
INSERT INTO checkout_revisiones (tipo, referencia_id, identidad, stripe_checkout_id, motivo)
SELECT 'hito', id::text, stripe_checkout_id, stripe_checkout_id, 'legacy_sin_expiracion_verificada'
FROM hitos WHERE stripe_checkout_id IS NOT NULL AND stripe_checkout_intento_id IS NULL
ON CONFLICT DO NOTHING;
ALTER TABLE pagos_no_aplicados ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagos_no_aplicados FORCE ROW LEVEL SECURITY;
REVOKE ALL ON pagos_no_aplicados FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON pagos_no_aplicados TO service_role;
GRANT SELECT, INSERT ON pagos_no_aplicados TO n8n_writer;
DROP POLICY IF EXISTS pagos_no_aplicados_select_n8n_writer ON pagos_no_aplicados;
CREATE POLICY pagos_no_aplicados_select_n8n_writer ON pagos_no_aplicados
  FOR SELECT TO n8n_writer USING (true);
DROP POLICY IF EXISTS pagos_no_aplicados_insert_n8n_writer ON pagos_no_aplicados;
CREATE POLICY pagos_no_aplicados_insert_n8n_writer ON pagos_no_aplicados
  FOR INSERT TO n8n_writer WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_hitos_espacio ON hitos (espacio_id);
CREATE INDEX IF NOT EXISTS idx_hitos_a_liberar ON hitos (libera_en) WHERE estado = 'ENTREGADO';
-- Etapa 11, paso 5: quién resolvió la disputa (el admin de la plataforma). Aparte de
-- la tabla porque se sumó con las bases ya creadas.
ALTER TABLE hitos ADD COLUMN IF NOT EXISTS resuelto_por UUID REFERENCES profiles(id) ON DELETE SET NULL;

DROP TRIGGER IF EXISTS trg_hitos_espacio ON hitos;
CREATE TRIGGER trg_hitos_espacio
  BEFORE INSERT OR UPDATE ON hitos
  FOR EACH ROW EXECUTE FUNCTION public.espacio_desde_lead();

-- Lo que pasó con cada hito, en orden: es la línea de tiempo que ven las dos
-- partes y la cola de los correos (n8n marca correo_avisado_en tras Gmail).
CREATE TABLE IF NOT EXISTS hitos_eventos (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  hito_id    UUID NOT NULL REFERENCES hitos(id) ON DELETE CASCADE,
  lead_id    TEXT NOT NULL,
  tipo       TEXT NOT NULL CHECK (tipo IN (
               'fondeado','entregado','aprobado','liberado_solo','disputado','resuelto',
               'devuelto','anulado','transferido','reembolsado')),
  actor      TEXT NOT NULL CHECK (actor IN ('cliente','desarrollador','admin','plataforma')),
  detalle    TEXT,
  avisado_en TIMESTAMPTZ,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Correo y aviso son canales independientes. Se marca cada uno DESPUÉS de
-- entregarlo: una falla permite reintentar (semántica at-least-once). Si el
-- envío tuvo éxito pero falló el marcado, puede llegar un duplicado.
ALTER TABLE hitos_eventos ADD COLUMN IF NOT EXISTS correo_avisado_en TIMESTAMPTZ;
ALTER TABLE hitos_eventos ADD COLUMN IF NOT EXISTS aviso_avisado_en TIMESTAMPTZ;
UPDATE hitos_eventos SET correo_avisado_en = avisado_en, aviso_avisado_en = avisado_en
WHERE avisado_en IS NOT NULL AND (correo_avisado_en IS NULL OR aviso_avisado_en IS NULL);
CREATE INDEX IF NOT EXISTS idx_hitos_eventos_hito ON hitos_eventos (hito_id, creado_en);
CREATE INDEX IF NOT EXISTS idx_hitos_eventos_sin_avisar ON hitos_eventos (creado_en) WHERE avisado_en IS NULL;

-- ¿El proyecto llegó por la plataforma? Mismo criterio que calificar(): pasó
-- por la bolsa y quedó asignado al espacio que lo tiene.
CREATE OR REPLACE FUNCTION public.lead_de_plataforma(p_lead text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM bolsa_pedidos b JOIN leads l ON l.lead_id = b.lead_id
    WHERE b.lead_id = p_lead AND b.estado = 'ASIGNADO' AND b.asignado_espacio_id = l.espacio_id
  )
$$;

-- Quién es el que llama en un proyecto. Interna.
--   'desarrollador': el dueño del espacio del lead.
--   'cliente': quien trae el token de la página del proyecto, o la cuenta de
--              cliente que publicó el pedido en la bolsa.
--   'admin': el admin de la plataforma, si no es ninguno de los dos.
CREATE OR REPLACE FUNCTION public.proyecto_rol(p_lead text, p_token uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
           WHEN EXISTS (SELECT 1 FROM espacios e WHERE e.id = l.espacio_id AND e.dueno_id = auth.uid())
             THEN 'desarrollador'
           WHEN (p_token IS NOT NULL AND p_token = l.proyecto_token)
             OR EXISTS (SELECT 1 FROM bolsa_pedidos b WHERE b.lead_id = l.lead_id AND b.cliente_id = auth.uid())
             THEN 'cliente'
           WHEN EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
             THEN 'admin'
         END
  FROM leads l WHERE l.lead_id = p_lead
$$;

-- El desarrollador define cómo cobra, antes de que el cliente acepte:
-- p_hitos es un arreglo de {titulo, descripcion?, monto}. Vacío o NULL vuelve
-- a la factura única, salvo en los proyectos de la plataforma. Reemplaza los
-- hitos que hubiera (todavía no se pagó ninguno). Devuelve cuántos quedaron.
CREATE OR REPLACE FUNCTION public.definir_cobro(p_lead text, p_hitos jsonb)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  l leads%ROWTYPE;
  h jsonb;
  i int := 0;
  titulo text;
  monto text;
  pct numeric := coalesce(nullif(current_setting('app.comision_hitos', true), '')::numeric, 5);
BEGIN
  SELECT * INTO l FROM leads WHERE lead_id = p_lead FOR UPDATE;
  IF NOT FOUND OR proyecto_rol(p_lead, NULL) IS DISTINCT FROM 'desarrollador' THEN
    RAISE EXCEPTION 'No tenés acceso a este proyecto';
  END IF;
  IF l.estado <> 'NUEVO' OR l.propuesta_envio_intento_id IS NOT NULL
     OR l.propuesta_envio_iniciado_en IS NOT NULL THEN
    RAISE EXCEPTION 'La forma de cobro sólo se cambia antes de enviar la propuesta';
  END IF;

  IF p_hitos IS NULL OR jsonb_typeof(p_hitos) <> 'array' OR jsonb_array_length(p_hitos) = 0 THEN
    IF lead_de_plataforma(p_lead) THEN
      RAISE EXCEPTION 'Los proyectos que llegan por la plataforma se cobran por hitos';
    END IF;
    DELETE FROM hitos WHERE lead_id = p_lead;
    UPDATE leads SET cobro_modo = 'factura' WHERE lead_id = p_lead;
    RETURN 0;
  END IF;
  IF jsonb_array_length(p_hitos) > 10 THEN RAISE EXCEPTION 'Hasta 10 hitos por proyecto'; END IF;

  DELETE FROM hitos WHERE lead_id = p_lead;
  FOR h IN SELECT value FROM jsonb_array_elements(p_hitos) LOOP
    i := i + 1;
    titulo := btrim(coalesce(h->>'titulo', ''));
    monto := btrim(coalesce(h->>'monto', ''));
    IF length(titulo) NOT BETWEEN 3 AND 120 THEN
      RAISE EXCEPTION 'El hito % necesita un título de 3 a 120 caracteres', i;
    END IF;
    IF length(coalesce(h->>'descripcion', '')) > 1000 THEN
      RAISE EXCEPTION 'La descripción del hito % puede tener hasta 1000 caracteres', i;
    END IF;
    IF monto !~ '^\d{1,9}(\.\d{1,2})?$' OR monto::numeric < 1 THEN
      RAISE EXCEPTION 'El monto del hito % tiene que ser de al menos US$ 1, con hasta dos decimales', i;
    END IF;
    INSERT INTO hitos (lead_id, espacio_id, orden, titulo, descripcion, monto, comision_porcentaje)
    VALUES (p_lead, l.espacio_id, i, titulo, nullif(btrim(coalesce(h->>'descripcion', '')), ''), monto::numeric, pct);
  END LOOP;
  UPDATE leads SET cobro_modo = 'hitos' WHERE lead_id = p_lead;
  RETURN i;
END;
$$;

-- Cierra un hito repartiendo el monto y, si era el último abierto, cierra el
-- proyecto. Interna: la llaman las funciones de abajo con el hito bloqueado.
CREATE OR REPLACE FUNCTION public.hito_cerrar(
  p_hito uuid, p_liberado numeric, p_nota text, p_evento text, p_actor text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  h hitos%ROWTYPE;
BEGIN
  UPDATE hitos SET
    estado            = CASE WHEN p_liberado > 0 THEN 'LIBERADO' ELSE 'REEMBOLSADO' END::hito_estado,
    monto_liberado    = p_liberado,
    monto_reembolsado = monto - p_liberado,
    comision          = round(p_liberado * comision_porcentaje / 100, 2),
    resolucion_nota   = coalesce(nullif(btrim(coalesce(p_nota, '')), ''), resolucion_nota),
    libera_en         = NULL,
    cerrado_en        = now()
  WHERE id = p_hito
  RETURNING * INTO h;

  INSERT INTO hitos_eventos (hito_id, lead_id, tipo, actor, detalle)
  VALUES (h.id, h.lead_id, p_evento, p_actor, nullif(btrim(coalesce(p_nota, '')), ''));

  -- Con todos los hitos cerrados, el proyecto termina (y se puede calificar).
  IF NOT EXISTS (SELECT 1 FROM hitos WHERE lead_id = h.lead_id
                 AND estado NOT IN ('LIBERADO','REEMBOLSADO','ANULADO')) THEN
    UPDATE leads SET estado = 'CERRADO', estado_trabajo = 'ENTREGADO', fecha_cierre = now()
    WHERE lead_id = h.lead_id AND estado <> 'CERRADO';
  END IF;
END;
$$;

-- n8n, antes de crear la sesión de pago: valida el token y que se paguen en
-- orden (no se puede pagar el 2 sin haber pagado el 1), y devuelve lo que
-- necesita para cobrar. Sin filas = no se puede pagar.
CREATE OR REPLACE FUNCTION public.hito_para_cobrar(p_hito uuid, p_token uuid)
RETURNS TABLE (
  id uuid, lead_id text, orden smallint, titulo text, monto numeric,
  cliente_nombre text, cliente_email text, espacio_nombre text, servicio servicio_tipo
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT h.id, h.lead_id, h.orden, h.titulo, h.monto, l.nombre, l.email, e.nombre, l.servicio
  FROM hitos h
  JOIN leads l ON l.lead_id = h.lead_id
  JOIN espacios e ON e.id = h.espacio_id
  WHERE h.id = p_hito
    AND l.proyecto_token = p_token
    AND h.estado = 'PENDIENTE'
    AND l.estado = 'ACEPTADO'
    AND l.cobro_modo = 'hitos'
    AND NOT EXISTS (SELECT 1 FROM hitos a WHERE a.lead_id = h.lead_id AND a.orden < h.orden AND a.estado = 'PENDIENTE')
$$;

-- n8n, al confirmar Stripe el pago. Idempotente: el mismo pago dos veces no
-- hace nada. Si el hito se anuló mientras el cliente pagaba, queda para
-- reembolsar entero. Devuelve si aplicó algo.
CREATE OR REPLACE FUNCTION public.hito_fondeado(p_hito uuid, p_checkout text, p_pago text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  h hitos%ROWTYPE;
BEGIN
  SELECT * INTO h FROM hitos WHERE id = p_hito FOR UPDATE;
  IF NOT FOUND OR h.stripe_pago_id IS NOT NULL THEN RETURN false; END IF;

  IF h.estado = 'PENDIENTE' THEN
    UPDATE hitos SET estado = 'FONDEADO', stripe_checkout_id = p_checkout, stripe_pago_id = p_pago,
                     fondeado_en = now()
    WHERE id = p_hito;
    INSERT INTO hitos_eventos (hito_id, lead_id, tipo, actor) VALUES (h.id, h.lead_id, 'fondeado', 'cliente');
  ELSIF h.estado = 'ANULADO' THEN
    UPDATE hitos SET stripe_checkout_id = p_checkout, stripe_pago_id = p_pago, fondeado_en = now(),
                     estado = 'REEMBOLSADO', monto_reembolsado = monto, cerrado_en = now(),
                     resolucion_nota = 'Se pagó después de anulado: se devuelve entero'
    WHERE id = p_hito;
    INSERT INTO hitos_eventos (hito_id, lead_id, tipo, actor, detalle)
    VALUES (h.id, h.lead_id, 'devuelto', 'plataforma', 'Se pagó después de anulado');
  ELSE
    RETURN false;
  END IF;
  RETURN true;
END;
$$;

-- El desarrollador marca el hito como entregado y cuenta qué entregó. Desde
-- ahí corre el plazo para que se libere solo.
CREATE OR REPLACE FUNCTION public.entregar_hito(p_hito uuid, p_nota text)
RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  h hitos%ROWTYPE;
  dias int := coalesce(nullif(current_setting('app.hitos_dias_liberacion', true), '')::int, 7);
  plazo timestamptz;
BEGIN
  SELECT * INTO h FROM hitos WHERE id = p_hito FOR UPDATE;
  IF NOT FOUND OR proyecto_rol(h.lead_id, NULL) IS DISTINCT FROM 'desarrollador' THEN
    RAISE EXCEPTION 'No tenés acceso a este hito';
  END IF;
  IF h.estado <> 'FONDEADO' THEN RAISE EXCEPTION 'Sólo se entrega un hito pagado y sin entregar'; END IF;
  IF length(btrim(coalesce(p_nota, ''))) NOT BETWEEN 5 AND 2000 THEN
    RAISE EXCEPTION 'Contá qué entregaste (de 5 a 2000 caracteres)';
  END IF;

  plazo := now() + make_interval(days => dias);
  UPDATE hitos SET estado = 'ENTREGADO', entrega_nota = btrim(p_nota), entregado_en = now(), libera_en = plazo
  WHERE id = p_hito;
  INSERT INTO hitos_eventos (hito_id, lead_id, tipo, actor, detalle)
  VALUES (h.id, h.lead_id, 'entregado', 'desarrollador', btrim(p_nota));
  RETURN plazo;
END;
$$;

-- El cliente aprueba y libera la plata. Puede hacerlo también antes de la
-- entrega, si ya está conforme.
CREATE OR REPLACE FUNCTION public.aprobar_hito(p_hito uuid, p_token uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  h hitos%ROWTYPE;
BEGIN
  SELECT * INTO h FROM hitos WHERE id = p_hito FOR UPDATE;
  IF NOT FOUND OR proyecto_rol(h.lead_id, p_token) IS DISTINCT FROM 'cliente' THEN
    RAISE EXCEPTION 'No tenés acceso a este hito';
  END IF;
  IF h.estado NOT IN ('FONDEADO','ENTREGADO') THEN RAISE EXCEPTION 'Este hito no tiene nada para liberar'; END IF;
  PERFORM hito_cerrar(p_hito, h.monto, NULL, 'aprobado', 'cliente');
END;
$$;

-- El cliente disputa: la plata queda retenida (se corta el plazo de
-- liberación) hasta que el admin resuelva.
CREATE OR REPLACE FUNCTION public.disputar_hito(p_hito uuid, p_motivo text, p_token uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  h hitos%ROWTYPE;
BEGIN
  SELECT * INTO h FROM hitos WHERE id = p_hito FOR UPDATE;
  IF NOT FOUND OR proyecto_rol(h.lead_id, p_token) IS DISTINCT FROM 'cliente' THEN
    RAISE EXCEPTION 'No tenés acceso a este hito';
  END IF;
  IF h.estado NOT IN ('FONDEADO','ENTREGADO') THEN RAISE EXCEPTION 'Este hito no se puede disputar'; END IF;
  IF length(btrim(coalesce(p_motivo, ''))) NOT BETWEEN 10 AND 2000 THEN
    RAISE EXCEPTION 'Contá qué pasó (de 10 a 2000 caracteres)';
  END IF;

  UPDATE hitos SET estado = 'EN_DISPUTA', disputa_motivo = btrim(p_motivo), disputa_abierta_en = now(), libera_en = NULL
  WHERE id = p_hito;
  INSERT INTO hitos_eventos (hito_id, lead_id, tipo, actor, detalle)
  VALUES (h.id, h.lead_id, 'disputado', 'cliente', btrim(p_motivo));
END;
$$;

-- El desarrollador devuelve la plata entera (no puede o no quiere seguir, o
-- le da la razón al cliente en una disputa).
CREATE OR REPLACE FUNCTION public.devolver_hito(p_hito uuid, p_nota text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  h hitos%ROWTYPE;
BEGIN
  SELECT * INTO h FROM hitos WHERE id = p_hito FOR UPDATE;
  IF NOT FOUND OR proyecto_rol(h.lead_id, NULL) IS DISTINCT FROM 'desarrollador' THEN
    RAISE EXCEPTION 'No tenés acceso a este hito';
  END IF;
  IF h.estado NOT IN ('FONDEADO','ENTREGADO','EN_DISPUTA') THEN RAISE EXCEPTION 'Este hito no tiene plata para devolver'; END IF;
  PERFORM hito_cerrar(p_hito, 0, p_nota, 'devuelto', 'desarrollador');
END;
$$;

-- El desarrollador saca un hito que todavía no se pagó.
CREATE OR REPLACE FUNCTION public.anular_hito(p_hito uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  h hitos%ROWTYPE;
BEGIN
  SELECT * INTO h FROM hitos WHERE id = p_hito FOR UPDATE;
  IF NOT FOUND OR proyecto_rol(h.lead_id, NULL) IS DISTINCT FROM 'desarrollador' THEN
    RAISE EXCEPTION 'No tenés acceso a este hito';
  END IF;
  IF h.estado <> 'PENDIENTE' THEN RAISE EXCEPTION 'Sólo se anula un hito que todavía no se pagó'; END IF;

  UPDATE hitos SET estado = 'ANULADO', cerrado_en = now() WHERE id = p_hito;
  INSERT INTO hitos_eventos (hito_id, lead_id, tipo, actor) VALUES (h.id, h.lead_id, 'anulado', 'desarrollador');
  -- Si era lo único que quedaba abierto, el proyecto termina.
  IF NOT EXISTS (SELECT 1 FROM hitos WHERE lead_id = h.lead_id
                 AND estado NOT IN ('LIBERADO','REEMBOLSADO','ANULADO')) THEN
    UPDATE leads SET
      estado = CASE WHEN EXISTS (SELECT 1 FROM hitos WHERE lead_id = h.lead_id AND estado <> 'ANULADO')
                    THEN 'CERRADO' ELSE 'PERDIDO' END::lead_estado,
      fecha_cierre = now()
    WHERE lead_id = h.lead_id AND estado NOT IN ('CERRADO','PERDIDO');
  END IF;
END;
$$;

-- Corta con p_mensaje si quien llama no es el admin de la plataforma.
-- Interna: la usan las funciones de disputas.
CREATE OR REPLACE FUNCTION public.exigir_admin(p_mensaje text) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin') THEN
    RAISE EXCEPTION '%', p_mensaje;
  END IF;
END;
$$;

-- El admin de la plataforma resuelve una disputa: cuánto se libera al
-- desarrollador (0 = se reembolsa todo, el monto entero = se libera todo). No
-- puede resolver una disputa de un proyecto propio.
CREATE OR REPLACE FUNCTION public.resolver_disputa(p_hito uuid, p_liberar numeric, p_nota text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  h hitos%ROWTYPE;
BEGIN
  PERFORM exigir_admin('Sólo el admin de la plataforma resuelve disputas');
  SELECT * INTO h FROM hitos WHERE id = p_hito FOR UPDATE;
  IF NOT FOUND OR h.estado <> 'EN_DISPUTA' THEN RAISE EXCEPTION 'Este hito no está en disputa'; END IF;
  IF proyecto_rol(h.lead_id, NULL) = 'desarrollador' THEN
    RAISE EXCEPTION 'No podés resolver una disputa de un proyecto tuyo';
  END IF;
  IF p_liberar IS NULL OR p_liberar < 0 OR p_liberar > h.monto OR p_liberar <> round(p_liberar, 2) THEN
    RAISE EXCEPTION 'Lo que se libera tiene que estar entre 0 y el monto del hito';
  END IF;
  IF length(btrim(coalesce(p_nota, ''))) NOT BETWEEN 5 AND 2000 THEN
    RAISE EXCEPTION 'Explicá la resolución (de 5 a 2000 caracteres)';
  END IF;
  PERFORM hito_cerrar(p_hito, p_liberar, p_nota, 'resuelto', 'admin');
  UPDATE hitos SET resuelto_por = auth.uid() WHERE id = p_hito;
END;
$$;

-- Cron de n8n: libera las entregas que nadie aprobó ni disputó a tiempo.
-- Devuelve las que liberó (para avisar).
CREATE OR REPLACE FUNCTION public.liberar_vencidos()
RETURNS TABLE (id uuid, lead_id text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  h hitos%ROWTYPE;
BEGIN
  FOR h IN SELECT * FROM hitos WHERE estado = 'ENTREGADO' AND libera_en <= now() FOR UPDATE SKIP LOCKED LOOP
    PERFORM hito_cerrar(h.id, h.monto, NULL, 'liberado_solo', 'plataforma');
    id := h.id; lead_id := h.lead_id;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- Cron de n8n: lo que falta mover en Stripe. Una fila por movimiento.
--   'transferir': al desarrollador, lo liberado menos la comisión.
--   'reembolsar': al cliente, sobre el pago original.
DROP FUNCTION IF EXISTS public.hitos_por_mover();
CREATE OR REPLACE FUNCTION public.hitos_por_mover(p_configurado boolean)
RETURNS TABLE (
  id uuid, lead_id text, movimiento text, importe numeric, stripe_pago_id text,
  stripe_account_id text, espacio_nombre text, titulo text
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  fila record;
  transferir boolean;
  reembolsar boolean;
BEGIN
  IF p_configurado IS NOT TRUE THEN
    RAISE EXCEPTION 'Stripe no configurado: no se reclamaron movimientos';
  END IF;
  FOR fila IN
    SELECT h.*, e.stripe_account_id AS cuenta, e.nombre AS marca
    FROM hitos h JOIN espacios e ON e.id = h.espacio_id
    WHERE h.stripe_pago_id IS NOT NULL AND (
      (h.monto_liberado > 0 AND h.stripe_transfer_id IS NULL
       AND h.stripe_transfer_intentado_en IS NULL AND e.stripe_account_id IS NOT NULL)
      OR (h.monto_reembolsado > 0 AND h.stripe_reembolso_id IS NULL
          AND h.stripe_reembolso_intentado_en IS NULL))
    ORDER BY h.cerrado_en, h.id
    LIMIT 50 FOR UPDATE OF h SKIP LOCKED
  LOOP
    transferir := fila.monto_liberado > 0 AND fila.stripe_transfer_id IS NULL
      AND fila.stripe_transfer_intentado_en IS NULL AND fila.cuenta IS NOT NULL;
    reembolsar := fila.monto_reembolsado > 0 AND fila.stripe_reembolso_id IS NULL
      AND fila.stripe_reembolso_intentado_en IS NULL;
    UPDATE hitos h SET
      stripe_transfer_intentado_en = CASE WHEN transferir THEN now() ELSE h.stripe_transfer_intentado_en END,
      stripe_reembolso_intentado_en = CASE WHEN reembolsar THEN now() ELSE h.stripe_reembolso_intentado_en END
    WHERE h.id = fila.id;
    IF transferir THEN
      id := fila.id; lead_id := fila.lead_id; movimiento := 'transferir';
      importe := fila.monto_liberado - fila.comision; stripe_pago_id := fila.stripe_pago_id;
      stripe_account_id := fila.cuenta; espacio_nombre := fila.marca; titulo := fila.titulo;
      RETURN NEXT;
    END IF;
    IF reembolsar THEN
      id := fila.id; lead_id := fila.lead_id; movimiento := 'reembolsar';
      importe := fila.monto_reembolsado; stripe_pago_id := fila.stripe_pago_id;
      stripe_account_id := NULL; espacio_nombre := fila.marca; titulo := fila.titulo;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

-- n8n, después de mover la plata en Stripe. Idempotente.
CREATE OR REPLACE FUNCTION public.hito_movido(p_hito uuid, p_movimiento text, p_stripe_id text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  h hitos%ROWTYPE;
BEGIN
  IF p_movimiento = 'transferir' THEN
    UPDATE hitos SET stripe_transfer_id = p_stripe_id, transferido_en = now()
    WHERE id = p_hito AND monto_liberado > 0 AND stripe_transfer_id IS NULL
    RETURNING * INTO h;
  ELSIF p_movimiento = 'reembolsar' THEN
    UPDATE hitos SET stripe_reembolso_id = p_stripe_id, reembolsado_en = now()
    WHERE id = p_hito AND monto_reembolsado > 0 AND stripe_reembolso_id IS NULL
    RETURNING * INTO h;
  ELSE
    RAISE EXCEPTION 'Movimiento desconocido: %', p_movimiento;
  END IF;
  IF h.id IS NULL THEN RETURN false; END IF;

  INSERT INTO hitos_eventos (hito_id, lead_id, tipo, actor, detalle)
  VALUES (h.id, h.lead_id,
          CASE p_movimiento WHEN 'transferir' THEN 'transferido' ELSE 'reembolsado' END, 'plataforma',
          'US$ ' || CASE p_movimiento WHEN 'transferir' THEN h.monto_liberado - h.comision ELSE h.monto_reembolsado END);
  RETURN true;
END;
$$;

-- Lo que ve cada parte de un proyecto por hitos: el desarrollador y el
-- cliente con cuenta, por el lead; el cliente sin cuenta, por el token (con
-- p_lead NULL); el admin, para resolver disputas. `puede_pagar` marca el
-- hito que toca pagar.
CREATE OR REPLACE FUNCTION public.ver_proyecto(p_lead text, p_token uuid DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  l leads%ROWTYPE;
  rol text;
BEGIN
  IF p_lead IS NULL AND p_token IS NOT NULL THEN
    SELECT * INTO l FROM leads WHERE proyecto_token = p_token;
  ELSE
    SELECT * INTO l FROM leads WHERE lead_id = p_lead;
  END IF;
  rol := proyecto_rol(l.lead_id, p_token);
  IF rol IS NULL THEN RAISE EXCEPTION 'No tenés acceso a este proyecto'; END IF;

  RETURN json_build_object(
    'rol', rol,
    'lead_id', l.lead_id,
    'estado', l.estado,
    'cobro_modo', l.cobro_modo,
    'servicio', l.servicio,
    'cliente_nombre', split_part(btrim(l.nombre), ' ', 1),
    'espacio_nombre', (SELECT e.nombre FROM espacios e WHERE e.id = l.espacio_id),
    'alcance', l.alcance_propuesto,
    'plazo', l.plazo_propuesto,
    'de_plataforma', lead_de_plataforma(l.lead_id),
    'hitos', COALESCE((
      SELECT json_agg(json_build_object(
               'id', h.id, 'orden', h.orden, 'titulo', h.titulo, 'descripcion', h.descripcion,
               'monto', h.monto, 'estado', h.estado, 'comision_porcentaje', h.comision_porcentaje,
               'fondeado_en', h.fondeado_en, 'entrega_nota', h.entrega_nota, 'entregado_en', h.entregado_en,
               'libera_en', h.libera_en, 'disputa_motivo', h.disputa_motivo,
               'monto_liberado', h.monto_liberado, 'monto_reembolsado', h.monto_reembolsado,
               'comision', h.comision, 'resolucion_nota', h.resolucion_nota, 'cerrado_en', h.cerrado_en,
               'transferido_en', h.transferido_en, 'reembolsado_en', h.reembolsado_en,
               'puede_pagar', h.estado = 'PENDIENTE' AND l.estado = 'ACEPTADO'
                 AND NOT EXISTS (SELECT 1 FROM hitos a WHERE a.lead_id = h.lead_id AND a.orden < h.orden AND a.estado = 'PENDIENTE'),
               'eventos', COALESCE((
                 SELECT json_agg(json_build_object('tipo', ev.tipo, 'actor', ev.actor, 'detalle', ev.detalle,
                                                   'creado_en', ev.creado_en) ORDER BY ev.creado_en, ev.id)
                 FROM hitos_eventos ev WHERE ev.hito_id = h.id), '[]'::json))
             ORDER BY h.orden)
      FROM hitos h WHERE h.lead_id = l.lead_id
    ), '[]'::json)
  );
END;
$$;

-- Las disputas abiertas, para el admin de la plataforma. `puede_resolver`:
-- no es de un proyecto suyo (esas las ve, pero no las resuelve).
DROP FUNCTION IF EXISTS public.disputas_abiertas();
CREATE FUNCTION public.disputas_abiertas()
RETURNS TABLE (
  id uuid, lead_id text, titulo text, monto numeric, disputa_motivo text, disputa_abierta_en timestamptz,
  entrega_nota text, espacio_nombre text, cliente_nombre text, servicio servicio_tipo, puede_resolver boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM exigir_admin('Sólo el admin de la plataforma ve las disputas');
  RETURN QUERY
    SELECT h.id, h.lead_id, h.titulo, h.monto, h.disputa_motivo, h.disputa_abierta_en,
           h.entrega_nota, e.nombre, split_part(btrim(l.nombre), ' ', 1), l.servicio,
           e.dueno_id IS DISTINCT FROM auth.uid()
    FROM hitos h JOIN leads l ON l.lead_id = h.lead_id JOIN espacios e ON e.id = h.espacio_id
    WHERE h.estado = 'EN_DISPUTA'
    ORDER BY h.disputa_abierta_en;
END;
$$;

-- Las disputas ya cerradas, las últimas primero: las que resolvió el admin y
-- las que se cerraron antes porque el desarrollador devolvió la plata.
CREATE OR REPLACE FUNCTION public.disputas_resueltas(p_limite int DEFAULT 50)
RETURNS TABLE (
  id uuid, lead_id text, titulo text, monto numeric, disputa_motivo text,
  monto_liberado numeric, monto_reembolsado numeric, resolucion_nota text, cerrado_en timestamptz,
  cierre text, resuelto_por text, transferido_en timestamptz, reembolsado_en timestamptz,
  espacio_nombre text, cliente_nombre text, servicio servicio_tipo
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM exigir_admin('Sólo el admin de la plataforma ve las disputas');
  RETURN QUERY
    SELECT h.id, h.lead_id, h.titulo, h.monto, h.disputa_motivo,
           h.monto_liberado, h.monto_reembolsado, h.resolucion_nota, h.cerrado_en,
           (SELECT ev.tipo FROM hitos_eventos ev WHERE ev.hito_id = h.id AND ev.tipo IN ('resuelto','devuelto')
            ORDER BY ev.creado_en DESC, ev.id DESC LIMIT 1),
           (SELECT p.email FROM profiles p WHERE p.id = h.resuelto_por),
           h.transferido_en, h.reembolsado_en,
           e.nombre, split_part(btrim(l.nombre), ' ', 1), l.servicio
    FROM hitos h JOIN leads l ON l.lead_id = h.lead_id JOIN espacios e ON e.id = h.espacio_id
    WHERE h.estado IN ('LIBERADO','REEMBOLSADO')
      AND EXISTS (SELECT 1 FROM hitos_eventos ev WHERE ev.hito_id = h.id AND ev.tipo = 'disputado')
    ORDER BY h.cerrado_en DESC
    LIMIT least(greatest(coalesce(p_limite, 50), 1), 200);
END;
$$;

-- Todo lo que el admin necesita para decidir una disputa: el hito, el resto
-- de los hitos del proyecto, la línea de tiempo y la conversación entre las
-- partes (la de la postulación elegida; un cliente propio no tiene). Es el
-- único acceso del admin a mensajes ajenos y se limita a los proyectos con
-- un hito que se disputó.
CREATE OR REPLACE FUNCTION public.disputa_detalle(p_hito uuid)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  h hitos%ROWTYPE;
  l leads%ROWTYPE;
  e espacios%ROWTYPE;
BEGIN
  PERFORM exigir_admin('Sólo el admin de la plataforma ve las disputas');
  SELECT * INTO h FROM hitos WHERE hitos.id = p_hito;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM hitos_eventos ev WHERE ev.hito_id = h.id AND ev.tipo = 'disputado') THEN
    RAISE EXCEPTION 'Este hito no tuvo una disputa';
  END IF;
  SELECT * INTO l FROM leads WHERE leads.lead_id = h.lead_id;
  SELECT * INTO e FROM espacios WHERE espacios.id = h.espacio_id;

  RETURN json_build_object(
    'hito', json_build_object(
      'id', h.id, 'orden', h.orden, 'titulo', h.titulo, 'descripcion', h.descripcion,
      'monto', h.monto, 'estado', h.estado, 'comision_porcentaje', h.comision_porcentaje,
      'fondeado_en', h.fondeado_en, 'entrega_nota', h.entrega_nota, 'entregado_en', h.entregado_en,
      'disputa_motivo', h.disputa_motivo, 'disputa_abierta_en', h.disputa_abierta_en,
      'monto_liberado', h.monto_liberado, 'monto_reembolsado', h.monto_reembolsado,
      'comision', h.comision, 'resolucion_nota', h.resolucion_nota, 'cerrado_en', h.cerrado_en,
      'transferido_en', h.transferido_en, 'reembolsado_en', h.reembolsado_en,
      'resuelto_por', (SELECT p.email FROM profiles p WHERE p.id = h.resuelto_por)),
    'proyecto', json_build_object(
      'lead_id', l.lead_id, 'servicio', l.servicio, 'cliente_nombre', split_part(btrim(l.nombre), ' ', 1),
      'espacio_nombre', e.nombre,
      'espacio_slug', e.slug,
      'de_plataforma', lead_de_plataforma(l.lead_id),
      'hitos', (SELECT json_agg(json_build_object('orden', otro.orden, 'titulo', otro.titulo, 'monto', otro.monto,
                                                  'estado', otro.estado) ORDER BY otro.orden)
                FROM hitos otro WHERE otro.lead_id = h.lead_id)),
    'eventos', COALESCE((
      SELECT json_agg(json_build_object('tipo', ev.tipo, 'actor', ev.actor, 'detalle', ev.detalle,
                                        'creado_en', ev.creado_en) ORDER BY ev.creado_en, ev.id)
      FROM hitos_eventos ev WHERE ev.hito_id = h.id), '[]'::json),
    'mensajes', COALESCE((
      SELECT json_agg(json_build_object('autor', m.autor, 'texto', m.texto, 'creado_en', m.creado_en)
                      ORDER BY m.creado_en, m.id)
      FROM mensajes m
      JOIN postulaciones po ON po.id = m.postulacion_id
      JOIN bolsa_pedidos b ON b.id = po.pedido_id
      WHERE b.lead_id = h.lead_id AND po.espacio_id = h.espacio_id), '[]'::json),
    -- Una disputa de un proyecto propio no la resuelve el admin.
    'puede_resolver', h.estado = 'EN_DISPUTA' AND e.dueno_id IS DISTINCT FROM auth.uid()
  );
END;
$$;

-- Permisos. Las internas (proyecto_rol, hito_cerrar, exigir_admin) no se exponen.
REVOKE ALL ON FUNCTION public.lead_de_plataforma(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.proyecto_rol(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.definir_cobro(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hito_cerrar(uuid, numeric, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.exigir_admin(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hito_para_cobrar(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hito_fondeado(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.entregar_hito(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aprobar_hito(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.disputar_hito(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.devolver_hito(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.anular_hito(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolver_disputa(uuid, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.liberar_vencidos() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hitos_por_mover(boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hito_movido(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ver_proyecto(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.disputas_abiertas() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.disputas_resueltas(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.disputa_detalle(uuid) FROM PUBLIC;
-- El desarrollador, desde el panel.
GRANT EXECUTE ON FUNCTION public.definir_cobro(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.entregar_hito(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.devolver_hito(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.anular_hito(uuid) TO authenticated;
-- El cliente, con cuenta o con el token del enlace.
GRANT EXECUTE ON FUNCTION public.aprobar_hito(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.disputar_hito(uuid, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ver_proyecto(text, uuid) TO anon, authenticated;
-- El admin.
GRANT EXECUTE ON FUNCTION public.resolver_disputa(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.disputas_abiertas() TO authenticated;
GRANT EXECUTE ON FUNCTION public.disputas_resueltas(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.disputa_detalle(uuid) TO authenticated;
-- n8n: cobra, libera las vencidas y mueve la plata.
GRANT EXECUTE ON FUNCTION public.lead_de_plataforma(text) TO n8n_writer;
GRANT EXECUTE ON FUNCTION public.hito_para_cobrar(uuid, uuid) TO n8n_writer;
GRANT EXECUTE ON FUNCTION public.hito_fondeado(uuid, text, text) TO n8n_writer;
GRANT EXECUTE ON FUNCTION public.liberar_vencidos() TO n8n_writer;
GRANT EXECUTE ON FUNCTION public.hitos_por_mover(boolean) TO n8n_writer;
GRANT EXECUTE ON FUNCTION public.hito_movido(uuid, text, text) TO n8n_writer;

ALTER TABLE hitos ENABLE ROW LEVEL SECURITY;
ALTER TABLE hitos FORCE ROW LEVEL SECURITY;
ALTER TABLE hitos_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE hitos_eventos FORCE ROW LEVEL SECURITY;
REVOKE ALL ON hitos, hitos_eventos FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hitos, hitos_eventos TO service_role;
-- El desarrollador lee los hitos de su espacio directo (panel y tiempo
-- real); escribir, sólo por las funciones.
GRANT SELECT ON hitos TO authenticated;
DROP POLICY IF EXISTS hitos_select_espacio ON hitos;
CREATE POLICY hitos_select_espacio ON hitos
  FOR SELECT TO authenticated
  USING (espacio_id IN (SELECT id FROM espacios WHERE dueno_id = (SELECT auth.uid())));
-- n8n: lee todo y sólo actualiza las columnas de reserva/URL de Checkout.
GRANT SELECT, UPDATE (stripe_checkout_id, stripe_checkout_reservado_en, stripe_checkout_intento_id, stripe_checkout_url, stripe_checkout_expira_en) ON hitos TO n8n_writer;
DROP POLICY IF EXISTS hitos_select_n8n_writer ON hitos;
CREATE POLICY hitos_select_n8n_writer ON hitos FOR SELECT TO n8n_writer USING (true);
DROP POLICY IF EXISTS hitos_update_n8n_writer ON hitos;
CREATE POLICY hitos_update_n8n_writer ON hitos FOR UPDATE TO n8n_writer USING (true) WITH CHECK (true);
-- correo_avisado_en confirma Gmail; aviso_avisado_en confirma la persistencia
-- en avisos (panel), no la entrega opcional de Telegram/Gmail del subflujo.
GRANT SELECT, UPDATE (avisado_en, correo_avisado_en, aviso_avisado_en) ON hitos_eventos TO n8n_writer;
DROP POLICY IF EXISTS hitos_eventos_select_n8n_writer ON hitos_eventos;
CREATE POLICY hitos_eventos_select_n8n_writer ON hitos_eventos FOR SELECT TO n8n_writer USING (true);
DROP POLICY IF EXISTS hitos_eventos_update_n8n_writer ON hitos_eventos;
CREATE POLICY hitos_eventos_update_n8n_writer ON hitos_eventos FOR UPDATE TO n8n_writer USING (true) WITH CHECK (true);

-- Tiempo real: el panel ve al instante cuando el cliente paga o aprueba.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'hitos') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.hitos;
  END IF;
END $$;

-- =====================================================================
-- Al final del archivo: usa reputacion() (sección 9) y leads.proyecto_token
-- (sección 12), que en una base nueva todavía no existen más arriba.
-- =====================================================================
-- Los proyectos del cliente con sesión, con sus postulaciones (lo mismo que
-- ve en /elegir: marca del espacio, mensaje, precio y plazo) y a quién eligió.
-- `eleccion_token` es el del propio cliente: con él elige desde su panel por
-- el mismo webhook que el enlace del correo. `proyecto_token` (etapa 11): el
-- de la página del proyecto ya asignado.
DROP FUNCTION IF EXISTS public.mis_proyectos();
CREATE FUNCTION public.mis_proyectos()
RETURNS TABLE (
  id uuid, titulo text, resumen text, servicio servicio_tipo, urgencia urgencia_tipo,
  presupuesto_rango text, estado bolsa_estado, postulaciones int, tope_postulaciones int,
  publicado_en timestamptz, vence_en timestamptz, elegido_nombre text, detalle json,
  eleccion_token uuid, proyecto_token uuid
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.id, b.titulo, b.resumen, b.servicio, b.urgencia, b.presupuesto_rango, b.estado,
         b.postulaciones, b.tope_postulaciones, b.publicado_en, b.vence_en,
         (SELECT e.nombre FROM espacios e WHERE e.id = b.asignado_espacio_id),
         COALESCE((
           SELECT json_agg(json_build_object(
                    'id', p.id, 'espacio', e.nombre, 'mensaje', p.mensaje,
                    'precio', p.precio_estimado, 'plazo', p.plazo,
                    'slug', e.slug, 'promedio', r.promedio, 'calificaciones', r.cantidad,
                    'elegida', p.espacio_id IS NOT DISTINCT FROM b.asignado_espacio_id)
                  ORDER BY p.creado_en)
           FROM postulaciones p JOIN espacios e ON e.id = p.espacio_id
           CROSS JOIN LATERAL reputacion(e.id) r
           WHERE p.pedido_id = b.id
         ), '[]'::json),
         b.eleccion_token,
         -- Etapa 11: la página del proyecto elegido, donde paga los hitos.
         (SELECT l.proyecto_token FROM leads l WHERE l.lead_id = b.lead_id)
  FROM bolsa_pedidos b
  WHERE b.cliente_id = auth.uid()
  ORDER BY b.publicado_en DESC
$$;
REVOKE ALL ON FUNCTION public.mis_proyectos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mis_proyectos() TO authenticated;
