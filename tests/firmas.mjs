// Verificación de la firma Stripe-Signature de los eventos que Stripe manda al
// webhook de la plataforma (`Code - Verificar Evento Stripe`): ejecuta el
// código del nodo tal cual está en el workflow con firmas válidas, falsas,
// truncadas, viejas y ausentes, y con eventos que no son un pago.
//
// Hasta el 24-sep-2026 verificaba la x-signature de MercadoPago; el cobro pasó
// a Stripe Connect.
//
// Uso: node tests/firmas.mjs
import {createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const wf = JSON.parse(readFileSync(path.join(aqui, '..', 'workflow', 'crm_postgres.json'), 'utf8'));
const require = createRequire(import.meta.url);
const jsCode = wf.nodes.find((n) => n.name === 'Code - Verificar Evento Stripe').parameters.jsCode;

let ok = 0, fail = 0;
const check = (nombre, condicion, detalle) => {
  if (condicion) { console.log('OK    ' + nombre); ok++; }
  else { console.log('FAIL  ' + nombre + (detalle ? '  ->  ' + detalle : '')); fail++; }
};

const SECRETO = 'whsec_prueba';

// Ejecuta el nodo como lo hace n8n: el cuerpo crudo llega como binario (el
// webhook tiene rawBody) y se lee con this.helpers.getBinaryDataBuffer.
async function verificar(crudo, firma, env = {STRIPE_WEBHOOK_SECRET: SECRETO}) {
  const item = {json: {headers: firma === undefined ? {} : {'stripe-signature': firma}}, binary: {data: {}}};
  const $input = {first: () => item, all: () => [item]};
  const helpers = {getBinaryDataBuffer: async () => Buffer.from(crudo, 'utf8')};
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const fn = new AsyncFunction('$input', '$env', 'require', 'Buffer', jsCode);

  return (await fn.call({helpers}, $input, env, require, Buffer))[0].json;
}

const evento = (extra = {}) => JSON.stringify({
  id: 'evt_1', type: 'checkout.session.completed',
  data: {object: {id: 'cs_1', payment_status: 'paid', amount_total: 580000, currency: 'usd',
    payment_intent: 'pi_1', metadata: {factura_id: 'FAC-2026-ABCD1234'}, ...extra}},
});
const firmar = (crudo, secreto = SECRETO, t = Math.floor(Date.now() / 1000)) =>
  `t=${t},v1=${createHmac('sha256', secreto).update(`${t}.${crudo}`).digest('hex')}`;

// ── Firma ──────────────────────────────────────────────────────────────────
const bueno = evento();
const r = await verificar(bueno, firmar(bueno));

check('un pago bien firmado se aplica', r.accion === 'aplicar', JSON.stringify(r));
check('trae la factura, el pago y el importe en la unidad de la factura (centavos / 100)',
  r.factura_id === 'FAC-2026-ABCD1234' && r.stripe_pago_id === 'pi_1' && r.monto_pagado === 5800 && r.moneda_pagada === 'USD',
  JSON.stringify(r));
check('firmado con otro secreto se rechaza', (await verificar(bueno, firmar(bueno, 'otro'))).accion === 'rechazar');
check('un cuerpo alterado después de firmar se rechaza',
  (await verificar(bueno.replace('580000', '100'), firmar(bueno))).accion === 'rechazar');
check('una firma truncada se rechaza (sin excepción)',
  (await verificar(bueno, firmar(bueno).slice(0, -6))).accion === 'rechazar');
check('una firma de hace más de 5 minutos (replay) se rechaza',
  (await verificar(bueno, firmar(bueno, SECRETO, Math.floor(Date.now() / 1000) - 600))).accion === 'rechazar');
check('sin Stripe-Signature se rechaza', (await verificar(bueno, undefined)).accion === 'rechazar');
check('sin STRIPE_WEBHOOK_SECRET configurado se rechaza todo', (await verificar(bueno, firmar(bueno), {})).accion === 'rechazar');
check('una de varias firmas v1 válida alcanza (rotación del secreto)',
  (await verificar(bueno, firmar(bueno, 'viejo') + ',' + firmar(bueno).split(',')[1])).accion === 'aplicar');

// ── Qué eventos se aplican ─────────────────────────────────────────────────
const conFirma = async (crudo) => verificar(crudo, firmar(crudo));

check('una sesión completada sin pagar (pago diferido) se ignora',
  (await conFirma(evento({payment_status: 'unpaid'}))).accion === 'ignorar');
check('otro tipo de evento se ignora con 200 (Stripe no lo reintenta)',
  (await conFirma(JSON.stringify({type: 'customer.created', data: {object: {}}})))?.status === 200);
check('sin factura en metadata ni client_reference_id se ignora',
  (await conFirma(evento({metadata: {}}))).accion === 'ignorar');
check('un pago diferido que después se acredita se aplica',
  (await conFirma(JSON.stringify({type: 'checkout.session.async_payment_succeeded',
    data: {object: {amount_total: 100, currency: 'usd', payment_intent: 'pi_2', client_reference_id: 'FAC-2026-X'}}}))).accion === 'aplicar');

// ── Pago protegido por hitos (etapa 11) ────────────────────────────────────
const HITO = '550e8400-e29b-41d4-a716-446655440000';
const deHito = await conFirma(evento({id: 'cs_h', payment_intent: 'pi_h', amount_total: 50050, metadata: {hito_id: HITO}}));

check('el pago de un hito va por la rama de hitos, no de facturas',
  deHito.accion === 'hito' && deHito.hito_id === HITO && !deHito.factura_id, JSON.stringify(deHito));
check('trae la sesión, el pago y el importe (500,50 USD)',
  deHito.stripe_checkout_id === 'cs_h' && deHito.stripe_pago_id === 'pi_h' && deHito.monto_pagado === 500.5
    && deHito.moneda_pagada === 'USD', JSON.stringify(deHito));
check('un hito_id que no es un UUID no se toma como hito',
  (await conFirma(evento({metadata: {hito_id: "x' OR 1=1"}}))).accion === 'ignorar');
check('una sesión de hito sin pagar se ignora',
  (await conFirma(evento({payment_status: 'unpaid', metadata: {hito_id: HITO}}))).accion === 'ignorar');
check('un pago de hito con la firma alterada se rechaza igual',
  (await verificar(evento({metadata: {hito_id: HITO}}), firmar(evento()))).accion === 'rechazar');

console.log('\nResultado: ' + ok + ' OK, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
