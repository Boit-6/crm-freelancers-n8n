// Regresiones offline de los límites de pago y del orden de efectos externos.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflow = JSON.parse(readFileSync(path.join(root, 'workflow/crm_postgres.json'), 'utf8'));
const avisos = JSON.parse(readFileSync(path.join(root, 'workflow/avisos.json'), 'utf8'));
const schema = readFileSync(path.join(root, 'db/schema.sql'), 'utf8');
const node = (name) => {
  const found = workflow.nodes.find(n => n.name === name);
  assert.ok(found, `falta ${name}`);
  return found;
};
const edges = (name) => Object.values(workflow.connections[name]?.main || {}).flat().map(e => e.node);
const reaches = (start, target) => {
  const seen = new Set(); const todo = [start];
  while (todo.length) {
    const next = todo.pop();
    if (next === target) return true;
    if (seen.has(next)) continue;
    seen.add(next); todo.push(...edges(next));
  }
  return false;
};
const run = (name, json, env = { STRIPE_SECRET_KEY: 'test' }, lookup = {}) => {
  const $input = { first: () => ({ json }) };
  const $ = (key) => ({ first: () => ({ json: lookup[key] || {} }) });
  return new Function('$input', '$env', '$', node(name).parameters.jsCode)($input, env, $)[0].json;
};

const factura = { factura_id: 'FAC-1', estado_pago: 'PENDIENTE', stripe_account_id: 'acct_test', stripe_cobros_activos: true };
assert.equal(run('Code - Decidir Pago', { ...factura, checkout_url: 'https://checkout.stripe.com/test' }).accion, 'redirigir');
assert.equal(run('Code - Decidir Pago', factura).status, 409);
assert.equal(run('Code - Decidir Pago', { ...factura, checkout_reservado: true }).accion, 'stripe');
const hito = { id: 'hito-1', stripe_cobros_activos: true, espacio_nombre: 'Espacio' };
const lookup = { 'Code - Leer Pagar Hito': { proyecto_token: 'token' } };
assert.equal(run('Code - Decidir Pago Hito', { ...hito, checkout_url: 'https://checkout.stripe.com/test' }, undefined, lookup).accion, 'redirigir');
assert.equal(run('Code - Decidir Pago Hito', hito, undefined, lookup).status, 409);
assert.equal(run('Code - Decidir Pago Hito', { ...hito, checkout_reservado: true }, undefined, lookup).accion, 'stripe');
for (const name of ['Postgres - Buscar Factura a Pagar', 'Postgres - Buscar Hito a Pagar']) {
  const q = node(name).parameters.query;
  assert.match(q, /UPDATE (facturas|hitos).*stripe_checkout_reservado_en = now\(\)/s);
  assert.match(q, /stripe_checkout_intento_id IS NULL/);
  assert.match(q, /stripe_checkout_expira_en > now\(\) \+ interval '1 minute'/);
  assert.match(q, /INSERT INTO checkout_revisiones/);
  assert.doesNotMatch(q, /interval '45 minutes'/);
  assert.match(q, /stripe_checkout_id IS NULL/);
}
for (const name of ['Postgres - Guardar Checkout', 'Postgres - Guardar Checkout Hito']) {
  assert.match(node(name).parameters.query, /stripe_checkout_url = \$3/);
  assert.match(node(name).parameters.query, /stripe_checkout_intento_id = \$4::uuid/);
  assert.match(node(name).parameters.query, /stripe_checkout_expira_en = to_timestamp\(\$5::numeric\)/);
  assert.match(node(name).parameters.query, /stripe_creada_no_persistida/);
  assert.match(node(name).parameters.query, /stripe_creacion_sin_respuesta/);
  assert.match(node(name).parameters.query, /COALESCE\(NULLIF\(\$2, ''\), \$4::text\)/);
  assert.match(node(name).parameters.query, /RETURNING/);
}
assert.ok(reaches('Gmail - Enviar Propuesta', 'Postgres - Estado Propuesta Enviada'));
assert.ok(reaches('Postgres - Estado Propuesta Enviada', 'IF - Estado Propuesta Confirmado?'));
assert.ok(reaches('IF - Estado Propuesta Confirmado?', 'Respond - Propuesta Enviada'));
assert.ok(reaches('IF - Estado Propuesta Confirmado?', 'Respond - Propuesta Envio en Revision'));
assert.match(node('Postgres - Estado Propuesta Enviada').parameters.query, /SELECT \(a\.lead_id IS NOT NULL\) AS aplico/);
assert.match(node('Postgres - Estado Propuesta Enviada').parameters.query, /propuesta_envio_intento_id = \$2::uuid AND accept_token = \$3::uuid AND espacio_id = \$4::uuid/);
assert.doesNotMatch(node('Postgres - Estado Propuesta Enviada').parameters.query, /propuesta_envio_iniciado_en = \$2/);
assert.match(node('Postgres - Estado Propuesta Enviada').parameters.options.queryReplacement, /Postgres - Guardar Terminos/);
assert.equal(node('Respond - Propuesta Envio en Revision').parameters.options.responseCode, 409);
assert.equal(node('Respond - Propuesta No Aplica').parameters.options.responseCode, 409);
assert.ok(!reaches('Respond - Propuesta Enviada', 'Gmail - Enviar Propuesta'));
assert.match(node('Postgres - Lead Cerrado').parameters.query, /estado_trabajo = 'ENTREGADO'/);
assert.match(node('Postgres - Lead Cerrado').parameters.query, /estado_pago IN \('COBRADO'\)/);
assert.match(node('Postgres - Lead Cerrado').parameters.query, /SELECT \(c\.lead_id IS NOT NULL\) AS aplico/);
assert.match(JSON.stringify(node('IF - Cierre Aplicó?').parameters.conditions), /\$json\.aplico/);
assert.ok(!reaches('Postgres - Lead Cerrado', 'Postgres - Factura Cobrada'));
assert.ok(reaches('Postgres - Log Pago No Aplicado', 'Respond - Stripe Pago No Aplicado'));
assert.ok(reaches('Postgres - Log Pago Hito No Aplicado', 'Respond - Stripe OK (Hito)'));
assert.ok(!reaches('IF - Pago Aplicado?', 'Respond - Stripe Pago No Aplicado') || reaches('IF - Pago Aplicado?', 'Postgres - Log Pago No Aplicado'));
assert.match(node('Postgres - Log Pago No Aplicado').parameters.query, /INSERT INTO pagos_no_aplicados/);
const registrarAviso = avisos.nodes.find(n => n.name === 'Postgres - Registrar Aviso');
assert.ok(registrarAviso && !registrarAviso.onError);
assert.match(registrarAviso.parameters.query, /INSERT INTO avisos/);
assert.match(avisos.nodes.find(n => n.name === 'Sticky Note').parameters.content, /ACK del hito.*persistido en `avisos`/s);
assert.match(schema, /CREATE TABLE IF NOT EXISTS pagos_no_aplicados/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS checkout_revisiones/);
assert.match(node('Postgres - Hitos por Mover').parameters.query, /hitos_por_mover\(\$1::boolean\)/);
assert.match(schema, /IF p_configurado IS NOT TRUE THEN/);
assert.match(node('Postgres - Guardar Terminos').parameters.query, /propuesta_envio_iniciado_en = now\(\)/);
assert.match(node('Postgres - Guardar Terminos').parameters.query, /propuesta_envio_intento_id = gen_random_uuid\(\)/);
assert.match(node('Postgres - Guardar Terminos').parameters.query, /propuesta_envio_iniciado_en IS NULL/);
assert.match(node('Postgres - Guardar Terminos').parameters.query, /SELECT \(a\.lead_id IS NOT NULL\) AS aplico/);
assert.match(JSON.stringify(node('IF - Terminos Aplicaron?').parameters.conditions), /\$json\.aplico/);
assert.match(node('Postgres - Asignar Pedido Bolsa').parameters.query, /propuesta_envio_iniciado_en = NULL/);
assert.match(node('Postgres - Asignar Pedido Bolsa').parameters.query, /propuesta_envio_intento_id = NULL/);
assert.match(node('Postgres - Revisar Checkout Pendientes').parameters.query, /INSERT INTO checkout_revisiones/);
assert.ok(reaches('💸 Cron - Hitos', 'Postgres - Revisar Checkout Pendientes'));
assert.match(node('Postgres - Avisos Checkout Pendientes').parameters.query, /aviso_avisado_en IS NULL/);
assert.match(node('Postgres - Avisos Checkout Pendientes').parameters.query, /FROM checkout_revisiones r/);
assert.ok(reaches('Postgres - Avisos Checkout Pendientes', 'Aviso - Checkout para Revision'));
assert.ok(reaches('Aviso - Checkout para Revision', 'Postgres - Confirmar Aviso Checkout'));
assert.equal(node('Aviso - Checkout para Revision').parameters.options.waitForSubWorkflow, true);
assert.equal(node('Aviso - Checkout para Revision').parameters.mode, 'each');
assert.notEqual(node('Aviso - Checkout para Revision').onError, 'continueRegularOutput');
for (const name of ['Postgres - Confirmar Aviso Checkout', 'Postgres - Confirmar Aviso Hito',
  'Postgres - Confirmar Correo Hito', 'Postgres - Confirmar Aviso Mensajes']) {
  assert.notEqual(node(name).executeOnce, true, `${name} debe confirmar cada item`);
}
assert.match(node('Postgres - Confirmar Aviso Checkout').parameters.options.queryReplacement,
  /\$\('Postgres - Avisos Checkout Pendientes'\)\.item\.json\.identidad/);
assert.doesNotMatch(node('Postgres - Confirmar Aviso Checkout').parameters.options.queryReplacement, /\.first\(\)/);
assert.match(schema, /GRANT SELECT, INSERT, UPDATE \(aviso_avisado_en\) ON checkout_revisiones TO n8n_writer/);
assert.equal(node('HTTP - Stripe Crear Checkout').onError, 'continueRegularOutput');
assert.equal(node('HTTP - Stripe Checkout Hito').onError, 'continueRegularOutput');
const corsHooks = workflow.nodes.filter(n => n.type === 'n8n-nodes-base.webhook' && n.parameters.options?.allowedOrigins);
assert.equal(corsHooks.length, 15);
for (const hook of corsHooks) {
  const origins = hook.parameters.options.allowedOrigins;
  assert.equal(origins, 'http://localhost:3000,https://formulario-leads-psi.vercel.app');
  assert.doesNotMatch(origins, /=\{\{|\$env|\*/);
}
assert.match(schema, /stripe_transfer_intentado_en = CASE WHEN transferir THEN now\(\)/);
assert.match(schema, /FOR UPDATE OF h SKIP LOCKED/);
assert.match(schema, /IF l\.estado <> 'NUEVO' OR l\.propuesta_envio_intento_id IS NOT NULL/);
assert.throws(() => run('Code - Leer Terminos Propuesta', { body: { lead_id: '1', precio: '0.001' } }), /dos decimales/);
assert.equal(run('Code - Leer Terminos Propuesta', { body: { lead_id: '1', precio: '0.01' } }).precio, 0.01);
console.log('backend_financiero: regresiones offline OK');
