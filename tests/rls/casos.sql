-- Casos de verificación de la RLS descrita en §4.6 y el Anexo C.
--
-- Cada caso asume un rol (anon / authenticated con o sin rol admin /
-- service_role), intenta una operación y registra si el resultado coincide con
-- lo que el modelo de seguridad promete. Un error de permisos NO es una falla
-- del test: en la mayoría de los casos es justamente el resultado esperado.

\set ON_ERROR_STOP on

-- ── Datos de prueba ────────────────────────────────────────────────────────
-- Dos desarrolladores con la cuenta confirmada, cada uno con su espacio (lo
-- crea el trigger al confirmar), y una cuenta sin confirmar, que no tiene.
-- 1111 es además el admin de la plataforma: el rol no le da acceso a nada
-- ajeno, sólo decide a qué espacio van los leads que llegan sin espacio
-- (transitorio, ver leads_espacio_por_defecto).
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('11111111-1111-4111-8111-111111111111', 'admin@gmail.com', now()),
  ('22222222-2222-4222-8222-222222222222', 'pepe@gmail.com', now()),
  ('66666666-6666-4666-8666-666666666666', 'sin-confirmar@gmail.com', NULL)
ON CONFLICT (id) DO NOTHING;

-- El trigger handle_new_user ya creó los profiles; nos aseguramos de los roles.
UPDATE profiles SET role = 'admin' WHERE email = 'admin@gmail.com';
UPDATE profiles SET role = 'user'  WHERE email = 'pepe@gmail.com';

INSERT INTO leads (lead_id, espacio_id, nombre, email, presupuesto, urgencia, servicio, estado, score, tier)
VALUES ('LD-TEST-0001', (SELECT id FROM espacios WHERE dueno_id = '11111111-1111-4111-8111-111111111111'),
        'Cliente de prueba', 'cliente@test.com', 5000, 'alta', 'ecommerce', 'NUEVO', 90, 'HOT'),
       ('LD-PEPE-0001', (SELECT id FROM espacios WHERE dueno_id = '22222222-2222-4222-8222-222222222222'),
        'Cliente de Pepe', 'otro@test.com', 1000, 'media', 'desarrollo_web', 'NUEVO', 40, 'WARM')
ON CONFLICT (lead_id) DO NOTHING;

INSERT INTO facturas (factura_id, lead_id, cliente, email, monto, fecha_vencimiento)
VALUES ('FAC-TEST-0001', 'LD-TEST-0001', 'Cliente de prueba', 'cliente@test.com', 5000, now() + interval '10 days')
ON CONFLICT (factura_id) DO NOTHING;

INSERT INTO logs (workflow, lead_id, evento, nivel, detalle)
VALUES ('test', 'LD-TEST-0001', 'alta', 'INFO', 'fila de prueba')
ON CONFLICT DO NOTHING;

CREATE TEMP TABLE resultados (
  n serial, caso text, esperado text, obtenido text, ok boolean
);

-- ── Motor de casos ─────────────────────────────────────────────────────────
-- Corre `consulta` bajo `rol` (y opcionalmente como el usuario `uid`),
-- capturando el error de permisos como un resultado más.
CREATE OR REPLACE FUNCTION probar(
  caso text, rol text, uid text, consulta text, esperado text
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  obtenido text;
  filas bigint;
BEGIN
  BEGIN
    EXECUTE format('SET LOCAL ROLE %I', rol);
    IF uid IS NOT NULL THEN
      EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', uid)::text);
    ELSE
      SET LOCAL request.jwt.claims = '';
    END IF;

    EXECUTE consulta INTO filas;
    obtenido := filas || ' filas';
  EXCEPTION
    WHEN insufficient_privilege THEN obtenido := 'permiso denegado';
    WHEN others THEN obtenido := 'error: ' || SQLERRM;
  END;

  RESET ROLE;
  INSERT INTO resultados (caso, esperado, obtenido, ok) VALUES (caso, esperado, obtenido, obtenido = esperado);
END $$;

-- Los `SELECT probar(...)` no tienen salida útil: silenciamos hasta el reporte.
\o /dev/null

-- ── 1. El público (anon) no accede a nada de negocio ───────────────────────
SELECT probar('anon NO puede leer leads',                'anon', NULL, 'SELECT count(*) FROM leads',               'permiso denegado');
SELECT probar('anon NO puede leer facturas',             'anon', NULL, 'SELECT count(*) FROM facturas',            'permiso denegado');
SELECT probar('anon NO puede leer logs',                 'anon', NULL, 'SELECT count(*) FROM logs',                'permiso denegado');
SELECT probar('anon NO puede leer profiles',             'anon', NULL, 'SELECT count(*) FROM profiles',            'permiso denegado');
SELECT probar('anon NO puede leer metrics_mensuales',    'anon', NULL, 'SELECT count(*) FROM metrics_mensuales',   'permiso denegado');
SELECT probar('anon NO puede leer facturas_pendientes',  'anon', NULL, 'SELECT count(*) FROM facturas_pendientes', 'permiso denegado');

-- ── 2. Cada desarrollador ve sólo lo de su espacio ─────────────────────────
SELECT probar('Pepe ve sólo su lead, no el del otro espacio',  'authenticated', '22222222-2222-4222-8222-222222222222', 'SELECT count(*) FROM leads',            '1 filas');
SELECT probar('Pepe NO ve el lead del otro espacio por su id', 'authenticated', '22222222-2222-4222-8222-222222222222', 'SELECT count(*) FROM leads WHERE lead_id = ''LD-TEST-0001''', '0 filas');
SELECT probar('Pepe NO ve las facturas del otro espacio',      'authenticated', '22222222-2222-4222-8222-222222222222', 'SELECT count(*) FROM facturas',         '0 filas');
SELECT probar('las métricas de Pepe son sólo las suyas',       'authenticated', '22222222-2222-4222-8222-222222222222', 'SELECT sum(total_leads)::bigint FROM metrics_mensuales', '1 filas');
SELECT probar('una cuenta sin confirmar no tiene espacio ni ve leads', 'authenticated', '66666666-6666-4666-8666-666666666666', 'SELECT count(*) FROM leads', '0 filas');
SELECT probar('una cuenta sin confirmar no ve métricas',       'authenticated', '66666666-6666-4666-8666-666666666666', 'SELECT count(*) FROM metrics_mensuales', '0 filas');

-- ── 3. El dueño lee el tablero de su espacio ───────────────────────────────
SELECT probar('admin lee leads (sólo los de su espacio)', 'authenticated', '11111111-1111-4111-8111-111111111111', 'SELECT count(*) FROM leads',               '1 filas');
SELECT probar('admin lee facturas',             'authenticated', '11111111-1111-4111-8111-111111111111', 'SELECT count(*) FROM facturas',            '1 filas');
SELECT probar('admin lee facturas_pendientes',  'authenticated', '11111111-1111-4111-8111-111111111111', 'SELECT count(*) FROM facturas_pendientes', '1 filas');
SELECT probar('admin lee las métricas',         'authenticated', '11111111-1111-4111-8111-111111111111', 'SELECT count(*) FROM metrics_mensuales',   '1 filas');

-- ── 4. La auditoría no se expone al tablero, ni siquiera al admin ──────────
SELECT probar('el admin NO puede leer logs (auditoría cerrada)', 'authenticated', '11111111-1111-4111-8111-111111111111', 'SELECT count(*) FROM logs', 'permiso denegado');

-- ── 5. Nadie escribe desde el navegador: no hay políticas de escritura ─────
SELECT probar('el admin NO puede modificar un lead',   'authenticated', '11111111-1111-4111-8111-111111111111', 'WITH x AS (UPDATE leads SET nombre = ''hackeado'' WHERE lead_id = ''LD-TEST-0001'' RETURNING 1) SELECT count(*) FROM x', 'permiso denegado');
SELECT probar('el admin NO puede insertar un lead',    'authenticated', '11111111-1111-4111-8111-111111111111', 'WITH x AS (INSERT INTO leads (lead_id, nombre, email) VALUES (''LD-HACK'', ''h'', ''h@h.com'') RETURNING 1) SELECT count(*) FROM x', 'permiso denegado');
SELECT probar('el admin NO puede borrar un lead',      'authenticated', '11111111-1111-4111-8111-111111111111', 'WITH x AS (DELETE FROM leads WHERE lead_id = ''LD-TEST-0001'' RETURNING 1) SELECT count(*) FROM x', 'permiso denegado');

-- ── 6. Escalada de privilegios: nadie se auto-asciende a admin ─────────────
SELECT probar('un usuario NO puede darse el rol admin', 'authenticated', '22222222-2222-4222-8222-222222222222', 'WITH x AS (UPDATE profiles SET role = ''admin'' WHERE id = auth.uid() RETURNING 1) SELECT count(*) FROM x', 'permiso denegado');

-- ── 7. profiles: cada uno ve sólo su propia fila ───────────────────────────
SELECT probar('un usuario ve sólo su propio profile',   'authenticated', '22222222-2222-4222-8222-222222222222', 'SELECT count(*) FROM profiles', '1 filas');
SELECT probar('el admin también ve sólo su propio profile', 'authenticated', '11111111-1111-4111-8111-111111111111', 'SELECT count(*) FROM profiles', '1 filas');

-- ── 8. service_role (n8n) escribe y lee todo: evade la RLS por diseño ──────
SELECT probar('service_role lee los leads de todos los espacios', 'service_role', NULL, 'SELECT count(*) FROM leads', '2 filas');
SELECT probar('service_role lee logs',       'service_role', NULL, 'SELECT count(*) FROM logs',  '1 filas');
SELECT probar('service_role puede escribir', 'service_role', NULL, 'WITH x AS (UPDATE leads SET notas = ''ok'' WHERE lead_id = ''LD-TEST-0001'' RETURNING 1) SELECT count(*) FROM x', '1 filas');

-- ── 9. Sin sesión, `authenticated` no ve nada (auth.uid() nulo) ────────────
SELECT probar('authenticated sin JWT ve 0 leads', 'authenticated', NULL, 'SELECT count(*) FROM leads', '0 filas');

-- ── 10. n8n_writer: el rol acotado que usa la conexión de n8n (S4, §4.6) ───
-- A diferencia de `service_role` (caso 8), este rol NO tiene BYPASSRLS: si
-- puede leer y escribir, es porque las políticas de la sección 5.1 de
-- db/schema.sql se lo permiten, no porque la RLS lo esté ignorando.
SELECT probar('n8n_writer inserta un lead',
  'n8n_writer', NULL,
  'WITH x AS (INSERT INTO leads (lead_id, nombre, email) VALUES (''LD-N8NW-0001'', ''Prueba n8n_writer'', ''n8nwriter@test.com'') RETURNING 1) SELECT count(*) FROM x',
  '1 filas');
SELECT probar('n8n_writer actualiza el lead que acaba de insertar',
  'n8n_writer', NULL,
  'WITH x AS (UPDATE leads SET notas = ''actualizado por n8n_writer'' WHERE lead_id = ''LD-N8NW-0001'' RETURNING 1) SELECT count(*) FROM x',
  '1 filas');
SELECT probar('n8n_writer lee los leads de todos los espacios',
  'n8n_writer', NULL, 'SELECT count(*) FROM leads', '3 filas');
SELECT probar('un lead que llega sin espacio va al del admin (transitorio, hasta /f/<slug>)',
  'service_role', NULL,
  'SELECT count(*) FROM leads l JOIN espacios e ON e.id = l.espacio_id WHERE l.lead_id = ''LD-N8NW-0001'' AND e.dueno_id = ''11111111-1111-4111-8111-111111111111''',
  '1 filas');
SELECT probar('n8n_writer lee logs',
  'n8n_writer', NULL, 'SELECT count(*) FROM logs', '1 filas');
SELECT probar('n8n_writer inserta en logs',
  'n8n_writer', NULL,
  'WITH x AS (INSERT INTO logs (workflow, evento, nivel, detalle) VALUES (''test'', ''prueba_n8n_writer'', ''INFO'', ''fila de prueba'') RETURNING 1) SELECT count(*) FROM x',
  '1 filas');
SELECT probar('n8n_writer lee facturas_pendientes (vista security_invoker)',
  'n8n_writer', NULL, 'SELECT count(*) FROM facturas_pendientes', '1 filas');
SELECT probar('n8n_writer NO puede borrar un lead: sin GRANT DELETE',
  'n8n_writer', NULL,
  'WITH x AS (DELETE FROM leads WHERE lead_id = ''LD-N8NW-0001'' RETURNING 1) SELECT count(*) FROM x',
  'permiso denegado');
SELECT probar('n8n_writer NO puede leer profiles',
  'n8n_writer', NULL, 'SELECT count(*) FROM profiles', 'permiso denegado');
SELECT probar('n8n_writer NO puede leer auth.users: sin USAGE sobre el esquema auth',
  'n8n_writer', NULL, 'SELECT count(*) FROM auth.users', 'permiso denegado');

-- ── 11. n8n_writer también escribe facturas, no sólo leads/logs ────────────
SELECT probar('n8n_writer inserta una factura',
  'n8n_writer', NULL,
  'WITH x AS (INSERT INTO facturas (factura_id, lead_id, cliente, email, monto, fecha_vencimiento) VALUES (''FAC-N8NW-0001'', ''LD-TEST-0001'', ''Cliente de prueba'', ''cliente@test.com'', 1000, now() + interval ''5 days'') RETURNING 1) SELECT count(*) FROM x',
  '1 filas');
SELECT probar('n8n_writer actualiza la factura que acaba de insertar',
  'n8n_writer', NULL,
  'WITH x AS (UPDATE facturas SET estado_pago = ''COBRADO'' WHERE factura_id = ''FAC-N8NW-0001'' RETURNING 1) SELECT count(*) FROM x',
  '1 filas');

-- ── 12. anon no escribe nada, no sólo "no lee" ─────────────────────────────
SELECT probar('anon NO puede insertar un lead',
  'anon', NULL,
  'WITH x AS (INSERT INTO leads (lead_id, nombre, email) VALUES (''LD-ANON-HACK'', ''h'', ''h@h.com'') RETURNING 1) SELECT count(*) FROM x',
  'permiso denegado');
SELECT probar('anon NO puede actualizar un lead',
  'anon', NULL,
  'WITH x AS (UPDATE leads SET nombre = ''hackeado'' WHERE lead_id = ''LD-TEST-0001'' RETURNING 1) SELECT count(*) FROM x',
  'permiso denegado');
SELECT probar('anon NO puede borrar un lead',
  'anon', NULL,
  'WITH x AS (DELETE FROM leads WHERE lead_id = ''LD-TEST-0001'' RETURNING 1) SELECT count(*) FROM x',
  'permiso denegado');

-- ── 13. La RLS está habilitada Y forzada en las 14 tablas de negocio ───────
-- No alcanza con que cada caso de arriba dé el resultado esperado: si a una
-- tabla nueva se le olvida `ENABLE`/`FORCE ROW LEVEL SECURITY`, este es el
-- único caso que lo detecta directo contra el catálogo, sin depender de que
-- alguien se acuerde de sumarle sus propios casos de permisos.
SELECT probar('las 14 tablas de negocio tienen RLS habilitada y forzada',
  'service_role', NULL,
  'SELECT count(*) FROM pg_class WHERE relname IN (''leads'',''facturas'',''seguimientos'',''logs'',''profiles'',''rate_limit_log'',''admin_emails'',''tickets'',''espacios'',''avisos'',''bolsa_pedidos'',''postulaciones'',''calificaciones'',''mensajes'') AND relrowsecurity AND relforcerowsecurity',
  '14 filas');

-- ── 14. seguimientos: mismo patrón de acceso que facturas ──────────────────
SELECT probar('n8n_writer inserta un seguimiento',
  'n8n_writer', NULL,
  'WITH x AS (INSERT INTO seguimientos (lead_id, numero, canal) VALUES (''LD-TEST-0001'', 1, ''email'') RETURNING 1) SELECT count(*) FROM x',
  '1 filas');
SELECT probar('admin lee seguimientos',
  'authenticated', '11111111-1111-4111-8111-111111111111', 'SELECT count(*) FROM seguimientos', '1 filas');
SELECT probar('Pepe NO ve los seguimientos del otro espacio',
  'authenticated', '22222222-2222-4222-8222-222222222222', 'SELECT count(*) FROM seguimientos', '0 filas');
SELECT probar('anon NO puede leer seguimientos',
  'anon', NULL, 'SELECT count(*) FROM seguimientos', 'permiso denegado');

-- ── 15. rate_limit_log: sólo n8n_writer (S1) y service_role, nadie más ─────
SELECT probar('n8n_writer inserta en rate_limit_log',
  'n8n_writer', NULL,
  'WITH x AS (INSERT INTO rate_limit_log (ip_o_clave, ruta) VALUES (''127.0.0.1'', ''lead/nuevo'') RETURNING 1) SELECT count(*) FROM x',
  '1 filas');
SELECT probar('n8n_writer lee rate_limit_log',
  'n8n_writer', NULL, 'SELECT count(*) FROM rate_limit_log', '1 filas');
SELECT probar('n8n_writer NO puede borrar de rate_limit_log: sin GRANT DELETE',
  'n8n_writer', NULL,
  'WITH x AS (DELETE FROM rate_limit_log WHERE ip_o_clave = ''127.0.0.1'' RETURNING 1) SELECT count(*) FROM x',
  'permiso denegado');
SELECT probar('el admin NO puede leer rate_limit_log: no es parte del tablero',
  'authenticated', '11111111-1111-4111-8111-111111111111', 'SELECT count(*) FROM rate_limit_log', 'permiso denegado');
SELECT probar('anon NO puede leer rate_limit_log',
  'anon', NULL, 'SELECT count(*) FROM rate_limit_log', 'permiso denegado');

-- ── 16. Registro solo-teléfono (F1.2) y promoción a admin vía admin_emails ─
-- El registro solo-teléfono se hace con el rol de conexión de este script
-- (no con `probar()`, que cambiaría de rol): igual que las dos filas de
-- auth.users del principio del archivo.
INSERT INTO auth.users (id, email) VALUES ('33333333-3333-4333-8333-333333333333', NULL);
SELECT probar('un registro solo-teléfono (email NULL) sí obtiene su fila en profiles',
  'service_role', NULL,
  'SELECT count(*) FROM profiles WHERE id = ''33333333-3333-4333-8333-333333333333''',
  '1 filas');
SELECT probar('el registro solo-teléfono queda con rol user, no admin',
  'service_role', NULL,
  'SELECT count(*) FROM profiles WHERE id = ''33333333-3333-4333-8333-333333333333'' AND role = ''user''',
  '1 filas');

INSERT INTO admin_emails (email) VALUES ('nuevo-admin@test.com'), ('confirma-despues@test.com') ON CONFLICT DO NOTHING;
-- Con "Confirm email" desactivado, Supabase trae email_confirmed_at en el INSERT.
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ('44444444-4444-4444-8444-444444444444', 'nuevo-admin@test.com', now());
SELECT probar('handle_new_user promueve a admin sólo por estar en admin_emails, sin tocar profiles a mano',
  'service_role', NULL,
  'SELECT count(*) FROM profiles WHERE id = ''44444444-4444-4444-8444-444444444444'' AND role = ''admin''',
  '1 filas');

-- ── 16.1 La whitelist no alcanza sin probar que el email es propio ─────────
SELECT probar('el esquema no trae ningún admin precargado (antes: admin@gmail.com)',
  'service_role', NULL, 'SELECT count(*) FROM admin_emails WHERE email = ''admin@gmail.com''', '0 filas');

INSERT INTO auth.users (id, email) VALUES ('55555555-5555-4555-8555-555555555555', 'confirma-despues@test.com');
SELECT probar('un email de la whitelist SIN confirmar queda como user',
  'service_role', NULL,
  'SELECT count(*) FROM profiles WHERE id = ''55555555-5555-4555-8555-555555555555'' AND role = ''user''',
  '1 filas');

UPDATE auth.users SET email_confirmed_at = now() WHERE id = '55555555-5555-4555-8555-555555555555';
SELECT probar('al confirmar el email, pasa a admin',
  'service_role', NULL,
  'SELECT count(*) FROM profiles WHERE id = ''55555555-5555-4555-8555-555555555555'' AND role = ''admin''',
  '1 filas');

UPDATE profiles SET role = 'user' WHERE id = '55555555-5555-4555-8555-555555555555';
UPDATE auth.users SET email_confirmed_at = now() + interval '1 second' WHERE id = '55555555-5555-4555-8555-555555555555';
SELECT probar('un admin bajado a mano no vuelve a subir por otro cambio de la cuenta',
  'service_role', NULL,
  'SELECT count(*) FROM profiles WHERE id = ''55555555-5555-4555-8555-555555555555'' AND role = ''user''',
  '1 filas');

-- ── 16.2 Tickets: el tablero escribe, pero sólo en su espacio ─────────────
INSERT INTO tickets (id, titulo) VALUES ('99999999-9999-4999-8999-999999999999', 'Ticket de prueba');
SELECT probar('anon NO puede leer tickets', 'anon', NULL, 'SELECT count(*) FROM tickets', 'permiso denegado');
SELECT probar('anon NO puede leer tickets_tablero', 'anon', NULL, 'SELECT count(*) FROM tickets_tablero', 'permiso denegado');
SELECT probar('Pepe no ve los tickets del otro espacio',
  'authenticated', '22222222-2222-4222-8222-222222222222', 'SELECT count(*) FROM tickets_tablero', '0 filas');
SELECT probar('una cuenta sin espacio NO puede crear tickets',
  'authenticated', '66666666-6666-4666-8666-666666666666',
  'WITH x AS (INSERT INTO tickets (titulo) VALUES (''intruso'') RETURNING 1) SELECT count(*) FROM x', 'permiso denegado');
SELECT probar('Pepe NO puede mover los tickets del otro espacio (0 filas afectadas)',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  'WITH x AS (UPDATE tickets SET estado = ''HECHO'' RETURNING 1) SELECT count(*) FROM x', '0 filas');
SELECT probar('Pepe crea un ticket y queda en su espacio',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  'WITH x AS (INSERT INTO tickets (titulo) VALUES (''de Pepe'') RETURNING espacio_id) SELECT count(*) FROM x JOIN espacios e ON e.id = x.espacio_id WHERE e.dueno_id = auth.uid()', '1 filas');
SELECT probar('Pepe NO puede colgar un ticket del lead de otro espacio',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  'WITH x AS (INSERT INTO tickets (titulo, lead_id) VALUES (''colado'', ''LD-TEST-0001'') RETURNING 1) SELECT count(*) FROM x', 'permiso denegado');
-- El id del espacio ajeno se arma acá afuera, como postgres: Pepe no podría
-- leerlo, pero alguien podría adivinarlo o haberlo visto.
SELECT probar('Pepe NO puede crear un ticket en el espacio de otro',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  format('WITH x AS (INSERT INTO tickets (titulo, espacio_id) VALUES (''colado'', %L) RETURNING 1) SELECT count(*) FROM x',
         (SELECT id FROM espacios WHERE dueno_id = '11111111-1111-4111-8111-111111111111')),
  'permiso denegado');
SELECT probar('Pepe NO puede llevarse su ticket a otro espacio',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  'WITH x AS (UPDATE tickets SET lead_id = ''LD-TEST-0001'' WHERE titulo = ''de Pepe'' RETURNING 1) SELECT count(*) FROM x', 'permiso denegado');
SELECT probar('el admin ve los tickets en el tablero',
  'authenticated', '11111111-1111-4111-8111-111111111111', 'SELECT count(*) FROM tickets_tablero', '1 filas');
SELECT probar('el admin puede crear un ticket',
  'authenticated', '11111111-1111-4111-8111-111111111111',
  'WITH x AS (INSERT INTO tickets (titulo) VALUES (''desde el tablero'') RETURNING 1) SELECT count(*) FROM x', '1 filas');
SELECT probar('el admin puede mover un ticket',
  'authenticated', '11111111-1111-4111-8111-111111111111',
  'WITH x AS (UPDATE tickets SET estado = ''EN_CURSO'' WHERE titulo = ''Ticket de prueba'' RETURNING 1) SELECT count(*) FROM x', '1 filas');
SELECT probar('nadie borra tickets desde el tablero',
  'authenticated', '11111111-1111-4111-8111-111111111111',
  'WITH x AS (DELETE FROM tickets RETURNING 1) SELECT count(*) FROM x', 'permiso denegado');
SELECT probar('n8n_writer puede sembrar tickets',
  'n8n_writer', NULL,
  'WITH x AS (INSERT INTO tickets (titulo, origen) VALUES (''sembrado'', ''CRM'') RETURNING 1) SELECT count(*) FROM x', '1 filas');

-- ── 17. set_actualizado_en: el trigger de leads corre de verdad ────────────
-- `antes` y `upd` comparten el mismo snapshot (misma semántica de la CTE que
-- causó el bug de rate limiting corregido en Fase 0): `antes` lee el valor
-- previo a este UPDATE, no el que el propio UPDATE está por escribir.
SELECT probar('actualizar un lead bumpea actualizado_en',
  'service_role', NULL,
  'WITH antes AS (SELECT actualizado_en FROM leads WHERE lead_id = ''LD-TEST-0001''), upd AS (UPDATE leads SET notas = ''trigger-check'' WHERE lead_id = ''LD-TEST-0001'' RETURNING actualizado_en) SELECT count(*) FROM upd, antes WHERE upd.actualizado_en > antes.actualizado_en',
  '1 filas');

-- ── 18. Espacios: uno por cuenta confirmada, y cada uno ve el suyo ─────────
SELECT probar('cada cuenta confirmada tiene su espacio; la sin confirmar, no',
  'service_role', NULL,
  'SELECT count(*) FROM espacios WHERE dueno_id IN (''11111111-1111-4111-8111-111111111111'', ''22222222-2222-4222-8222-222222222222'', ''66666666-6666-4666-8666-666666666666'')',
  '2 filas');
SELECT probar('un desarrollador ve sólo su espacio',
  'authenticated', '22222222-2222-4222-8222-222222222222', 'SELECT count(*) FROM espacios', '1 filas');
SELECT probar('anon NO puede leer espacios', 'anon', NULL, 'SELECT count(*) FROM espacios', 'permiso denegado');
SELECT probar('un desarrollador NO puede quedarse con el espacio de otro',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  'WITH x AS (UPDATE espacios SET dueno_id = auth.uid() RETURNING 1) SELECT count(*) FROM x', 'permiso denegado');

-- ── 18.1 Alta: el dueño elige nombre y dirección, y nada más ───────────────
SELECT probar('un espacio recién creado todavía no completó el alta',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  'SELECT count(*) FROM espacios WHERE configurado_en IS NULL', '1 filas');
SELECT probar('el dueño cambia el nombre y la dirección de su espacio',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  'WITH x AS (UPDATE espacios SET nombre = ''Estudio Pepe'', slug = ''estudio-pepe'' RETURNING 1) SELECT count(*) FROM x', '1 filas');
SELECT probar('y con eso el alta queda completa',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  'SELECT count(*) FROM espacios WHERE configurado_en IS NOT NULL', '1 filas');
SELECT probar('el dueño NO puede marcar el alta a mano',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  'WITH x AS (UPDATE espacios SET configurado_en = NULL RETURNING 1) SELECT count(*) FROM x', 'permiso denegado');
SELECT probar('el dueño NO puede cambiar el nombre del espacio de otro (0 filas)',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  format('WITH x AS (UPDATE espacios SET nombre = ''hackeado'' WHERE id = %L RETURNING 1) SELECT count(*) FROM x',
         (SELECT id FROM espacios WHERE dueno_id = '11111111-1111-4111-8111-111111111111')),
  '0 filas');
SELECT probar('dos espacios no pueden tener la misma dirección',
  'authenticated', '11111111-1111-4111-8111-111111111111',
  'WITH x AS (UPDATE espacios SET slug = ''estudio-pepe'' RETURNING 1) SELECT count(*) FROM x',
  'error: duplicate key value violates unique constraint "espacios_slug_key"');
SELECT probar('una dirección con mayúsculas o espacios no se acepta',
  'authenticated', '11111111-1111-4111-8111-111111111111',
  'WITH x AS (UPDATE espacios SET slug = ''Mi Estudio'' RETURNING 1) SELECT count(*) FROM x',
  'error: new row for relation "espacios" violates check constraint "espacios_slug_check"');
SELECT probar('el espacio arranca con el correo de la cuenta como contacto',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  'SELECT count(*) FROM espacios WHERE email_contacto = ''pepe@gmail.com''', '1 filas');
SELECT probar('el dueño cambia su correo de contacto',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  'WITH x AS (UPDATE espacios SET email_contacto = ''hola@estudiopepe.com'' RETURNING 1) SELECT count(*) FROM x', '1 filas');
SELECT probar('un correo de contacto sin formato válido no se acepta',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  'WITH x AS (UPDATE espacios SET email_contacto = ''no es un correo'' RETURNING 1) SELECT count(*) FROM x',
  'error: new row for relation "espacios" violates check constraint "espacios_email_contacto_check"');
SELECT probar('anon NO puede editar espacios',
  'anon', NULL, 'WITH x AS (UPDATE espacios SET nombre = ''x'' RETURNING 1) SELECT count(*) FROM x', 'permiso denegado');

-- ── 18.2 El formulario público lee sólo el nombre, por la dirección ────────
SELECT probar('anon encuentra un espacio por su dirección',
  'anon', NULL, 'SELECT count(*) FROM espacio_publico(''estudio-pepe'') WHERE nombre = ''Estudio Pepe''', '1 filas');
SELECT probar('la dirección no distingue mayúsculas',
  'anon', NULL, 'SELECT count(*) FROM espacio_publico(''Estudio-Pepe'')', '1 filas');
SELECT probar('una dirección que no existe no devuelve nada',
  'anon', NULL, 'SELECT count(*) FROM espacio_publico(''no-existe'')', '0 filas');

-- ── 18.3 n8n resuelve el espacio de un pedido por la dirección ────────────
-- 4: las dos cuentas del principio más las dos confirmadas de la sección 16.
SELECT probar('n8n_writer lee id, dirección y nombre de todos los espacios',
  'n8n_writer', NULL, 'SELECT count(*) FROM (SELECT id, slug, nombre FROM espacios) e', '4 filas');
SELECT probar('n8n_writer lee el correo de contacto (Reply-To de los correos)',
  'n8n_writer', NULL, 'SELECT count(email_contacto) FROM espacios', '4 filas');
SELECT probar('pero no el dueño',
  'n8n_writer', NULL, 'SELECT count(dueno_id) FROM espacios', 'permiso denegado');
SELECT probar('n8n_writer NO puede editar espacios',
  'n8n_writer', NULL, 'WITH x AS (UPDATE espacios SET nombre = ''x'' RETURNING 1) SELECT count(*) FROM x', 'permiso denegado');

UPDATE auth.users SET email_confirmed_at = now() WHERE id = '66666666-6666-4666-8666-666666666666';
SELECT probar('al confirmar la cuenta se crea su espacio',
  'authenticated', '66666666-6666-4666-8666-666666666666', 'SELECT count(*) FROM espacios', '1 filas');

-- ── 19. Lo que cuelga de un lead es siempre del espacio del lead ──────────
SELECT probar('una factura hereda el espacio de su lead aunque n8n mande otro',
  'n8n_writer', NULL,
  format('WITH x AS (INSERT INTO facturas (factura_id, lead_id, espacio_id, cliente, email, monto, fecha_vencimiento) VALUES (''FAC-PEPE-0001'', ''LD-PEPE-0001'', %L, ''c'', ''c@c.com'', 10, now() + interval ''5 days'') RETURNING espacio_id) SELECT count(*) FROM x JOIN leads l ON l.espacio_id = x.espacio_id WHERE l.lead_id = ''LD-PEPE-0001''',
         (SELECT id FROM espacios WHERE dueno_id = '11111111-1111-4111-8111-111111111111')),
  '1 filas');
SELECT probar('un log de un lead queda en el espacio del lead',
  'service_role', NULL,
  'SELECT count(*) FROM logs g JOIN leads l USING (lead_id) WHERE g.lead_id = ''LD-TEST-0001'' AND g.espacio_id = l.espacio_id',
  '1 filas');

-- Un pedido que pasa a otro espacio (lo que va a hacer la bolsa de
-- proyectos) se lleva sus facturas, seguimientos, tickets y logs.
UPDATE leads SET espacio_id = (SELECT id FROM espacios WHERE dueno_id = '22222222-2222-4222-8222-222222222222')
WHERE lead_id = 'LD-TEST-0001';
SELECT probar('al mover un lead de espacio, sus facturas lo siguen',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  'SELECT count(*) FROM facturas WHERE lead_id = ''LD-TEST-0001''', '2 filas');
SELECT probar('al mover un lead de espacio, sus seguimientos lo siguen',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  'SELECT count(*) FROM seguimientos WHERE lead_id = ''LD-TEST-0001''', '1 filas');
SELECT probar('y el dueño anterior deja de verlo',
  'authenticated', '11111111-1111-4111-8111-111111111111',
  'SELECT count(*) FROM facturas WHERE lead_id = ''LD-TEST-0001''', '0 filas');

-- ── 20. Avisos: cada uno ve y marca los de su espacio ──────────────────────
-- Uno de cada espacio y uno de la plataforma (sin espacio), como los registra n8n.
SELECT probar('n8n_writer registra avisos',
  'n8n_writer', NULL,
  format('WITH x AS (INSERT INTO avisos (espacio_id, tipo, nivel, mensaje) VALUES (%L, ''pago_recibido'', ''atencion'', ''Pago de A''), (%L, ''lead_frio'', ''info'', ''Lead de Pepe''), (NULL, ''error_critico'', ''critico'', ''De la plataforma'') RETURNING 1) SELECT count(*) FROM x',
         (SELECT id FROM espacios WHERE dueno_id = '11111111-1111-4111-8111-111111111111'),
         (SELECT id FROM espacios WHERE dueno_id = '22222222-2222-4222-8222-222222222222')),
  '3 filas');
SELECT probar('Pepe ve sólo el aviso de su espacio',
  'authenticated', '22222222-2222-4222-8222-222222222222', 'SELECT count(*) FROM avisos', '1 filas');
SELECT probar('los avisos de la plataforma no los ve ningún desarrollador',
  'authenticated', '11111111-1111-4111-8111-111111111111', 'SELECT count(*) FROM avisos WHERE espacio_id IS NULL', '0 filas');
SELECT probar('Pepe marca su aviso como leído',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  'WITH x AS (UPDATE avisos SET leido_en = now() RETURNING 1) SELECT count(*) FROM x', '1 filas');
SELECT probar('Pepe NO puede cambiar el texto de un aviso',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  'WITH x AS (UPDATE avisos SET mensaje = ''otro'' RETURNING 1) SELECT count(*) FROM x', 'permiso denegado');
SELECT probar('nadie crea avisos desde el panel',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  'WITH x AS (INSERT INTO avisos (tipo, mensaje) VALUES (''x'', ''x'') RETURNING 1) SELECT count(*) FROM x', 'permiso denegado');
SELECT probar('anon NO puede leer avisos', 'anon', NULL, 'SELECT count(*) FROM avisos', 'permiso denegado');

-- ── 21. Telegram: vincular con un código de un solo uso ───────────────────
SELECT probar('el dueño pide un código para vincular Telegram',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  'SELECT count(*) FROM generar_codigo_telegram() c WHERE length(c) = 8', '1 filas');
SELECT probar('el dueño NO puede escribirse el chat de Telegram a mano',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  'WITH x AS (UPDATE espacios SET telegram_chat_id = ''123'' RETURNING 1) SELECT count(*) FROM x', 'permiso denegado');
SELECT probar('anon NO puede pedir códigos', 'anon', NULL, 'SELECT count(*) FROM generar_codigo_telegram()', 'permiso denegado');
SELECT probar('un código inventado no vincula nada',
  'n8n_writer', NULL, 'SELECT count(*) FROM vincular_telegram(''ZZZZZZZZ'', ''999'')', '0 filas');
SELECT probar('n8n canjea el código por el chat y devuelve el nombre del espacio',
  'n8n_writer', NULL,
  format('SELECT count(*) FROM vincular_telegram(%L, ''555'') WHERE nombre = ''Estudio Pepe''',
         (SELECT telegram_codigo FROM espacios WHERE dueno_id = '22222222-2222-4222-8222-222222222222')),
  '1 filas');
SELECT probar('el código no sirve dos veces',
  'service_role', NULL,
  'SELECT count(*) FROM espacios WHERE telegram_chat_id = ''555'' AND telegram_codigo IS NULL', '1 filas');
SELECT probar('n8n_writer lee el chat vinculado para mandar los avisos',
  'n8n_writer', NULL, 'SELECT count(telegram_chat_id) FROM espacios', '1 filas');
UPDATE espacios SET telegram_codigo = 'VENCIDO1', telegram_codigo_vence = now() - interval '1 minute'
WHERE dueno_id = '11111111-1111-4111-8111-111111111111';
SELECT probar('un código vencido no vincula',
  'n8n_writer', NULL,
  'SELECT count(*) FROM vincular_telegram(''VENCIDO1'', ''777'')', '0 filas');
SELECT probar('el panel NO puede canjear códigos (sólo n8n)',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  'SELECT count(*) FROM vincular_telegram(''X'', ''1'')', 'permiso denegado');
SELECT probar('el dueño desvincula su Telegram',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  'SELECT count(*) FROM (SELECT desvincular_telegram()) x', '1 filas');
SELECT probar('y deja de recibir avisos por ahí',
  'service_role', NULL, 'SELECT count(*) FROM espacios WHERE telegram_chat_id IS NOT NULL', '0 filas');

-- ── 21.1 Cobros con Stripe: la cuenta la escribe n8n, no el dueño ─────────
SELECT probar('el dueño NO puede escribirse una cuenta de Stripe (cobraría en la de otro)',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  'WITH x AS (UPDATE espacios SET stripe_account_id = ''acct_ajena'' RETURNING 1) SELECT count(*) FROM x', 'permiso denegado');
SELECT probar('el dueño NO puede marcarse los cobros como activos',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  'WITH x AS (UPDATE espacios SET stripe_cobros_activos = true RETURNING 1) SELECT count(*) FROM x', 'permiso denegado');
SELECT probar('n8n guarda la cuenta de Stripe que creó para el espacio',
  'n8n_writer', NULL,
  'WITH x AS (UPDATE espacios SET stripe_account_id = ''acct_pepe'', stripe_cobros_activos = true WHERE nombre = ''Estudio Pepe'' RETURNING 1) SELECT count(*) FROM x', '1 filas');
SELECT probar('pero no puede tocar el nombre ni el dueño',
  'n8n_writer', NULL,
  'WITH x AS (UPDATE espacios SET nombre = ''otro'' RETURNING 1) SELECT count(*) FROM x', 'permiso denegado');
SELECT probar('una cuenta de Stripe no puede quedar en dos espacios',
  'n8n_writer', NULL,
  'WITH x AS (UPDATE espacios SET stripe_account_id = ''acct_pepe'' WHERE nombre <> ''Estudio Pepe'' RETURNING 1) SELECT count(*) FROM x',
  'error: duplicate key value violates unique constraint "espacios_stripe_account_id_key"');
SELECT probar('el dueño ve el estado de sus cobros',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  'SELECT count(*) FROM espacios WHERE stripe_cobros_activos', '1 filas');

-- ── 22. Métricas: una fila por espacio y mes ───────────────────────────────
SELECT probar('n8n ve las métricas separadas por espacio',
  'n8n_writer', NULL, 'SELECT count(DISTINCT espacio_id) FROM metrics_mensuales', '2 filas');

-- ── 23. Bolsa de proyectos: sin datos personales y con las reglas en la base ─
-- A esta altura los dos leads son del espacio de Pepe (la sección 19 movió
-- LD-TEST-0001). El admin completa el alta para poder postularse; la cuenta
-- 6666 tiene espacio pero sin configurar.
UPDATE espacios SET nombre = 'Estudio Admin' WHERE dueno_id = '11111111-1111-4111-8111-111111111111';

SELECT probar('sin el consentimiento del cliente, el pedido NO puede ir a la bolsa',
  'n8n_writer', NULL,
  'WITH x AS (INSERT INTO bolsa_pedidos (lead_id, origen_espacio_id, resumen) SELECT ''LD-PEPE-0001'', espacio_id, ''Sitio institucional con blog y formulario'' FROM leads WHERE lead_id = ''LD-PEPE-0001'' RETURNING 1) SELECT count(*) FROM x',
  'error: El cliente no aceptó compartir el pedido con otros desarrolladores');
UPDATE leads SET compartir_bolsa = true WHERE lead_id IN ('LD-PEPE-0001', 'LD-TEST-0001');
-- n8n manda otro espacio y otro servicio a propósito: el trigger los pisa con
-- los del lead, así nadie puede publicar datos que no son del pedido.
SELECT probar('con el consentimiento, n8n publica el pedido (servicio y origen salen del lead)',
  'n8n_writer', NULL,
  format('WITH x AS (INSERT INTO bolsa_pedidos (lead_id, origen_espacio_id, resumen, servicio) VALUES (%L, %L, %L, %L) RETURNING origen_espacio_id, servicio) SELECT count(*) FROM x JOIN leads l ON l.espacio_id = x.origen_espacio_id AND l.servicio = x.servicio WHERE l.lead_id = %L',
         'LD-PEPE-0001', (SELECT id FROM espacios WHERE dueno_id = '11111111-1111-4111-8111-111111111111'),
         'Sitio institucional con blog y formulario', 'soporte', 'LD-PEPE-0001'),
  '1 filas');
SELECT probar('un pedido va a la bolsa una sola vez',
  'n8n_writer', NULL,
  'WITH x AS (INSERT INTO bolsa_pedidos (lead_id, origen_espacio_id, resumen) SELECT ''LD-PEPE-0001'', espacio_id, ''Otra vez el mismo pedido de antes'' FROM leads WHERE lead_id = ''LD-PEPE-0001'' RETURNING 1) SELECT count(*) FROM x',
  'error: duplicate key value violates unique constraint "bolsa_pedidos_lead_id_key"');
SELECT probar('anon NO puede leer la bolsa', 'anon', NULL, 'SELECT count(*) FROM bolsa_pedidos', 'permiso denegado');
SELECT probar('anon NO puede usar bolsa_abierta()', 'anon', NULL, 'SELECT count(*) FROM bolsa_abierta()', 'permiso denegado');
SELECT probar('un desarrollador NO lee la tabla de la bolsa directo',
  'authenticated', '11111111-1111-4111-8111-111111111111', 'SELECT count(*) FROM bolsa_pedidos', 'permiso denegado');
SELECT probar('ni las postulaciones',
  'authenticated', '11111111-1111-4111-8111-111111111111', 'SELECT count(*) FROM postulaciones', 'permiso denegado');
SELECT probar('el admin ve el pedido abierto por bolsa_abierta()',
  'authenticated', '11111111-1111-4111-8111-111111111111',
  'SELECT count(*) FROM bolsa_abierta() WHERE NOT propio AND NOT me_postule', '1 filas');
SELECT probar('y aunque vea el pedido, NO puede leer el lead (datos personales)',
  'authenticated', '11111111-1111-4111-8111-111111111111',
  'SELECT count(*) FROM leads WHERE lead_id = ''LD-PEPE-0001''', '0 filas');
SELECT probar('quien lo rechazó lo ve marcado como propio',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  'SELECT count(*) FROM bolsa_abierta() WHERE propio', '1 filas');
SELECT probar('una cuenta sin el alta completa no ve la bolsa',
  'authenticated', '66666666-6666-4666-8666-666666666666', 'SELECT count(*) FROM bolsa_abierta()', '0 filas');
SELECT probar('quien lo rechazó NO puede postularse',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  'SELECT count(*) FROM (SELECT postularme(id, ''Lo puedo hacer en dos semanas'', 900, ''2 semanas'') FROM bolsa_abierta()) x',
  'error: No podés postularte a un pedido que rechazaste');
SELECT probar('una cuenta sin el alta completa NO puede postularse',
  'authenticated', '66666666-6666-4666-8666-666666666666',
  format('SELECT count(*) FROM (SELECT postularme(%L, %L, 900, %L)) x',
         (SELECT id FROM bolsa_pedidos WHERE lead_id = 'LD-PEPE-0001'), 'Lo puedo hacer en dos semanas', '2 semanas'),
  'error: La cuenta no tiene un espacio configurado');
SELECT probar('un desarrollador NO puede insertar la postulación a mano (saltearía las reglas)',
  'authenticated', '11111111-1111-4111-8111-111111111111',
  format('WITH x AS (INSERT INTO postulaciones (pedido_id, espacio_id, mensaje, precio_estimado, plazo) VALUES (%L, %L, %L, 1, %L) RETURNING 1) SELECT count(*) FROM x',
         (SELECT id FROM bolsa_pedidos WHERE lead_id = 'LD-PEPE-0001'),
         (SELECT id FROM espacios WHERE dueno_id = '11111111-1111-4111-8111-111111111111'),
         'Me postulo sin pasar por la función', '1 día'),
  'permiso denegado');
SELECT probar('el admin se postula',
  'authenticated', '11111111-1111-4111-8111-111111111111',
  'SELECT count(*) FROM (SELECT postularme(id, ''Lo puedo hacer en dos semanas'', 900, ''2 semanas'') FROM bolsa_abierta()) x',
  '1 filas');
SELECT probar('y ya figura como postulado',
  'authenticated', '11111111-1111-4111-8111-111111111111',
  'SELECT count(*) FROM bolsa_abierta() WHERE me_postule AND postulaciones = 1', '1 filas');
SELECT probar('una sola postulación por espacio',
  'authenticated', '11111111-1111-4111-8111-111111111111',
  'SELECT count(*) FROM (SELECT postularme(id, ''Me postulo de nuevo por las dudas'', 800, ''1 semana'') FROM bolsa_abierta()) x',
  'error: duplicate key value violates unique constraint "postulaciones_pedido_id_espacio_id_key"');
SELECT probar('n8n lee las postulaciones (para la página del cliente)',
  'n8n_writer', NULL, 'SELECT count(*) FROM postulaciones', '1 filas');
SELECT probar('n8n NO borra pedidos de la bolsa',
  'n8n_writer', NULL, 'WITH x AS (DELETE FROM bolsa_pedidos RETURNING 1) SELECT count(*) FROM x', 'permiso denegado');

-- Tope: un pedido con tope 1 pasa a EN_ELECCION con la primera postulación.
INSERT INTO bolsa_pedidos (lead_id, origen_espacio_id, resumen, tope_postulaciones)
SELECT 'LD-TEST-0001', espacio_id, 'Tienda online con pasarela de pagos', 1 FROM leads WHERE lead_id = 'LD-TEST-0001';
SELECT probar('el admin se postula al pedido con tope 1',
  'authenticated', '11111111-1111-4111-8111-111111111111',
  format('SELECT count(*) FROM (SELECT postularme(%L, %L, 2500, %L)) x',
         (SELECT id FROM bolsa_pedidos WHERE lead_id = 'LD-TEST-0001'), 'Tengo experiencia en tiendas online', '1 mes'),
  '1 filas');
SELECT probar('al llegar al tope, el pedido pasa a elección',
  'n8n_writer', NULL,
  'SELECT count(*) FROM bolsa_pedidos WHERE lead_id = ''LD-TEST-0001'' AND estado = ''EN_ELECCION'' AND postulaciones = 1', '1 filas');
SELECT probar('y ya no recibe más postulaciones',
  'authenticated', '11111111-1111-4111-8111-111111111111',
  format('SELECT count(*) FROM (SELECT postularme(%L, %L, 2000, %L)) x',
         (SELECT id FROM bolsa_pedidos WHERE lead_id = 'LD-TEST-0001'), 'Otra postulación más al mismo pedido', '1 mes'),
  'error: El pedido ya no recibe postulaciones');
UPDATE bolsa_pedidos SET vence_en = now() - interval '1 second' WHERE lead_id = 'LD-PEPE-0001';
SELECT probar('un pedido vencido tampoco recibe postulaciones',
  'authenticated', '11111111-1111-4111-8111-111111111111',
  format('SELECT count(*) FROM (SELECT postularme(%L, %L, 900, %L)) x',
         (SELECT id FROM bolsa_pedidos WHERE lead_id = 'LD-PEPE-0001'), 'Me postulo después del vencimiento', '2 semanas'),
  'error: El pedido ya no recibe postulaciones');

-- ── 24. Cuentas de cliente: entran con enlace mágico y no tienen espacio ───
-- La página de clientes manda {tipo: 'cliente'} en los metadatos. Una se
-- crea ya confirmada (como con el enlace mágico) y otra sin confirmar, que se
-- confirma después.
INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data) VALUES
  ('77777777-7777-4777-8777-777777777777', 'marta.cliente@gmail.com', now(), '{"tipo": "cliente"}'),
  ('88888888-8888-4888-8888-888888888888', 'otro.cliente@gmail.com', NULL, '{"tipo": "cliente"}'),
  ('99999999-9999-4999-8999-999999999990', 'nueva.dev@gmail.com', now(), '{"tipo": "desarrollador"}');
UPDATE auth.users SET email_confirmed_at = now() WHERE id = '88888888-8888-4888-8888-888888888888';

SELECT probar('una cuenta de cliente queda marcada como cliente',
  'authenticated', '77777777-7777-4777-8777-777777777777',
  'SELECT count(*) FROM profiles WHERE tipo = ''cliente''', '1 filas');
SELECT probar('una cuenta de cliente NO recibe espacio',
  'service_role', NULL,
  'SELECT count(*) FROM espacios WHERE dueno_id = ''77777777-7777-4777-8777-777777777777''', '0 filas');
SELECT probar('tampoco al confirmarse después',
  'service_role', NULL,
  'SELECT count(*) FROM espacios WHERE dueno_id = ''88888888-8888-4888-8888-888888888888''', '0 filas');
SELECT probar('una cuenta de desarrollador sigue recibiendo su espacio',
  'service_role', NULL,
  'SELECT count(*) FROM espacios e JOIN profiles p ON p.id = e.dueno_id WHERE e.dueno_id = ''99999999-9999-4999-8999-999999999990'' AND p.tipo = ''desarrollador''', '1 filas');
SELECT probar('las cuentas creadas sin tipo (las de /register) son de desarrollador',
  'service_role', NULL,
  'SELECT count(*) FROM profiles WHERE id = ''22222222-2222-4222-8222-222222222222'' AND tipo = ''desarrollador''', '1 filas');
SELECT probar('un cliente NO puede cambiarse el tipo de cuenta',
  'authenticated', '77777777-7777-4777-8777-777777777777',
  'WITH x AS (UPDATE profiles SET tipo = ''desarrollador'' RETURNING 1) SELECT count(*) FROM x', 'permiso denegado');
SELECT probar('un cliente NO ve pedidos de nadie',
  'authenticated', '77777777-7777-4777-8777-777777777777', 'SELECT count(*) FROM leads', '0 filas');
SELECT probar('ni la bolsa de los desarrolladores',
  'authenticated', '77777777-7777-4777-8777-777777777777', 'SELECT count(*) FROM bolsa_abierta()', '0 filas');
SELECT probar('ni puede postularse',
  'authenticated', '77777777-7777-4777-8777-777777777777',
  format('SELECT count(*) FROM (SELECT postularme(%L, %L, 100, %L)) x',
         (SELECT id FROM bolsa_pedidos LIMIT 1), 'Me quiero postular siendo cliente', '1 día'),
  'error: La cuenta no tiene un espacio configurado');

-- ── 25. Proyectos que publica un cliente directo ───────────────────────────
-- 7777 es la clienta confirmada de la sección 24; 1111 y 2222, desarrolladores.
SELECT probar('una clienta publica su proyecto',
  'authenticated', '77777777-7777-4777-8777-777777777777',
  'SELECT count(*) FROM (SELECT publicar_proyecto(''Tienda online para mi marca'', ''Necesito una tienda con catálogo, carrito y pagos online.'', ''ecommerce'', ''media'', ''2000_5000'', ''Marta Gómez'', ''11 5555 1234'')) x',
  '1 filas');
SELECT probar('queda abierto, con tope 15, el piso del rango y el correo de la cuenta',
  'service_role', NULL,
  'SELECT count(*) FROM bolsa_pedidos WHERE cliente_id = ''77777777-7777-4777-8777-777777777777'' AND estado = ''ABIERTO'' AND tope_postulaciones = 15 AND presupuesto = 2000 AND contacto_email = ''marta.cliente@gmail.com'' AND lead_id IS NULL AND origen_espacio_id IS NULL',
  '1 filas');
SELECT probar('un desarrollador NO puede publicar como cliente',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  'SELECT count(*) FROM (SELECT publicar_proyecto(''Tienda online para mi marca'', ''Necesito una tienda con catálogo, carrito y pagos online.'', ''ecommerce'', ''media'', ''2000_5000'', ''Pepe'', NULL)) x',
  'error: Sólo una cuenta de cliente puede publicar proyectos');
SELECT probar('anon NO puede publicar',
  'anon', NULL,
  'SELECT count(*) FROM (SELECT publicar_proyecto(''Tienda online para mi marca'', ''Necesito una tienda con catálogo, carrito y pagos online.'', ''ecommerce'', ''media'', ''2000_5000'', ''Nadie'', NULL)) x',
  'permiso denegado');
SELECT probar('un rango inventado no se acepta',
  'authenticated', '77777777-7777-4777-8777-777777777777',
  'SELECT count(*) FROM (SELECT publicar_proyecto(''Tienda online para mi marca'', ''Necesito una tienda con catálogo, carrito y pagos online.'', ''ecommerce'', ''media'', ''mil_millones'', ''Marta'', NULL)) x',
  'error: Rango de presupuesto inválido');
SELECT probar('la clienta NO lee la tabla de la bolsa directo',
  'authenticated', '77777777-7777-4777-8777-777777777777', 'SELECT count(*) FROM bolsa_pedidos', 'permiso denegado');
SELECT probar('ve su proyecto en mis_proyectos()',
  'authenticated', '77777777-7777-4777-8777-777777777777',
  'SELECT count(*) FROM mis_proyectos() WHERE titulo = ''Tienda online para mi marca''', '1 filas');
SELECT probar('otra clienta NO ve los proyectos ajenos',
  'authenticated', '88888888-8888-4888-8888-888888888888', 'SELECT count(*) FROM mis_proyectos()', '0 filas');
SELECT probar('un desarrollador lo ve en la bolsa, con título y marcado como directo',
  'authenticated', '11111111-1111-4111-8111-111111111111',
  'SELECT count(*) FROM bolsa_abierta() WHERE directo AND titulo = ''Tienda online para mi marca'' AND NOT propio', '1 filas');
SELECT probar('y se postula',
  'authenticated', '11111111-1111-4111-8111-111111111111',
  'SELECT count(*) FROM (SELECT postularme(id, ''Armé varias tiendas con pagos online.'', 3000, ''5 semanas'') FROM bolsa_abierta() WHERE directo) x',
  '1 filas');
SELECT probar('la clienta ve la postulación en su proyecto',
  'authenticated', '77777777-7777-4777-8777-777777777777',
  'SELECT count(*) FROM mis_proyectos() WHERE postulaciones = 1 AND json_array_length(detalle) = 1', '1 filas');
SELECT probar('pero no a quién pertenece más allá de la marca (sin dueño ni correo del espacio)',
  'authenticated', '77777777-7777-4777-8777-777777777777',
  'SELECT count(*) FROM mis_proyectos(), json_array_elements(detalle) d WHERE d::jsonb ? ''email'' OR d::jsonb ? ''espacio_id''', '0 filas');
-- Límite de proyectos abiertos por cliente.
SELECT publicar_proyecto('Proyecto número ' || n, 'Descripción suficientemente larga del proyecto ' || n, 'seo', 'baja', 'hasta_300', 'Marta', NULL)
FROM (SELECT set_config('request.jwt.claims', '{"sub": "77777777-7777-4777-8777-777777777777"}', true)) c,
     generate_series(2, 5) n;
SELECT probar('con 5 proyectos abiertos no puede publicar otro',
  'authenticated', '77777777-7777-4777-8777-777777777777',
  'SELECT count(*) FROM (SELECT publicar_proyecto(''Un sexto proyecto más'', ''Descripción suficientemente larga del sexto proyecto.'', ''seo'', ''baja'', ''hasta_300'', ''Marta'', NULL)) x',
  'error: Ya tenés 5 proyectos abiertos: elegí o esperá a que cierre alguno');

-- ── 26. Perfiles públicos y calificaciones ─────────────────────────────────
-- Los dos leads de prueba son de Pepe («Estudio Pepe», estudio-pepe). Se
-- cierran como lo hace n8n; LD-TEST-0001 además quedó asignado por la bolsa.
UPDATE leads SET estado = 'CERRADO' WHERE lead_id IN ('LD-PEPE-0001', 'LD-TEST-0001');
UPDATE bolsa_pedidos SET estado = 'ASIGNADO', asignado_espacio_id = (SELECT espacio_id FROM leads WHERE lead_id = 'LD-TEST-0001')
WHERE lead_id = 'LD-TEST-0001';
INSERT INTO leads (lead_id, espacio_id, nombre, email, presupuesto, urgencia, servicio, estado)
VALUES ('LD-PEPE-ABIERTO', (SELECT id FROM espacios WHERE dueno_id = '22222222-2222-4222-8222-222222222222'),
        'Cliente Abierto', 'abierto@test.com', 500, 'media', 'seo', 'NUEVO');

SELECT probar('anon ve a quién califica con el token del correo',
  'anon', NULL,
  format('SELECT count(*) FROM calificacion_pendiente(%L) WHERE espacio_nombre = ''Estudio Pepe'' AND NOT ya_calificado',
         (SELECT calificacion_token FROM leads WHERE lead_id = 'LD-PEPE-0001')),
  '1 filas');
SELECT probar('anon califica un proyecto cerrado con el token',
  'anon', NULL,
  format('SELECT count(*) FROM (SELECT calificar(%L, 5, %L)) x',
         (SELECT calificacion_token FROM leads WHERE lead_id = 'LD-PEPE-0001'), 'Excelente trabajo, muy prolijo.'),
  '1 filas');
SELECT probar('queda con el nombre de pila y como cliente del formulario propio',
  'service_role', NULL,
  'SELECT count(*) FROM calificaciones WHERE lead_id = ''LD-PEPE-0001'' AND autor_nombre = ''Cliente'' AND origen = ''formulario''',
  '1 filas');
SELECT probar('no se puede calificar dos veces',
  'anon', NULL,
  format('SELECT count(*) FROM (SELECT calificar(%L, 1, NULL)) x',
         (SELECT calificacion_token FROM leads WHERE lead_id = 'LD-PEPE-0001')),
  'error: Ya calificaste este proyecto');
SELECT probar('las estrellas van de 1 a 5',
  'anon', NULL,
  format('SELECT count(*) FROM (SELECT calificar(%L, 6, NULL)) x',
         (SELECT calificacion_token FROM leads WHERE lead_id = 'LD-TEST-0001')),
  'error: Elegí entre 1 y 5 estrellas');
SELECT probar('un proyecto que no está cerrado no se califica',
  'anon', NULL,
  format('SELECT count(*) FROM (SELECT calificar(%L, 5, NULL)) x',
         (SELECT calificacion_token FROM leads WHERE lead_id = 'LD-PEPE-ABIERTO')),
  'error: El enlace no es válido o el proyecto no está cerrado');
SELECT probar('un token inventado no califica nada',
  'anon', NULL,
  format('SELECT count(*) FROM (SELECT calificar(%L, 5, NULL)) x', gen_random_uuid()),
  'error: El enlace no es válido o el proyecto no está cerrado');
SELECT probar('se califica un proyecto que llegó por la bolsa',
  'anon', NULL,
  format('SELECT count(*) FROM (SELECT calificar(%L, 3, NULL)) x',
         (SELECT calificacion_token FROM leads WHERE lead_id = 'LD-TEST-0001')),
  '1 filas');
SELECT probar('(visto por n8n) quedó como de la plataforma',
  'n8n_writer', NULL,
  'SELECT count(*) FROM calificaciones WHERE lead_id = ''LD-TEST-0001'' AND origen = ''plataforma'' AND estrellas = 3', '1 filas');
SELECT probar('anon NO lee la tabla de calificaciones',
  'anon', NULL, 'SELECT count(*) FROM calificaciones', 'permiso denegado');
SELECT probar('ni un desarrollador (la lee por el perfil)',
  'authenticated', '22222222-2222-4222-8222-222222222222', 'SELECT count(*) FROM calificaciones', 'permiso denegado');
SELECT probar('el perfil público muestra el promedio, la cantidad y los proyectos terminados',
  'anon', NULL,
  'SELECT count(*) FROM perfil_publico(''estudio-pepe'') WHERE promedio = 4.0 AND calificaciones = 2 AND proyectos_terminados = 2',
  '1 filas');
SELECT probar('y las reseñas, sin datos de contacto',
  'anon', NULL,
  'SELECT count(*) FROM resenas_publicas(''estudio-pepe'') WHERE autor_nombre = ''Cliente''', '2 filas');
SELECT probar('un espacio sin el alta completa no tiene perfil público',
  'anon', NULL,
  format('SELECT count(*) FROM perfil_publico(%L)', (SELECT slug FROM espacios WHERE dueno_id = '66666666-6666-4666-8666-666666666666')),
  '0 filas');
SELECT probar('el dueño edita su presentación, habilidades y portfolio',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  'WITH x AS (UPDATE espacios SET presentacion = ''Hago sitios y tiendas.'', habilidades = ARRAY[''React'',''Next.js''], portfolio_urls = ARRAY[''https://pepe.dev''] RETURNING 1) SELECT count(*) FROM x',
  '1 filas');
SELECT probar('un enlace del portfolio que no es http(s) no se acepta',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  'WITH x AS (UPDATE espacios SET portfolio_urls = ARRAY[''javascript:alert(1)''] RETURNING 1) SELECT count(*) FROM x',
  'error: Los enlaces del portfolio tienen que empezar con http:// o https://');
SELECT probar('ni una habilidad vacía',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  'WITH x AS (UPDATE espacios SET habilidades = ARRAY[''  ''] RETURNING 1) SELECT count(*) FROM x',
  'error: Cada habilidad tiene que tener entre 1 y 40 caracteres');
SELECT probar('nadie edita el perfil de otro (0 filas)',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  format('WITH x AS (UPDATE espacios SET presentacion = ''hackeado'' WHERE id = %L RETURNING 1) SELECT count(*) FROM x',
         (SELECT id FROM espacios WHERE dueno_id = '11111111-1111-4111-8111-111111111111')),
  '0 filas');

SELECT probar('la clienta ve la reputación y el perfil de cada postulante (sin datos del espacio)',
  'authenticated', '77777777-7777-4777-8777-777777777777',
  'SELECT count(*) FROM mis_proyectos(), json_array_elements(detalle) d WHERE d->>''slug'' IS NOT NULL AND (d->>''calificaciones'')::int = 0 AND d->>''promedio'' IS NULL',
  '1 filas');

-- ── 27. «Que lo elija la plataforma»: sorteo ponderado por estrellas ──────
-- Pepe tiene 4,0 (sección 26). El admin recibe una calificación de 1: al
-- sortear entre los dos, Pepe tiene que salir cerca del 80% (4 / (4 + 1)).
INSERT INTO leads (lead_id, espacio_id, nombre, email, presupuesto, urgencia, servicio, estado)
VALUES ('LD-ADMIN-CERRADO', (SELECT id FROM espacios WHERE dueno_id = '11111111-1111-4111-8111-111111111111'),
        'Cliente Enojado', 'enojado@test.com', 500, 'media', 'seo', 'CERRADO');
INSERT INTO calificaciones (lead_id, espacio_id, estrellas, autor_nombre, origen)
SELECT 'LD-ADMIN-CERRADO', espacio_id, 1, 'Cliente', 'formulario' FROM leads WHERE lead_id = 'LD-ADMIN-CERRADO';
-- El proyecto de Marta de la sección 25 tiene la postulación del admin; se
-- suma la de Pepe.
SELECT set_config('request.jwt.claims', '{"sub": "22222222-2222-4222-8222-222222222222"}', false);
SELECT postularme((SELECT id FROM bolsa_pedidos WHERE titulo = 'Tienda online para mi marca'),
                  'También armo tiendas con pagos online.', 2800, '4 semanas');
SELECT set_config('request.jwt.claims', '', false);

SELECT probar('n8n sortea una postulación del pedido',
  'n8n_writer', NULL,
  'SELECT count(*) FROM (SELECT sortear_postulacion((SELECT id FROM bolsa_pedidos WHERE titulo = ''Tienda online para mi marca'')) AS id) s JOIN postulaciones po ON po.id = s.id',
  '1 filas');
SELECT probar('un desarrollador NO puede sortear',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  'SELECT count(*) FROM (SELECT sortear_postulacion(gen_random_uuid())) x', 'permiso denegado');
SELECT probar('ni anon',
  'anon', NULL, 'SELECT count(*) FROM (SELECT sortear_postulacion(gen_random_uuid())) x', 'permiso denegado');
-- 2000 sorteos: el de 4 estrellas gana entre el 72% y el 88% (lo esperado es
-- 80%; el margen es de más de 8 desvíos, así que el caso no falla por azar).
SELECT probar('el sorteo respeta las estrellas: 4 contra 1 sale cerca del 80%',
  'n8n_writer', NULL,
  $q$SELECT CASE WHEN share BETWEEN 0.72 AND 0.88 THEN 1 ELSE 0 END::bigint FROM (
       SELECT avg((po.espacio_id = (SELECT id FROM espacios WHERE slug = 'estudio-pepe'))::int) AS share
       FROM generate_series(1, 2000) g
       -- WHERE g > 0: el LATERAL depende de cada fila, así se sortea 2000 veces
       -- y no una sola.
       JOIN LATERAL (SELECT sortear_postulacion((SELECT id FROM bolsa_pedidos WHERE titulo = 'Tienda online para mi marca')) AS id WHERE g > 0) s ON true
       JOIN postulaciones po ON po.id = s.id) t$q$,
  '1 filas');
SELECT probar('un pedido sin postulaciones no sortea a nadie',
  'n8n_writer', NULL,
  'SELECT count(*) FROM (SELECT sortear_postulacion(gen_random_uuid()) AS id) x WHERE id IS NOT NULL', '0 filas');

-- ── 28. Mensajes: cada conversación es de su cliente y su postulante ──────
-- El proyecto de Marta (7777) de la sección 25 tiene las postulaciones del
-- admin (1111) y de Pepe (2222).
CREATE TEMP TABLE conv AS
SELECT b.id AS pedido, b.eleccion_token AS token,
       (SELECT po.id FROM postulaciones po JOIN espacios e ON e.id = po.espacio_id
        WHERE po.pedido_id = b.id AND e.slug = 'estudio-pepe') AS de_pepe,
       (SELECT po.id FROM postulaciones po JOIN espacios e ON e.id = po.espacio_id
        WHERE po.pedido_id = b.id AND e.dueno_id = '11111111-1111-4111-8111-111111111111') AS del_admin
FROM bolsa_pedidos b WHERE b.titulo = 'Tienda online para mi marca';
GRANT SELECT ON conv TO PUBLIC;

SELECT probar('la clienta le escribe a un postulante',
  'authenticated', '77777777-7777-4777-8777-777777777777',
  format('SELECT count(*) FROM (SELECT enviar_mensaje(%L, %L)) x', (SELECT de_pepe FROM conv),
         'Hola Pepe, ¿me pasás tu cel? El mío es 11 5555 1234 y mi mail marta@gmail.com'),
  '1 filas');
SELECT probar('antes de elegir, el teléfono y el correo quedan ocultos',
  'service_role', NULL,
  'SELECT count(*) FROM mensajes WHERE autor = ''cliente'' AND texto LIKE ''%[dato oculto]%'' AND texto NOT LIKE ''%5555%'' AND texto NOT LIKE ''%@%''',
  '1 filas');
SELECT probar('el postulante también puede escribir (los dos inician)',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  format('SELECT count(*) FROM (SELECT enviar_mensaje(%L, %L)) x', (SELECT de_pepe FROM conv),
         'Hola Marta, ¿la tienda necesita facturación electrónica?'),
  '1 filas');
SELECT probar('el postulante tiene 1 mensaje sin leer de la clienta',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  'SELECT count(*) FROM mensajes_sin_leer() WHERE cantidad = 1', '1 filas');
SELECT probar('al abrir la conversación ve los 2 mensajes como desarrollador',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  format('SELECT count(*) FROM (SELECT abrir_conversacion(%L) AS c) x WHERE c->>''rol'' = ''desarrollador'' AND json_array_length(c->''mensajes'') = 2',
         (SELECT de_pepe FROM conv)),
  '1 filas');
SELECT probar('y quedan leídos',
  'authenticated', '22222222-2222-4222-8222-222222222222', 'SELECT count(*) FROM mensajes_sin_leer()', '0 filas');
SELECT probar('otro postulante NO puede abrir esa conversación',
  'authenticated', '11111111-1111-4111-8111-111111111111',
  format('SELECT count(*) FROM (SELECT abrir_conversacion(%L)) x', (SELECT de_pepe FROM conv)),
  'error: No tenés acceso a esta conversación');
SELECT probar('ni leerla directo (0 filas)',
  'authenticated', '11111111-1111-4111-8111-111111111111', 'SELECT count(*) FROM mensajes', '0 filas');
SELECT probar('ni otra clienta',
  'authenticated', '88888888-8888-4888-8888-888888888888',
  format('SELECT count(*) FROM (SELECT enviar_mensaje(%L, %L)) x', (SELECT de_pepe FROM conv), 'hola'),
  'error: No tenés acceso a esta conversación');
SELECT probar('la clienta lee sus mensajes directo (tiempo real)',
  'authenticated', '77777777-7777-4777-8777-777777777777', 'SELECT count(*) FROM mensajes', '2 filas');
SELECT probar('nadie inserta mensajes directo (saltearía el ocultamiento)',
  'authenticated', '77777777-7777-4777-8777-777777777777',
  format('WITH x AS (INSERT INTO mensajes (postulacion_id, autor, texto) VALUES (%L, ''cliente'', ''11 5555 1234'') RETURNING 1) SELECT count(*) FROM x',
         (SELECT de_pepe FROM conv)),
  'permiso denegado');
SELECT probar('anon NO lee la tabla',
  'anon', NULL, 'SELECT count(*) FROM mensajes', 'permiso denegado');
SELECT probar('anon con el token del enlace entra como cliente',
  'anon', NULL,
  format('SELECT count(*) FROM (SELECT abrir_conversacion(%L, %L) AS c) x WHERE c->>''rol'' = ''cliente''',
         (SELECT de_pepe FROM conv), (SELECT token FROM conv)),
  '1 filas');
SELECT probar('anon con un token inventado, no',
  'anon', NULL,
  format('SELECT count(*) FROM (SELECT enviar_mensaje(%L, %L, %L)) x', (SELECT de_pepe FROM conv), 'hola', gen_random_uuid()),
  'error: No tenés acceso a esta conversación');

-- Después de elegir a Pepe: su conversación sigue, ya sin ocultar; la del
-- admin se cierra.
UPDATE bolsa_pedidos SET estado = 'ASIGNADO', asignado_espacio_id = (SELECT id FROM espacios WHERE slug = 'estudio-pepe')
WHERE id = (SELECT pedido FROM conv);
SELECT probar('con el elegido, los datos ya no se ocultan',
  'authenticated', '77777777-7777-4777-8777-777777777777',
  format('SELECT count(*) FROM (SELECT enviar_mensaje(%L, %L) AS m) x WHERE m->>''texto'' LIKE ''%%11 5555 1234%%''',
         (SELECT de_pepe FROM conv), 'Ahora sí: mi cel es 11 5555 1234'),
  '1 filas');
SELECT probar('con los demás postulantes, la conversación se cierra',
  'authenticated', '11111111-1111-4111-8111-111111111111',
  format('SELECT count(*) FROM (SELECT enviar_mensaje(%L, %L)) x', (SELECT del_admin FROM conv), '¿Sigue en pie?'),
  'error: La conversación está cerrada');
SELECT probar('n8n lee los mensajes para avisar',
  'n8n_writer', NULL, 'SELECT count(*) FROM mensajes WHERE avisado_en IS NULL', '3 filas');
SELECT probar('pero sólo puede marcar avisado_en, no cambiar el texto',
  'n8n_writer', NULL, 'WITH x AS (UPDATE mensajes SET texto = ''otro'' RETURNING 1) SELECT count(*) FROM x', 'permiso denegado');

-- ── 29. Etiquetas, directorio y alertas (etapa 10) ─────────────────────────
SELECT probar('una clienta publica con etiquetas: se limpian y no se repiten',
  'authenticated', '88888888-8888-4888-8888-888888888888',
  $q$SELECT count(*) FROM (SELECT publicar_proyecto('Tienda en Shopify para mi marca', 'Migrar mi tienda a Shopify con pagos y envíos.', 'ecommerce', 'media', '1000_2000', 'Laura', NULL, ARRAY[' Shopify ', 'shopify', 'React', ''])) x$q$,
  '1 filas');
SELECT probar('(vistas por n8n) quedaron Shopify y React',
  'n8n_writer', NULL,
  'SELECT count(*) FROM bolsa_pedidos WHERE titulo = ''Tienda en Shopify para mi marca'' AND etiquetas = ARRAY[''Shopify'', ''React'']',
  '1 filas');
SELECT probar('más de 8 etiquetas no se aceptan',
  'authenticated', '88888888-8888-4888-8888-888888888888',
  $q$SELECT count(*) FROM (SELECT publicar_proyecto('Otro proyecto de prueba', 'Descripción suficientemente larga del proyecto.', 'seo', 'baja', 'hasta_300', 'Laura', NULL, ARRAY['a','b','c','d','e','f','g','h','i'])) x$q$,
  'error: Hasta 8 etiquetas');
SELECT probar('un desarrollador ve las etiquetas en la bolsa',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  'SELECT count(*) FROM bolsa_abierta() WHERE titulo = ''Tienda en Shopify para mi marca'' AND ''Shopify'' = ANY (etiquetas)',
  '1 filas');
SELECT probar('el dueño declara sus servicios y sus alertas',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  'WITH x AS (UPDATE espacios SET servicios = ARRAY[''ecommerce'', ''desarrollo_web'']::servicio_tipo[], alerta_presupuesto_min = 1000, alertas_correo = true RETURNING 1) SELECT count(*) FROM x',
  '1 filas');
SELECT probar('nadie cambia los servicios de otro (0 filas)',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  format('WITH x AS (UPDATE espacios SET servicios = ARRAY[''seo'']::servicio_tipo[] WHERE id = %L RETURNING 1) SELECT count(*) FROM x',
         (SELECT id FROM espacios WHERE dueno_id = '11111111-1111-4111-8111-111111111111')),
  '0 filas');
SELECT probar('el directorio público muestra a quien declaró servicios',
  'anon', NULL, 'SELECT count(*) FROM directorio_publico() WHERE slug = ''estudio-pepe'' AND promedio = 4.0', '1 filas');
SELECT probar('y no a quien no declaró ninguno',
  'anon', NULL,
  format('SELECT count(*) FROM directorio_publico() WHERE slug = %L',
         (SELECT slug FROM espacios WHERE dueno_id = '11111111-1111-4111-8111-111111111111')),
  '0 filas');
SELECT probar('filtra por tipo de trabajo',
  'anon', NULL, 'SELECT count(*) FROM directorio_publico(''seo'')', '0 filas');
SELECT probar('y por habilidad, sin distinguir mayúsculas',
  'anon', NULL, 'SELECT count(*) FROM directorio_publico(NULL, ''next'')', '1 filas');
SELECT probar('n8n lee los servicios y las alertas de cada espacio',
  'n8n_writer', NULL,
  'SELECT count(*) FROM espacios WHERE ''ecommerce'' = ANY (servicios) AND alerta_presupuesto_min = 1000 AND alertas_correo AND configurado_en IS NOT NULL',
  '1 filas');

-- ── 30. Pago protegido por hitos (etapa 11) ────────────────────────────────
-- El proyecto de Marta (7777) de la sección 28 quedó asignado a Pepe (2222):
-- se le crea el lead, que es «de la plataforma». LD-PEPE-0001 es un cliente
-- propio de Pepe y LD-TEST-0001, del admin (1111), que también es desarrollador.
INSERT INTO leads (lead_id, espacio_id, nombre, email, presupuesto, urgencia, servicio, estado, score, tier)
VALUES ('LD-HITOS-0001', (SELECT id FROM espacios WHERE slug = 'estudio-pepe'),
        'Marta Gómez', 'marta@test.com', 1000, 'media', 'ecommerce', 'NUEVO', 60, 'WARM')
ON CONFLICT (lead_id) DO NOTHING;
UPDATE bolsa_pedidos SET lead_id = 'LD-HITOS-0001' WHERE titulo = 'Tienda online para mi marca';

SELECT probar('el desarrollador divide en hitos su proyecto de la plataforma',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  $q$SELECT count(*) FROM (SELECT definir_cobro('LD-HITOS-0001', '[{"titulo":"Diseño","monto":300},{"titulo":"Desarrollo","monto":"500.50"},{"titulo":"Publicación","monto":199.50,"descripcion":"Dominio y puesta en marcha"}]')) x$q$,
  '1 filas');
SELECT probar('en un proyecto de la plataforma no puede volver a la factura única',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  $q$SELECT count(*) FROM (SELECT definir_cobro('LD-HITOS-0001', '[]')) x$q$,
  'error: Los proyectos que llegan por la plataforma se cobran por hitos');
INSERT INTO leads (lead_id, espacio_id, nombre, email, presupuesto, urgencia, servicio, estado, score, tier)
VALUES ('LD-HITOS-0003', (SELECT id FROM espacios WHERE slug = 'estudio-pepe'),
        'Cliente propio de Pepe', 'propio@test.com', 800, 'media', 'desarrollo_web', 'NUEVO', 40, 'WARM')
ON CONFLICT (lead_id) DO NOTHING;
SELECT probar('con un cliente propio sí elige la factura única',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  $q$SELECT count(*) FROM (SELECT definir_cobro('LD-HITOS-0003', NULL) AS n) x WHERE n = 0$q$,
  '1 filas');
SELECT probar('otro desarrollador no define los hitos de un proyecto ajeno',
  'authenticated', '11111111-1111-4111-8111-111111111111',
  $q$SELECT count(*) FROM (SELECT definir_cobro('LD-HITOS-0001', '[{"titulo":"Todo","monto":1}]')) x$q$,
  'error: No tenés acceso a este proyecto');
SELECT probar('un monto con tres decimales no se acepta',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  $q$SELECT count(*) FROM (SELECT definir_cobro('LD-HITOS-0001', '[{"titulo":"Diseño","monto":"10.555"}]')) x$q$,
  'error: El monto del hito 1 tiene que ser de al menos US$ 1, con hasta dos decimales');
SELECT probar('(vistos por n8n) quedaron 3 hitos al 5% y el lead cobra por hitos',
  'n8n_writer', NULL,
  $q$SELECT count(*) FROM hitos h JOIN leads l ON l.lead_id = h.lead_id WHERE h.lead_id = 'LD-HITOS-0001' AND h.comision_porcentaje = 5 AND l.cobro_modo = 'hitos'$q$,
  '3 filas');
SELECT probar('anon NO lee los hitos',
  'anon', NULL, 'SELECT count(*) FROM hitos', 'permiso denegado');
SELECT probar('el desarrollador lee los hitos de su espacio',
  'authenticated', '22222222-2222-4222-8222-222222222222', 'SELECT count(*) FROM hitos', '3 filas');
SELECT probar('otro desarrollador no ve hitos ajenos (0 filas)',
  'authenticated', '11111111-1111-4111-8111-111111111111', 'SELECT count(*) FROM hitos', '0 filas');
SELECT probar('nadie cambia un hito directo (saltearía las reglas)',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  'WITH x AS (UPDATE hitos SET estado = ''LIBERADO'' RETURNING 1) SELECT count(*) FROM x', 'permiso denegado');
SELECT probar('n8n tampoco cambia el estado, sólo guarda la sesión de pago',
  'n8n_writer', NULL,
  'WITH x AS (UPDATE hitos SET estado = ''FONDEADO'' RETURNING 1) SELECT count(*) FROM x', 'permiso denegado');
SELECT probar('los eventos no se leen desde el panel',
  'authenticated', '22222222-2222-4222-8222-222222222222', 'SELECT count(*) FROM hitos_eventos', 'permiso denegado');

CREATE TEMP TABLE ph AS
SELECT l.proyecto_token AS token,
       (SELECT id FROM hitos WHERE lead_id = 'LD-HITOS-0001' AND orden = 1) AS h1,
       (SELECT id FROM hitos WHERE lead_id = 'LD-HITOS-0001' AND orden = 2) AS h2,
       (SELECT id FROM hitos WHERE lead_id = 'LD-HITOS-0001' AND orden = 3) AS h3
FROM leads l WHERE l.lead_id = 'LD-HITOS-0001';
GRANT SELECT ON ph TO PUBLIC;

SELECT probar('la clienta con cuenta llega a la página del proyecto desde mis_proyectos()',
  'authenticated', '77777777-7777-4777-8777-777777777777',
  format('SELECT count(*) FROM mis_proyectos() WHERE proyecto_token = %L', (SELECT token FROM ph)), '1 filas');
SELECT probar('antes de que el cliente acepte, no se paga nada',
  'n8n_writer', NULL,
  format('SELECT count(*) FROM hito_para_cobrar(%L, %L)', (SELECT h1 FROM ph), (SELECT token FROM ph)), '0 filas');
-- El cliente acepta la propuesta (lo hace n8n con el enlace de /aceptar).
UPDATE leads SET estado = 'ACEPTADO', fecha_aceptacion = now() WHERE lead_id = 'LD-HITOS-0001';
SELECT probar('aceptada, ya no se puede cambiar la forma de cobro',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  $q$SELECT count(*) FROM (SELECT definir_cobro('LD-HITOS-0001', '[{"titulo":"Todo junto","monto":1000}]')) x$q$,
  'error: La forma de cobro sólo se cambia antes de enviar la propuesta');
SELECT probar('no se paga el hito 2 antes que el 1',
  'n8n_writer', NULL,
  format('SELECT count(*) FROM hito_para_cobrar(%L, %L)', (SELECT h2 FROM ph), (SELECT token FROM ph)), '0 filas');
SELECT probar('ni con un token inventado',
  'n8n_writer', NULL,
  format('SELECT count(*) FROM hito_para_cobrar(%L, %L)', (SELECT h1 FROM ph), gen_random_uuid()), '0 filas');
SELECT probar('el hito 1, con el token del proyecto, sí',
  'n8n_writer', NULL,
  format('SELECT count(*) FROM hito_para_cobrar(%L, %L) WHERE monto = 300', (SELECT h1 FROM ph), (SELECT token FROM ph)), '1 filas');
SELECT probar('el público no llama a las funciones de cobro',
  'anon', NULL,
  format('SELECT count(*) FROM hito_para_cobrar(%L, %L)', (SELECT h1 FROM ph), (SELECT token FROM ph)), 'permiso denegado');
SELECT probar('Stripe confirma el pago: el hito queda fondeado',
  'n8n_writer', NULL,
  format('SELECT count(*) FROM (SELECT hito_fondeado(%L, ''cs_1'', ''pi_1'') AS f) x WHERE f', (SELECT h1 FROM ph)), '1 filas');
SELECT probar('la misma confirmación dos veces no hace nada',
  'n8n_writer', NULL,
  format('SELECT count(*) FROM (SELECT hito_fondeado(%L, ''cs_1'', ''pi_1'') AS f) x WHERE NOT f', (SELECT h1 FROM ph)), '1 filas');
SELECT probar('la clienta con cuenta ve su proyecto como cliente',
  'authenticated', '77777777-7777-4777-8777-777777777777',
  $q$SELECT count(*) FROM (SELECT ver_proyecto('LD-HITOS-0001') AS p) x WHERE p->>'rol' = 'cliente' AND json_array_length(p->'hitos') = 3 AND (p->>'de_plataforma')::boolean$q$,
  '1 filas');
SELECT probar('y le toca pagar el hito 2',
  'authenticated', '77777777-7777-4777-8777-777777777777',
  $q$SELECT count(*) FROM json_array_elements((SELECT ver_proyecto('LD-HITOS-0001'))->'hitos') h WHERE (h->>'puede_pagar')::boolean AND (h->>'orden')::int = 2$q$,
  '1 filas');
SELECT probar('el enlace con el token también abre el proyecto',
  'anon', NULL,
  format('SELECT count(*) FROM (SELECT ver_proyecto(NULL, %L) AS p) x WHERE p->>''rol'' = ''cliente''', (SELECT token FROM ph)), '1 filas');
SELECT probar('con un token inventado, no',
  'anon', NULL,
  format('SELECT count(*) FROM (SELECT ver_proyecto(NULL, %L) AS p) x WHERE p IS NOT NULL', gen_random_uuid()), 'error: No tenés acceso a este proyecto');
SELECT probar('ni otra clienta',
  'authenticated', '88888888-8888-4888-8888-888888888888',
  $q$SELECT count(*) FROM (SELECT ver_proyecto('LD-HITOS-0001') AS p) x WHERE p IS NOT NULL$q$, 'error: No tenés acceso a este proyecto');
SELECT probar('la clienta no puede marcar una entrega',
  'authenticated', '77777777-7777-4777-8777-777777777777',
  format('SELECT count(*) FROM (SELECT entregar_hito(%L, ''Listo el diseño'')) x', (SELECT h1 FROM ph)),
  'error: No tenés acceso a este hito');
SELECT probar('el desarrollador entrega y corre el plazo de 7 días',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  format('SELECT count(*) FROM (SELECT entregar_hito(%L, ''Diseño aprobado en Figma'') AS t) x WHERE t BETWEEN now() + interval ''6 days 23 hours'' AND now() + interval ''7 days 1 hour''', (SELECT h1 FROM ph)),
  '1 filas');
SELECT probar('el desarrollador no se aprueba a sí mismo',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  format('SELECT count(*) FROM (SELECT aprobar_hito(%L)) x', (SELECT h1 FROM ph)), 'error: No tenés acceso a este hito');
SELECT probar('la clienta aprueba con el token del enlace',
  'anon', NULL,
  format('SELECT count(*) FROM (SELECT aprobar_hito(%L, %L)) x', (SELECT h1 FROM ph), (SELECT token FROM ph)), '1 filas');
SELECT probar('queda liberado: 300 al desarrollador y 15 de comisión',
  'service_role', NULL,
  format('SELECT count(*) FROM hitos WHERE id = %L AND estado = ''LIBERADO'' AND monto_liberado = 300 AND comision = 15 AND libera_en IS NULL', (SELECT h1 FROM ph)),
  '1 filas');
SELECT probar('n8n ve la transferencia pendiente: 285',
  'n8n_writer', NULL,
  format('SELECT count(*) FROM hitos_por_mover(true) WHERE id = %L AND movimiento = ''transferir'' AND importe = 285', (SELECT h1 FROM ph)),
  '1 filas');
SELECT probar('la registra una sola vez',
  'n8n_writer', NULL,
  format('SELECT count(*) FROM (SELECT hito_movido(%L, ''transferir'', ''tr_1'') AS a, hito_movido(%L, ''transferir'', ''tr_2'') AS b) x WHERE a AND NOT b',
         (SELECT h1 FROM ph), (SELECT h1 FROM ph)),
  '1 filas');

-- Hito 2: se paga y la clienta lo disputa.
SELECT hito_fondeado((SELECT h2 FROM ph), 'cs_2', 'pi_2');
SELECT probar('una disputa necesita un motivo',
  'authenticated', '77777777-7777-4777-8777-777777777777',
  format('SELECT count(*) FROM (SELECT disputar_hito(%L, ''mal'')) x', (SELECT h2 FROM ph)),
  'error: Contá qué pasó (de 10 a 2000 caracteres)');
SELECT probar('la clienta disputa el hito 2',
  'authenticated', '77777777-7777-4777-8777-777777777777',
  format('SELECT count(*) FROM (SELECT disputar_hito(%L, ''El carrito no calcula los envíos.'')) x', (SELECT h2 FROM ph)),
  '1 filas');
SELECT probar('el desarrollador no resuelve disputas',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  format('SELECT count(*) FROM (SELECT resolver_disputa(%L, 500.50, ''Está todo bien'')) x', (SELECT h2 FROM ph)),
  'error: Sólo el admin de la plataforma resuelve disputas');
SELECT probar('ni ve la lista de disputas',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  'SELECT count(*) FROM disputas_abiertas()', 'error: Sólo el admin de la plataforma ve las disputas');
-- Lo que se dijeron las partes en la conversación de la postulación elegida.
INSERT INTO mensajes (postulacion_id, autor, texto)
SELECT po.id, 'cliente', 'El carrito no suma el envío a Córdoba.'
FROM postulaciones po JOIN bolsa_pedidos b ON b.id = po.pedido_id
WHERE b.lead_id = 'LD-HITOS-0001' AND po.espacio_id = (SELECT id FROM espacios WHERE slug = 'estudio-pepe');
-- Otro postulante del mismo pedido (el admin) también le había escrito: esa
-- conversación no es de las partes y no tiene que aparecer en el detalle.
INSERT INTO postulaciones (pedido_id, espacio_id, mensaje, precio_estimado, plazo)
SELECT b.id, (SELECT id FROM espacios WHERE dueno_id = '11111111-1111-4111-8111-111111111111'),
       'Puedo armar la tienda en dos semanas.', 900, '2 semanas'
FROM bolsa_pedidos b WHERE b.lead_id = 'LD-HITOS-0001'
ON CONFLICT (pedido_id, espacio_id) DO NOTHING;
INSERT INTO mensajes (postulacion_id, autor, texto)
SELECT po.id, 'cliente', 'Mensaje a otro postulante que no se eligió.'
FROM postulaciones po JOIN bolsa_pedidos b ON b.id = po.pedido_id
WHERE b.lead_id = 'LD-HITOS-0001'
  AND po.espacio_id = (SELECT id FROM espacios WHERE dueno_id = '11111111-1111-4111-8111-111111111111');
SELECT probar('(existe el mensaje al otro postulante)',
  'service_role', NULL, $q$SELECT count(*) FROM mensajes WHERE texto LIKE '%otro postulante%'$q$, '1 filas');
SELECT probar('anon no abre el detalle de una disputa',
  'anon', NULL,
  format('SELECT count(*) FROM (SELECT disputa_detalle(%L) AS d) x WHERE d IS NOT NULL', (SELECT h2 FROM ph)),
  'permiso denegado');
SELECT probar('ni lista las resueltas',
  'anon', NULL, 'SELECT count(*) FROM disputas_resueltas()', 'permiso denegado');
SELECT probar('el desarrollador no abre el detalle de una disputa',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  format('SELECT count(*) FROM (SELECT disputa_detalle(%L) AS d) x WHERE d IS NOT NULL', (SELECT h2 FROM ph)),
  'error: Sólo el admin de la plataforma ve las disputas');
SELECT probar('el admin ve el detalle: historial, conversación y que la puede resolver',
  'authenticated', '11111111-1111-4111-8111-111111111111',
  format($q$SELECT count(*) FROM (SELECT disputa_detalle(%L) AS d) x
            WHERE json_array_length(d->'eventos') = 2 AND json_array_length(d->'mensajes') >= 1
              AND (d->'mensajes')::text NOT LIKE '%%otro postulante%%'
              AND json_array_length(d->'proyecto'->'hitos') = 3 AND (d->>'puede_resolver')::boolean$q$, (SELECT h2 FROM ph)),
  '1 filas');
SELECT probar('un hito que nunca se disputó no abre la conversación',
  'authenticated', '11111111-1111-4111-8111-111111111111',
  format('SELECT count(*) FROM (SELECT disputa_detalle(%L) AS d) x WHERE d IS NOT NULL', (SELECT h1 FROM ph)),
  'error: Este hito no tuvo una disputa');
SELECT probar('el admin ve la disputa abierta y la puede resolver',
  'authenticated', '11111111-1111-4111-8111-111111111111',
  'SELECT count(*) FROM disputas_abiertas() WHERE espacio_nombre IS NOT NULL AND puede_resolver', '1 filas');
SELECT probar('y la ve en el proyecto como admin',
  'authenticated', '11111111-1111-4111-8111-111111111111',
  $q$SELECT count(*) FROM (SELECT ver_proyecto('LD-HITOS-0001') AS p) x WHERE p->>'rol' = 'admin'$q$, '1 filas');
SELECT probar('no puede liberar más que el monto',
  'authenticated', '11111111-1111-4111-8111-111111111111',
  format('SELECT count(*) FROM (SELECT resolver_disputa(%L, 600, ''Todo al desarrollador'')) x', (SELECT h2 FROM ph)),
  'error: Lo que se libera tiene que estar entre 0 y el monto del hito');
SELECT probar('la resuelve en partes: 200 al desarrollador',
  'authenticated', '11111111-1111-4111-8111-111111111111',
  format('SELECT count(*) FROM (SELECT resolver_disputa(%L, 200, ''Se entregó la mitad del carrito'')) x', (SELECT h2 FROM ph)),
  '1 filas');
SELECT probar('queda registrado quién la resolvió',
  'authenticated', '11111111-1111-4111-8111-111111111111',
  $q$SELECT count(*) FROM disputas_resueltas() WHERE cierre = 'resuelto' AND resuelto_por = 'admin@gmail.com' AND monto_liberado = 200 AND monto_reembolsado = 300.50$q$,
  '1 filas');
SELECT probar('ya no está entre las abiertas',
  'authenticated', '11111111-1111-4111-8111-111111111111',
  'SELECT count(*) FROM disputas_abiertas()', '0 filas');
SELECT probar('y el detalle no deja resolverla otra vez',
  'authenticated', '11111111-1111-4111-8111-111111111111',
  format($q$SELECT count(*) FROM (SELECT disputa_detalle(%L) AS d) x WHERE NOT (d->>'puede_resolver')::boolean$q$, (SELECT h2 FROM ph)),
  '1 filas');
SELECT probar('el desarrollador tampoco ve las resueltas',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  'SELECT count(*) FROM disputas_resueltas()', 'error: Sólo el admin de la plataforma ve las disputas');
SELECT probar('n8n ve los dos movimientos: 190 al desarrollador y 300.50 a la clienta',
  'n8n_writer', NULL,
  format('SELECT count(*) FROM hitos_por_mover(true) WHERE id = %L AND ((movimiento = ''transferir'' AND importe = 190) OR (movimiento = ''reembolsar'' AND importe = 300.50))', (SELECT h2 FROM ph)),
  '2 filas');

-- Hito 3: se paga y se entrega; la clienta no contesta.
SELECT hito_fondeado((SELECT h3 FROM ph), 'cs_3', 'pi_3');
SET request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222"}';
SELECT entregar_hito((SELECT h3 FROM ph), 'Tienda publicada en el dominio');
RESET request.jwt.claims;
SELECT probar('antes del plazo, el cron no libera nada',
  'n8n_writer', NULL, 'SELECT count(*) FROM liberar_vencidos()', '0 filas');
UPDATE hitos SET libera_en = now() - interval '1 minute' WHERE id = (SELECT h3 FROM ph);
SELECT probar('vencido el plazo, el cron lo libera solo',
  'n8n_writer', NULL, 'SELECT count(*) FROM liberar_vencidos()', '1 filas');
SELECT probar('con todos los hitos cerrados, el proyecto termina',
  'service_role', NULL,
  $q$SELECT count(*) FROM leads WHERE lead_id = 'LD-HITOS-0001' AND estado = 'CERRADO' AND fecha_cierre IS NOT NULL$q$, '1 filas');
SELECT probar('la línea de tiempo registra cada paso',
  'n8n_writer', NULL,
  $q$SELECT count(*) FROM (SELECT DISTINCT tipo FROM hitos_eventos WHERE lead_id = 'LD-HITOS-0001') x$q$, '7 filas');

-- El admin también es desarrollador: una disputa de su proyecto no la
-- resuelve él.
INSERT INTO leads (lead_id, espacio_id, nombre, email, presupuesto, urgencia, servicio, estado, score, tier)
VALUES ('LD-HITOS-0002', (SELECT id FROM espacios WHERE dueno_id = '11111111-1111-4111-8111-111111111111'),
        'Cliente del admin', 'cliente-admin@test.com', 150, 'baja', 'soporte', 'NUEVO', 20, 'COLD')
ON CONFLICT (lead_id) DO NOTHING;
SET request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111"}';
SELECT definir_cobro('LD-HITOS-0002', '[{"titulo":"Primera parte","monto":100},{"titulo":"Segunda parte","monto":50}]');
RESET request.jwt.claims;
UPDATE leads SET estado = 'ACEPTADO' WHERE lead_id = 'LD-HITOS-0002';
SELECT hito_fondeado((SELECT id FROM hitos WHERE lead_id = 'LD-HITOS-0002' AND orden = 1), 'cs_4', 'pi_4');
SELECT disputar_hito((SELECT id FROM hitos WHERE lead_id = 'LD-HITOS-0002' AND orden = 1), 'No se entregó nada todavía.',
                     (SELECT proyecto_token FROM leads WHERE lead_id = 'LD-HITOS-0002'));
SELECT probar('en la lista del admin figura, pero como no resoluble',
  'authenticated', '11111111-1111-4111-8111-111111111111',
  $q$SELECT count(*) FROM disputas_abiertas() WHERE lead_id = 'LD-HITOS-0002' AND NOT puede_resolver$q$,
  '1 filas');
SELECT probar('el detalle ya le avisa al admin que es un proyecto suyo',
  'authenticated', '11111111-1111-4111-8111-111111111111',
  $q$SELECT count(*) FROM (SELECT disputa_detalle((SELECT id FROM hitos WHERE lead_id = 'LD-HITOS-0002' AND orden = 1)) AS d) x
     WHERE NOT (d->>'puede_resolver')::boolean AND json_array_length(d->'mensajes') = 0$q$,
  '1 filas');
SELECT probar('el admin no resuelve una disputa de un proyecto suyo',
  'authenticated', '11111111-1111-4111-8111-111111111111',
  $q$SELECT count(*) FROM (SELECT resolver_disputa((SELECT id FROM hitos WHERE lead_id = 'LD-HITOS-0002' AND orden = 1), 100, 'Me lo quedo')) x$q$,
  'error: No podés resolver una disputa de un proyecto tuyo');
SELECT probar('pero como desarrollador puede devolver la plata',
  'authenticated', '11111111-1111-4111-8111-111111111111',
  $q$SELECT count(*) FROM (SELECT devolver_hito((SELECT id FROM hitos WHERE lead_id = 'LD-HITOS-0002' AND orden = 1), 'Tiene razón')) x$q$,
  '1 filas');
SELECT probar('la disputa que cerró el desarrollador devolviendo figura entre las resueltas',
  'authenticated', '11111111-1111-4111-8111-111111111111',
  $q$SELECT count(*) FROM disputas_resueltas() WHERE lead_id = 'LD-HITOS-0002' AND cierre = 'devuelto' AND resuelto_por IS NULL$q$,
  '1 filas');
SELECT probar('no se anula un hito ajeno',
  'authenticated', '22222222-2222-4222-8222-222222222222',
  $q$SELECT count(*) FROM (SELECT anular_hito((SELECT id FROM hitos WHERE lead_id = 'LD-HITOS-0002' AND orden = 2))) x$q$,
  'error: No tenés acceso a este hito');
SELECT probar('el propio, sin pagar, sí',
  'authenticated', '11111111-1111-4111-8111-111111111111',
  $q$SELECT count(*) FROM (SELECT anular_hito((SELECT id FROM hitos WHERE lead_id = 'LD-HITOS-0002' AND orden = 2))) x$q$,
  '1 filas');
SELECT probar('un pago que llega después de anulado queda para devolver entero',
  'n8n_writer', NULL,
  $q$SELECT count(*) FROM (SELECT hito_fondeado((SELECT id FROM hitos WHERE lead_id = 'LD-HITOS-0002' AND orden = 2), 'cs_5', 'pi_5') AS f) x WHERE f$q$,
  '1 filas');
SELECT probar('(n8n ve el reembolso de 50 pendiente)',
  'n8n_writer', NULL,
  $q$SELECT count(*) FROM hitos_por_mover(true) m JOIN hitos h ON h.id = m.id WHERE h.lead_id = 'LD-HITOS-0002' AND h.orden = 2 AND m.movimiento = 'reembolsar' AND m.importe = 50$q$,
  '1 filas');
SELECT probar('y el proyecto del admin, con todo devuelto o anulado, queda cerrado',
  'service_role', NULL,
  $q$SELECT count(*) FROM leads WHERE lead_id = 'LD-HITOS-0002' AND estado = 'CERRADO'$q$, '1 filas');

-- ── Reporte ────────────────────────────────────────────────────────────────
\o
\pset border 2
SELECT
  lpad(n::text, 2)                                  AS "#",
  CASE WHEN ok THEN 'OK' ELSE 'FALLA' END           AS "estado",
  caso                                              AS "caso",
  esperado                                          AS "esperado",
  obtenido                                          AS "obtenido"
FROM resultados ORDER BY n;

SELECT count(*) FILTER (WHERE ok) AS "casos ok", count(*) FILTER (WHERE NOT ok) AS "casos con falla" FROM resultados;

-- Corta con código de salida != 0 si algún caso falló.
DO $$
DECLARE fallas int;
BEGIN
  SELECT count(*) INTO fallas FROM resultados WHERE NOT ok;
  IF fallas > 0 THEN
    RAISE EXCEPTION 'La verificación de RLS falló en % caso(s)', fallas;
  END IF;
END $$;
