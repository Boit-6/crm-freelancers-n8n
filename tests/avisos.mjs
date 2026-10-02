// Avisos al desarrollador (plataforma compartida). Revisa, sobre los workflows
// tal cual están en el repositorio:
//   • que todo punto de aviso del flujo principal y del de tickets pase por el
//     subflujo workflow/avisos.json con un tipo, un nivel válido y algo de
//     dónde sacar el espacio (lead, factura o espacio);
//   • a qué chats y a qué casilla manda el subflujo cada aviso;
//   • que el bot de Telegram no vincule nada sin el secreto del webhook.
//
// Uso: node tests/avisos.mjs
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const leerWf = (f) => JSON.parse(readFileSync(path.join(aqui, '..', 'workflow', f), 'utf8'));
const crm = leerWf('crm_postgres.json');
const tickets = leerWf('tickets.json');
const avisos = leerWf('avisos.json');
const bot = leerWf('telegram_vincular.json');

let ok = 0, fail = 0;
const check = (nombre, condicion, detalle) => {
  if (condicion) { console.log('OK    ' + nombre); ok++; }
  else { console.log('FAIL  ' + nombre + (detalle ? '  ->  ' + String(detalle).slice(0, 200) : '')); fail++; }
};

// Corre un nodo Code con los items de entrada y un $env.
function correr(wf, nombre, items, env = {}) {
  const js = wf.nodes.find((n) => n.name === nombre).parameters.jsCode;
  const envueltos = items.map((json) => ({json}));
  const $input = {first: () => envueltos[0], all: () => envueltos};

  return new Function('$input', '$env', js)($input, env).map((i) => i.json);
}

// ── Puntos de aviso ────────────────────────────────────────────────────────
const NIVELES = ['info', 'atencion', 'critico'];

for (const [wfNombre, wf] of [['crm', crm], ['tickets', tickets]]) {
  const llamadas = wf.nodes.filter((n) => n.type.endsWith('executeWorkflow'));

  for (const n of llamadas) {
    const p = n.parameters;
    const v = p.workflowInputs?.value || {};

    check(`${wfNombre}/${n.name}: llama al subflujo de avisos`, /AVISOS_WORKFLOW_ID/.test(p.workflowId?.value || ''));
    if (n.name === 'Aviso - Hitos al Desarrollador' || n.name === 'Aviso - Disputa de Hito' || n.name === 'Aviso - Checkout para Revision') {
      check(`${wfNombre}/${n.name}: espera para confirmar el aviso del hito`,
        p.options?.waitForSubWorkflow === true && n.onError !== 'continueRegularOutput');
    } else {
      check(`${wfNombre}/${n.name}: no espera al subflujo (un aviso que falla no corta la cadena)`,
        p.options?.waitForSubWorkflow === false && n.onError === 'continueRegularOutput');
    }
    check(`${wfNombre}/${n.name}: tipo y nivel válidos`, /^[a-z_]+$/.test(v.tipo || '') && NIVELES.includes(v.nivel), JSON.stringify(v));
    check(`${wfNombre}/${n.name}: dice de qué espacio es (lead, factura o espacio)`, Boolean(v.lead_id || v.factura_id || v.espacio_id));
  }
}

const directos = crm.nodes.filter((n) => n.type.endsWith('telegram')).map((n) => n.name);

check('el único Telegram directo del flujo principal es el de errores críticos', JSON.stringify(directos) === '["Telegram - Error Critico"]', directos);
check('el flujo de tickets no manda Telegram directo', !tickets.nodes.some((n) => n.type.endsWith('telegram')));

// ── Subflujo: a dónde va cada aviso ────────────────────────────────────────
const ENV = {TELEGRAM_CHAT_ID: 'plataforma', PLATAFORMA_NOMBRE: 'MiPlataforma', FRONTEND_URL: 'https://app.test'};
const aviso = (extra) => ({aviso_id: 1, espacio_id: 'esp-1', tipo: 'pago_recibido', nivel: 'atencion', mensaje: '💳 <b>Pago</b>\nCliente: A &amp; B',
  espacio_nombre: 'Estudio Ana', espacio_email: 'ana@estudio.com', telegram_chat_id: null, ...extra});
const chats = (a) => correr(avisos, 'Code - Destinos Telegram', [a], ENV).map((x) => x.chatId).sort().join(',');

check('sin Telegram vinculado, un aviso normal no va a ningún chat', chats(aviso()) === '');
check('con Telegram vinculado, va al chat del desarrollador', chats(aviso({telegram_chat_id: '555'})) === '555');
check('un aviso crítico va también al chat de la plataforma', chats(aviso({nivel: 'critico', telegram_chat_id: '555'})) === '555,plataforma');
check('un aviso sin espacio va al chat de la plataforma', chats(aviso({espacio_id: null, espacio_email: null})) === 'plataforma');
check('el aviso de un desarrollador NO va al chat de la plataforma', !chats(aviso({telegram_chat_id: '555'})).includes('plataforma'));

const correos = (a) => correr(avisos, 'Code - Armar Correo Aviso', [a], ENV);

check('un aviso que pide acción va por correo al desarrollador', correos(aviso())[0]?.para === 'ana@estudio.com');
check('el asunto dice qué pasó y de qué espacio', correos(aviso())[0]?.asunto === 'Entró un pago — Estudio Ana');
check('el correo lleva el enlace al panel', correos(aviso())[0]?.html.includes('https://app.test/dashboard'));
check('los saltos de línea del aviso pasan a <br>', correos(aviso())[0]?.html.includes('<b>Pago</b><br>Cliente: A &amp; B'));
check('un aviso informativo NO va por correo', correos(aviso({nivel: 'info'})).length === 0);
check('sin correo de contacto no se intenta mandar', correos(aviso({espacio_email: null})).length === 0);

const norm = correr(avisos, 'Code - Normalizar Aviso', [{tipo: 'x', nivel: 'aviso', mensaje: 'm', espacio_id: "1'; DROP TABLE avisos;--"}]);

check('un nivel viejo o desconocido queda como info', norm[0].nivel === 'info');
check('un espacio_id que no es un UUID se descarta', norm[0].espacio_id === '');

// ── Bot de Telegram ────────────────────────────────────────────────────────
const mensajeBot = (texto, secreto) => ({headers: secreto ? {'x-telegram-bot-api-secret-token': secreto} : {},
  body: {message: {chat: {id: 4242}, text: texto}}});
const leer = (entrada, env) => correr(bot, 'Code - Leer Mensaje Bot', [entrada], env);

check('sin el secreto del webhook, el bot no hace nada', leer(mensajeBot('/start ABCD1234', 'otro'), {TELEGRAM_WEBHOOK_SECRET: 's3cr3t'}).length === 0);
check('sin secreto configurado, se falla cerrado', leer(mensajeBot('/start ABCD1234', ''), {}).length === 0);
check('con el secreto, lee el chat y el código de /start', JSON.stringify(leer(mensajeBot('/start abcd1234', 's3cr3t'), {TELEGRAM_WEBHOOK_SECRET: 's3cr3t'})) === '[{"chat_id":"4242","codigo":"ABCD1234"}]');
check('un texto cualquiera no es un código', leer(mensajeBot('hola', 's3cr3t'), {TELEGRAM_WEBHOOK_SECRET: 's3cr3t'})[0].codigo === '');

console.log('\nResultado: ' + ok + ' OK, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
