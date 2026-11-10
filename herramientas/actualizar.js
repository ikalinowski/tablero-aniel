/* ============================================================
   TABLERO ANIEL — Lector de Google Analytics (GA4 Data API)
   ────────────────────────────────────────────────────────────
   Lee la propiedad de anielnutricionista.com con una cuenta de
   servicio de SOLO LECTURA y deja todo en datos/resumen.json,
   que es lo único que lee el tablero (index.html).

   No necesita instalar nada (Node 18 o más nuevo).

   La llave NUNCA va en este repositorio:
     · En GitHub Actions llega como el secreto GA_LLAVE_JSON.
     · En la PC se lee del archivo que diga GA_LLAVE.

   Uso:
     node herramientas/actualizar.js
     GA_PROPIEDAD=123456789 node herramientas/actualizar.js
============================================================ */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* ── Configuración ── */
// ID numérico de la propiedad GA4 (Administrar → Detalles de la propiedad).
// No es secreto. La medición de la web es G-QDQ72RG4BB.
const PROPIEDAD = process.env.GA_PROPIEDAD || '';
const SALIDA = path.join(__dirname, '..', 'datos', 'resumen.json');
const PERIODOS = [7, 28, 90];          // días completos que terminan ayer
const HISTORIA_DESDE = '2025-01-01';   // mes a mes desde aquí (GA devuelve solo meses con datos)

function leerLlave() {
  if (process.env.GA_LLAVE_JSON) return JSON.parse(process.env.GA_LLAVE_JSON);
  if (process.env.GA_LLAVE) return JSON.parse(fs.readFileSync(process.env.GA_LLAVE, 'utf8'));
  return null;
}

/* ── Acceso: JWT firmado con la llave → token de 1 hora ── */
let _token = null;
async function token(llave) {
  if (_token) return _token;
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const ahora = Math.floor(Date.now() / 1000);
  const sinFirma = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({
    iss: llave.client_email,
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud: llave.token_uri,
    iat: ahora,
    exp: ahora + 3600
  });
  const firma = crypto.createSign('RSA-SHA256').update(sinFirma).sign(llave.private_key).toString('base64url');
  const r = await fetch(llave.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + sinFirma + '.' + firma
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('No se pudo obtener el token: ' + (j.error_description || j.error));
  return (_token = j.access_token);
}

/* ── Llamadas con un máximo de 5 a la vez (GA permite 10 por propiedad) ── */
let enCurso = 0;
const cola = [];
function turno() {
  return new Promise(ok => {
    if (enCurso < 5) { enCurso++; ok(); } else cola.push(ok);
  });
}
function liberar() {
  const sig = cola.shift();
  if (sig) sig(); else enCurso--;
}

async function runReport(llave, cuerpo) {
  await turno();
  try {
    const r = await fetch('https://analyticsdata.googleapis.com/v1beta/properties/' + PROPIEDAD + ':runReport', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + await token(llave), 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo)
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    return j;
  } finally {
    liberar();
  }
}

/* Filas de la API → objetos planos { dimension: texto, metrica: número } */
function filas(res) {
  const dims = (res.dimensionHeaders || []).map(h => h.name.replace(/^customEvent:/, ''));
  const mets = (res.metricHeaders || []).map(h => h.name.replace(/^customEvent:/, ''));
  return (res.rows || []).map(row => {
    const o = {};
    dims.forEach((d, i) => { o[d] = row.dimensionValues[i].value; });
    mets.forEach((m, i) => { o[m] = Number(row.metricValues[i].value); });
    return o;
  });
}

/* ── Filtros ── */
const evento = nombre => ({ filter: { fieldName: 'eventName', stringFilter: { value: nombre } } });
const eventos = nombres => ({ filter: { fieldName: 'eventName', inListFilter: { values: nombres } } });
const y = (...exprs) => ({ andGroup: { expressions: exprs } });

/* Un informe. Si falla (p. ej. una dimensión personalizada aún no
   registrada en GA), devuelve { error } y el tablero lo explica. */
async function informe(llave, rango, dims, mets, opciones) {
  const o = opciones || {};
  const cuerpo = {
    dateRanges: [rango],
    dimensions: dims.map(name => ({ name })),
    metrics: mets.map(name => ({ name })),
    limit: o.limite || 250
  };
  if (o.filtro) cuerpo.dimensionFilter = o.filtro;
  if (o.ordenMetrica) cuerpo.orderBys = [{ metric: { metricName: o.ordenMetrica }, desc: true }];
  if (o.ordenDimension) cuerpo.orderBys = [{ dimension: { dimensionName: o.ordenDimension } }];
  try {
    return filas(await runReport(llave, cuerpo));
  } catch (e) {
    return { error: e.message };
  }
}

/* ── Fechas en hora de Lima ── */
function fechaLima(offsetDias) {
  return new Date(Date.now() - 5 * 3600000 + offsetDias * 86400000).toISOString().slice(0, 10);
}
function rangoDe(dias, hastaOffset) {
  return { startDate: fechaLima(hastaOffset - dias + 1), endDate: fechaLima(hastaOffset) };
}

const EVENTOS_CLAVE = [
  'page_view', 'generate_lead', 'whatsapp_click', 'contact_click', 'social_click',
  'view_item', 'select_item', 'section_view', 'faq_open', 'testimonial_navigation',
  'form_begin', 'form_error', 'form_success', 'scroll_depth', 'cookie_consent', 'menu_click', 'cta_click'
];
// Quien tocó WhatsApp o el correo, o envió el formulario de marcas. whatsapp_click se mide
// desde antes que generate_lead, así la historia es comparable. Sin dimensiones, GA no duplica personas.
const CONTACTO = ['whatsapp_click', 'contact_click', 'generate_lead'];
const KPI = ['activeUsers', 'newUsers', 'sessions', 'engagedSessions', 'screenPageViews', 'engagementRate', 'userEngagementDuration'];

async function periodo(llave, dias) {
  const rango = rangoDe(dias, -1);
  const antes = rangoDe(dias, -1 - dias);
  const R = (...a) => informe(llave, rango, ...a);

  const [
    kpi, kpiAntes, eventosAhora, eventosAntes, contactos, contactosAntes,
    porDia, leadsPorDia,
    origen, leadsPorOrigen,
    paginas, entrada, vieronPlanes, vieronPlanesAntes,
    planes, leadsPorPlan,
    secciones, tiempoSecciones,
    botones, botonesPorPagina, faq, scroll,
    dispositivos, ciudades, paises, horas, diasSemana, nuevos, redes, formularios
  ] = await Promise.all([
    R([], KPI),
    informe(llave, antes, [], KPI),
    R(['eventName'], ['eventCount', 'totalUsers'], { filtro: eventos(EVENTOS_CLAVE) }),
    informe(llave, antes, ['eventName'], ['eventCount', 'totalUsers'], { filtro: eventos(EVENTOS_CLAVE) }),
    R([], ['totalUsers'], { filtro: eventos(CONTACTO) }),
    informe(llave, antes, [], ['totalUsers'], { filtro: eventos(CONTACTO) }),

    R(['date'], ['activeUsers', 'sessions', 'screenPageViews'], { ordenDimension: 'date' }),
    R(['date'], ['totalUsers'], { filtro: eventos(CONTACTO), ordenDimension: 'date' }),

    R(['sessionSource', 'sessionMedium', 'sessionDefaultChannelGroup'], ['sessions', 'activeUsers', 'engagedSessions'], { ordenMetrica: 'sessions', limite: 100 }),
    R(['sessionSource', 'sessionMedium', 'sessionDefaultChannelGroup'], ['totalUsers'], { filtro: eventos(CONTACTO), limite: 100 }),

    R(['pagePath'], ['screenPageViews', 'activeUsers', 'userEngagementDuration'], { ordenMetrica: 'screenPageViews', limite: 50 }),
    R(['landingPage'], ['sessions', 'engagedSessions'], { ordenMetrica: 'sessions', limite: 50 }),
    R([], ['totalUsers'], { filtro: y(evento('page_view'), { filter: { fieldName: 'pagePath', stringFilter: { matchType: 'CONTAINS', value: 'servicios' } } }) }),
    informe(llave, antes, [], ['totalUsers'], { filtro: y(evento('page_view'), { filter: { fieldName: 'pagePath', stringFilter: { matchType: 'CONTAINS', value: 'servicios' } } }) }),

    R(['itemName'], ['itemsViewed', 'itemsClickedInList'], { ordenMetrica: 'itemsViewed', limite: 20 }),
    R(['customEvent:plan_name'], ['eventCount', 'totalUsers'], { filtro: evento('generate_lead'), ordenMetrica: 'eventCount', limite: 20 }),

    R(['customEvent:section_name'], ['totalUsers', 'eventCount'], { filtro: evento('section_view'), ordenMetrica: 'totalUsers', limite: 40 }),
    R(['customEvent:section_name'], ['customEvent:engaged_seconds', 'eventCount'], { filtro: evento('section_engagement'), limite: 40 }),

    R(['customEvent:cta_location'], ['eventCount', 'totalUsers'], { filtro: evento('whatsapp_click'), ordenMetrica: 'eventCount', limite: 30 }),
    R(['pagePath'], ['eventCount', 'totalUsers'], { filtro: evento('whatsapp_click'), ordenMetrica: 'eventCount', limite: 20 }),
    R(['customEvent:faq_question'], ['eventCount', 'totalUsers'], { filtro: evento('faq_open'), ordenMetrica: 'eventCount', limite: 20 }),
    R(['contentGroup', 'percentScrolled'], ['totalUsers'], { filtro: evento('scroll_depth'), limite: 50 }),

    R(['deviceCategory'], ['activeUsers', 'sessions'], { ordenMetrica: 'activeUsers' }),
    R(['city', 'country'], ['activeUsers'], { ordenMetrica: 'activeUsers', limite: 20 }),
    R(['country'], ['activeUsers'], { ordenMetrica: 'activeUsers', limite: 20 }),
    R(['hour'], ['sessions'], { ordenDimension: 'hour' }),
    R(['dayOfWeek'], ['sessions'], { ordenDimension: 'dayOfWeek' }),
    R(['newVsReturning'], ['activeUsers']),
    R(['customEvent:social_network'], ['eventCount'], { filtro: evento('social_click') }),
    R(['customEvent:form_name', 'eventName'], ['eventCount', 'totalUsers'], { filtro: eventos(['form_begin', 'form_error', 'form_success']) })
  ]);

  return {
    dias, rango, comparadoCon: antes,
    kpi: Array.isArray(kpi) ? (kpi[0] || {}) : kpi,
    kpiAntes: Array.isArray(kpiAntes) ? (kpiAntes[0] || {}) : kpiAntes,
    eventos: eventosAhora, eventosAntes,
    contactos: Array.isArray(contactos) ? ((contactos[0] || {}).totalUsers || 0) : contactos,
    contactosAntes: Array.isArray(contactosAntes) ? ((contactosAntes[0] || {}).totalUsers || 0) : contactosAntes,
    porDia, leadsPorDia, origen, leadsPorOrigen,
    paginas, entrada,
    vieronPlanes: Array.isArray(vieronPlanes) ? ((vieronPlanes[0] || {}).totalUsers || 0) : vieronPlanes,
    vieronPlanesAntes: Array.isArray(vieronPlanesAntes) ? ((vieronPlanesAntes[0] || {}).totalUsers || 0) : vieronPlanesAntes,
    planes, leadsPorPlan, secciones, tiempoSecciones, botones, botonesPorPagina, faq, scroll,
    dispositivos, ciudades, paises, horas, diasSemana, nuevos, redes, formularios
  };
}

async function historia(llave) {
  const rango = { startDate: HISTORIA_DESDE, endDate: fechaLima(-1) };
  const [visitas, leads] = await Promise.all([
    informe(llave, rango, ['yearMonth'], ['activeUsers', 'newUsers', 'sessions', 'screenPageViews'], { ordenDimension: 'yearMonth' }),
    informe(llave, rango, ['yearMonth'], ['totalUsers'], { filtro: eventos(CONTACTO), ordenDimension: 'yearMonth' })
  ]);
  return { visitas, leads };
}

(async () => {
  const llave = leerLlave();
  if (!llave || !PROPIEDAD) {
    console.warn('Falta configurar: ' + [!llave && 'la llave (GA_LLAVE_JSON o GA_LLAVE)', !PROPIEDAD && 'el ID de la propiedad (GA_PROPIEDAD)'].filter(Boolean).join(' y ') + '. No se actualizó nada.');
    return;
  }

  const periodos = {};
  for (const d of PERIODOS) periodos[d] = await periodo(llave, d);
  const datos = {
    generado: new Date().toISOString(),
    sitio: 'anielnutricionista.com',
    propiedad: PROPIEDAD,
    periodos,
    historia: await historia(llave)
  };

  // Si la conexión falló por completo, no se pisa el último archivo bueno.
  const kpi = periodos[PERIODOS[0]].kpi;
  if (kpi && kpi.error) throw new Error('Google Analytics respondió con error: ' + kpi.error);

  fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
  fs.writeFileSync(SALIDA, JSON.stringify(datos, null, 1));

  const faltan = new Set();
  for (const p of Object.values(periodos)) {
    for (const [k, v] of Object.entries(p)) if (v && v.error) faltan.add(k + ': ' + v.error.slice(0, 120));
  }
  console.log('Listo: ' + SALIDA);
  if (faltan.size) console.log('Bloques sin datos (normal si la dimensión aún no está registrada en GA):\n  ' + [...faltan].join('\n  '));
})().catch(e => { console.error(e.message); process.exit(1); });
