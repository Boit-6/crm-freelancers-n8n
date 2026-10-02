#!/usr/bin/env node
/**
 * Doble de prueba de la API de Stripe (cobros con Stripe Connect).
 *
 * Reproduce el contrato documentado de los endpoints que consume el flujo, con
 * cuerpos form-urlencoded como la API real (`a[b][c]=v`):
 *
 *   POST /v1/accounts                         → crea una cuenta conectada Express
 *   POST /v1/account_links                    → enlace de onboarding de esa cuenta
 *   GET  /v1/accounts/{id}                    → estado (charges_enabled, ...)
 *   POST /v1/checkout/sessions                → sesión de pago (destination charge)
 *   POST /v1/checkout/sessions/{id}/expire    → la expira (factura anulada)
 *   POST /v1/transfers                        → transferencia a una cuenta conectada
 *                                               (al liberar un hito, etapa 11)
 *   POST /v1/refunds                          → reembolso de un pago (hito devuelto)
 *
 * Las sesiones sin transfer_data son cobros de la plataforma (pago protegido
 * por hitos): la plata queda en la plataforma hasta que se transfiere aparte.
 * Transferencias y reembolsos respetan Idempotency-Key: la misma clave
 * devuelve el mismo objeto, como la API real.
 *
 * Y, del lado del navegador, lo que en Stripe hace una persona:
 *
 *   GET /onboarding/{acct}   → "completa" el alta: la cuenta pasa a
 *                              charges_enabled y vuelve al return_url
 *   GET /checkout/{cs}       → "paga": marca la sesión como pagada, le manda
 *                              a n8n el evento checkout.session.completed
 *                              firmado como Stripe (Stripe-Signature, HMAC
 *                              SHA-256 de `${t}.${cuerpo}`) y vuelve al
 *                              success_url
 *
 * NO es Stripe ni lo sustituye: permite ejercitar el circuito de punta a punta
 * sin credenciales. La validación con una cuenta de Stripe en modo de prueba
 * sigue siendo necesaria.
 *
 * Uso:
 *   STRIPE_WEBHOOK_SECRET=whsec_... WEBHOOK_URL=http://n8n:5678/webhook/stripe \
 *   PUBLICO=http://localhost:12111 node tests/stripe-doble.mjs [--puerto 12111]
 *
 * En el entorno de n8n:
 *   STRIPE_API_BASE=http://stripe-doble:12111
 *   STRIPE_SECRET_KEY=sk_test_<cualquier cosa>
 *
 * Auxiliares (no son de Stripe): GET /__estado, POST /__reset y POST
 * /__sembrar. El estado vive en memoria: si el contenedor se reinicia, con
 * /__sembrar (JSON `{cuentas: ["acct_x"], pagos: [{payment_intent, amount_total}]}`,
 * montos en centavos) se vuelven a registrar las cuentas y los pagos que la
 * base ya tiene, para poder transferir y reembolsar sobre ellos.
 */

import {createHmac, randomBytes} from 'node:crypto';
import {createServer} from 'node:http';

const args = process.argv.slice(2);
const idxPuerto = args.indexOf('--puerto');
const PUERTO = idxPuerto >= 0 ? Number(args[idxPuerto + 1]) : 12111;
// Las URL que ve el navegador (onboarding, checkout) no son las que usa n8n
// adentro de la red de Docker.
const PUBLICO = (process.env.PUBLICO || `http://localhost:${PUERTO}`).replace(/\/+$/, '');
const WEBHOOK_URL = process.env.WEBHOOK_URL || '';
const SECRETO = process.env.STRIPE_WEBHOOK_SECRET || '';

let cuentas = new Map();   // acct_x -> cuenta
let links = new Map();     // acct_x -> { return_url, refresh_url }
let sesiones = new Map();  // cs_x   -> sesión
let eventos = [];          // eventos enviados al webhook, con su respuesta
let transferencias = [];   // tr_x
let reembolsos = [];       // re_x
let idempotencia = new Map(); // Idempotency-Key -> respuesta

const id = (prefijo) => prefijo + '_' + randomBytes(8).toString('hex');

// `a[b][c]=v&a[d]=w` -> { a: { b: { c: 'v' }, d: 'w' } }, como la API real.
function desdeForm(texto) {
  const raiz = {};

  for (const [clave, valor] of new URLSearchParams(texto)) {
    const partes = clave.replace(/\]/g, '').split('[');
    let nodo = raiz;

    partes.forEach((p, i) => {
      if (i === partes.length - 1) nodo[p] = valor;
      else nodo = nodo[p] = nodo[p] || {};
    });
  }

  return raiz;
}

function leerCuerpo(req) {
  return new Promise((resolve) => {
    let datos = '';

    req.on('data', (c) => { datos += c; });
    req.on('end', () => resolve(datos));
  });
}

function responder(res, codigo, objeto) {
  const cuerpo = JSON.stringify(objeto);

  res.writeHead(codigo, {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(cuerpo)});
  res.end(cuerpo);
}

function redirigir(res, url) {
  res.writeHead(303, {Location: url});
  res.end();
}

const errorStripe = (res, codigo, mensaje) =>
  responder(res, codigo, {error: {type: 'invalid_request_error', message: mensaje}});

async function enviarEvento(tipo, objeto) {
  const evento = {id: id('evt'), object: 'event', type: tipo, created: Math.floor(Date.now() / 1000), data: {object: objeto}};
  const cuerpo = JSON.stringify(evento);
  const t = Math.floor(Date.now() / 1000);
  const firma = createHmac('sha256', SECRETO).update(`${t}.${cuerpo}`).digest('hex');
  let estado = null;

  try {
    const r = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${firma}`},
      body: cuerpo,
    });

    estado = r.status;
  } catch (e) {
    estado = 'error: ' + e.message;
  }
  eventos.push({tipo, sesion: objeto.id, estado});
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://doble');
  const ruta = url.pathname;
  const cuerpo = await leerCuerpo(req);

  // ── Auxiliares ──
  if (ruta === '/__estado') {
    return responder(res, 200, {cuentas: [...cuentas.values()], sesiones: [...sesiones.values()], eventos,
      transferencias, reembolsos});
  }
  if (ruta === '/__sembrar' && req.method === 'POST') {
    let semilla;

    try {
      semilla = JSON.parse(cuerpo || '{}');
    } catch {
      return errorStripe(res, 400, 'El cuerpo no es JSON');
    }
    const {cuentas: cuentasNuevas = [], pagos = []} = semilla;

    if (!Array.isArray(cuentasNuevas) || !Array.isArray(pagos)
        || pagos.some((pago) => !pago.payment_intent || !Number.isInteger(Number(pago.amount_total)))) {
      return errorStripe(res, 400, 'Se esperan cuentas: [acct] y pagos: [{payment_intent, amount_total}]');
    }
    for (const cuentaId of cuentasNuevas) {
      cuentas.set(cuentaId, {id: cuentaId, object: 'account', type: 'express', email: null, business_profile: {},
        metadata: {}, details_submitted: true, charges_enabled: true, payouts_enabled: true});
    }
    for (const pago of pagos) {
      const sesionId = id('cs');

      sesiones.set(sesionId, {id: sesionId, object: 'checkout.session', status: 'complete', payment_status: 'paid',
        payment_intent: pago.payment_intent, amount_total: Number(pago.amount_total), currency: 'usd', metadata: {}});
    }

    return responder(res, 200, {cuentas: cuentasNuevas.length, pagos: pagos.length});
  }
  if (ruta === '/__reset' && req.method === 'POST') {
    cuentas = new Map(); links = new Map(); sesiones = new Map(); eventos = [];
    transferencias = []; reembolsos = []; idempotencia = new Map();

    return responder(res, 200, {ok: true});
  }

  // ── Navegador ──
  const onboarding = ruta.match(/^\/onboarding\/(acct_\w+)$/);

  if (onboarding) {
    const cuenta = cuentas.get(onboarding[1]);

    if (!cuenta) return errorStripe(res, 404, 'No such account');
    Object.assign(cuenta, {details_submitted: true, charges_enabled: true, payouts_enabled: true});

    return redirigir(res, links.get(cuenta.id)?.return_url || PUBLICO);
  }
  const pagar = ruta.match(/^\/checkout\/(cs_\w+)$/);

  if (pagar) {
    const sesion = sesiones.get(pagar[1]);

    if (!sesion) return errorStripe(res, 404, 'No such checkout session');
    if (sesion.status !== 'open') return errorStripe(res, 400, 'This Checkout Session is no longer active');
    Object.assign(sesion, {status: 'complete', payment_status: 'paid', payment_intent: id('pi')});
    await enviarEvento('checkout.session.completed', sesion);

    return redirigir(res, sesion.success_url);
  }

  // ── API ──
  if (!/^Bearer sk_(test|live)_\S+$/.test(req.headers.authorization || '')) {
    return errorStripe(res, 401, 'Invalid API Key provided');
  }
  const datos = desdeForm(cuerpo);

  if (req.method === 'POST' && ruta === '/v1/accounts') {
    if (datos.type !== 'express') return errorStripe(res, 400, 'type must be express');
    const cuenta = {id: id('acct'), object: 'account', type: 'express', email: datos.email || null,
      business_profile: datos.business_profile || {}, metadata: datos.metadata || {},
      details_submitted: false, charges_enabled: false, payouts_enabled: false};

    cuentas.set(cuenta.id, cuenta);

    return responder(res, 200, cuenta);
  }
  if (req.method === 'POST' && ruta === '/v1/account_links') {
    if (!cuentas.has(datos.account)) return errorStripe(res, 404, 'No such account');
    if (!datos.return_url || !datos.refresh_url) return errorStripe(res, 400, 'return_url and refresh_url are required');
    links.set(datos.account, {return_url: datos.return_url, refresh_url: datos.refresh_url});

    return responder(res, 200, {object: 'account_link', url: `${PUBLICO}/onboarding/${datos.account}`,
      expires_at: Math.floor(Date.now() / 1000) + 300});
  }
  const cuentaGet = ruta.match(/^\/v1\/accounts\/(acct_\w+)$/);

  if (req.method === 'GET' && cuentaGet) {
    const cuenta = cuentas.get(cuentaGet[1]);

    return cuenta ? responder(res, 200, cuenta) : errorStripe(res, 404, 'No such account');
  }
  if (req.method === 'POST' && ruta === '/v1/checkout/sessions') {
    const destino = datos.payment_intent_data?.transfer_data?.destination;
    const item = datos.line_items?.['0'];
    const monto = Number(item?.price_data?.unit_amount);

    // Sin destino es un cobro de la plataforma (separate charges and transfers).
    if (destino && !cuentas.get(destino)?.charges_enabled) {
      return errorStripe(res, 400, 'The destination account cannot receive charges');
    }
    if (!Number.isInteger(monto) || monto <= 0) return errorStripe(res, 400, 'Invalid unit_amount');
    const sesion = {id: id('cs'), object: 'checkout.session', mode: datos.mode, status: 'open', payment_status: 'unpaid',
      amount_total: monto * Number(item.quantity || 1), currency: item.price_data.currency,
      client_reference_id: datos.client_reference_id || null, metadata: datos.metadata || {},
      success_url: datos.success_url, cancel_url: datos.cancel_url, payment_intent: null,
      application_fee_amount: Number(datos.payment_intent_data?.application_fee_amount || 0),
      transfer_destination: destino || null, transfer_group: datos.payment_intent_data?.transfer_group || null};

    sesion.url = `${PUBLICO}/checkout/${sesion.id}`;
    sesiones.set(sesion.id, sesion);

    return responder(res, 200, sesion);
  }
  const expirar = ruta.match(/^\/v1\/checkout\/sessions\/(cs_\w+)\/expire$/);

  if (req.method === 'POST' && expirar) {
    const sesion = sesiones.get(expirar[1]);

    if (!sesion) return errorStripe(res, 404, 'No such checkout session');
    if (sesion.status !== 'open') return errorStripe(res, 400, 'Only open sessions can be expired');
    sesion.status = 'expired';

    return responder(res, 200, sesion);
  }

  if (req.method === 'POST' && (ruta === '/v1/transfers' || ruta === '/v1/refunds')) {
    const clave = req.headers['idempotency-key'];

    if (clave && idempotencia.has(clave)) return responder(res, 200, idempotencia.get(clave));
    const monto = Number(datos.amount);

    if (!Number.isInteger(monto) || monto <= 0) return errorStripe(res, 400, 'Invalid amount');
    let objeto;

    if (ruta === '/v1/transfers') {
      if (!cuentas.get(datos.destination)?.charges_enabled) return errorStripe(res, 400, 'No such destination account');
      objeto = {id: id('tr'), object: 'transfer', amount: monto, currency: datos.currency, destination: datos.destination,
        transfer_group: datos.transfer_group || null, metadata: datos.metadata || {}};
      transferencias.push(objeto);
    } else {
      const pagada = [...sesiones.values()].find((x) => x.payment_intent === datos.payment_intent);

      if (!pagada) return errorStripe(res, 404, 'No such payment_intent');
      const yaDevuelto = reembolsos.filter((r) => r.payment_intent === datos.payment_intent).reduce((a, r) => a + r.amount, 0);

      if (yaDevuelto + monto > pagada.amount_total) return errorStripe(res, 400, 'Refund amount is greater than unrefunded amount');
      objeto = {id: id('re'), object: 'refund', amount: monto, payment_intent: datos.payment_intent, status: 'succeeded',
        metadata: datos.metadata || {}};
      reembolsos.push(objeto);
    }
    if (clave) idempotencia.set(clave, objeto);

    return responder(res, 200, objeto);
  }

  return errorStripe(res, 404, `Unrecognized request URL (${req.method}: ${ruta})`);
}).listen(PUERTO, () => console.log(`stripe-doble en :${PUERTO} (público: ${PUBLICO})`));
