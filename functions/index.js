// functions/index.js
// Firebase Cloud Functions — AlertaRíos v2.1
// Despliega con: firebase deploy --only functions

const functions = require('firebase-functions');
const admin     = require('firebase-admin');
const fetch     = require('node-fetch');

admin.initializeApp();
const db = admin.firestore();

// ══════════════════════════════════════════════════════
//  CUENCAS CONFIG
// ══════════════════════════════════════════════════════
const CUENCAS = [
  {
    id: 'pamplonita', nombre: 'Río Pamplonita',
    lat: 7.89, lon: -72.50, lat_alto: 7.37, lon_alto: -72.65,
    umbral_warn: 80, umbral_danger: 150,
    municipios_riesgo: ['Cúcuta', 'Los Patios', 'Villa del Rosario', 'Pamplona'],
  },
  {
    id: 'zulia', nombre: 'Río Zulia',
    lat: 8.12, lon: -72.98, lat_alto: 7.50, lon_alto: -72.97,
    umbral_warn: 200, umbral_danger: 400,
    municipios_riesgo: ['El Carmen', 'San Calixto', 'El Zulia'],
  },
  {
    id: 'tachira', nombre: 'Río Táchira',
    lat: 7.85, lon: -72.46, lat_alto: 7.77, lon_alto: -72.40,
    umbral_warn: 60, umbral_danger: 120,
    municipios_riesgo: ['Villa del Rosario', 'Cúcuta sur'],
  },
  {
    id: 'catatumbo', nombre: 'Río Catatumbo',
    lat: 8.47, lon: -73.32, lat_alto: 9.03, lon_alto: -73.27,
    umbral_warn: 500, umbral_danger: 900,
    municipios_riesgo: ['Tibú', 'Convención', 'El Tarra', 'Teorama'],
  },
  {
    id: 'sardinata', nombre: 'Río Sardinata',
    lat: 8.09, lon: -73.01, lat_alto: 8.07, lon_alto: -73.20,
    umbral_warn: 120, umbral_danger: 250,
    municipios_riesgo: ['Sardinata', 'Cúcuta norte'],
  },
];

// ══════════════════════════════════════════════════════
//  ZONAS DE DESLIZAMIENTO — Norte de Santander
//  Fuente: inventario UNGRD + susceptibilidad SGC
// ══════════════════════════════════════════════════════
const ZONAS_DESLIZAMIENTO = [
  {
    id: 'cachira_zulia',
    nombre: 'Cáchira — Valle del Zulia',
    municipio: 'Cáchira',
    lat: 7.742, lon: -73.043,
    rio_afectado: 'zulia',
    // Umbral de lluvia acumulada (mm/24h) para activar alerta
    umbral_warn: 40,
    umbral_danger: 70,
    // Lluvia acumulada en 48h que también activa alerta
    umbral_warn_48h: 65,
    umbral_danger_48h: 110,
    riesgo_base: 'warn',   // zona históricamente activa
    impacto_rio: 'Posible obstrucción del cauce. Si hay embalse y rotura, ola llegaría a Sardinata en ~3h.',
    descripcion: 'Suelos arcillosos sobre pendientes >35°. Historial de eventos en 2011, 2017 y 2021.',
  },
  {
    id: 'herran_pamplonita',
    nombre: 'Herrán — Cañón del Pamplonita',
    municipio: 'Herrán / Toledo',
    lat: 7.50, lon: -72.60,
    rio_afectado: 'pamplonita',
    umbral_warn: 50,
    umbral_danger: 80,
    umbral_warn_48h: 80,
    umbral_danger_48h: 130,
    riesgo_base: 'ok',
    impacto_rio: 'Obstrucción podría elevar nivel en Pamplona y generar inundaciones aguas abajo.',
    descripcion: 'Cañón profundo con taludes inestables. Material rocoso fracturado. Zona sísmica activa.',
  },
  {
    id: 'abrego_algodonal',
    nombre: 'Ábrego — cuenca Algodonal',
    municipio: 'Ábrego',
    lat: 8.076, lon: -73.227,
    rio_afectado: 'catatumbo',
    umbral_warn: 45,
    umbral_danger: 75,
    umbral_warn_48h: 70,
    umbral_danger_48h: 120,
    riesgo_base: 'ok',
    impacto_rio: 'Puede elevar sedimentación en Catatumbo, reduciendo capacidad del cauce.',
    descripcion: 'Ladera inestable sobre el río Algodonal. Deforestación reciente aumenta el riesgo.',
  },
  {
    id: 'tibu_serrania',
    nombre: 'Tibú — Serranía de los Motilones',
    municipio: 'Tibú',
    lat: 8.70, lon: -72.95,
    rio_afectado: 'catatumbo',
    umbral_warn: 55,
    umbral_danger: 90,
    umbral_warn_48h: 90,
    umbral_danger_48h: 150,
    riesgo_base: 'ok',
    impacto_rio: 'Tributarios directos del Catatumbo. Crecientes repentinas frecuentes.',
    descripcion: 'Alta pluviosidad (3200mm/año). Deforestación activa aumenta susceptibilidad.',
  },
];

// ══════════════════════════════════════════════════════
//  HELPER — fetch GloFAS discharge (returns array)
// ══════════════════════════════════════════════════════
async function getDischarge(lat, lon, days = 3) {
  const url = `https://flood-api.open-meteo.com/v1/flood?latitude=${lat}&longitude=${lon}&daily=river_discharge&forecast_days=${days}`;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    const values = d.daily?.river_discharge;
    if (!Array.isArray(values) || values.length === 0) throw new Error('Sin datos de caudal');
    return { ok: true, values };
  } catch (e) {
    console.error(`GloFAS error (${lat},${lon}):`, e.message);
    return { ok: false, values: [], error: e.message };
  }
}

// ══════════════════════════════════════════════════════
//  HELPER — fetch weather for a point (returns 48h rain)
// ══════════════════════════════════════════════════════
async function getWeatherAt(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=precipitation_sum,precipitation_probability_max&timezone=America%2FBogota&forecast_days=3`;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    const rain = d.daily?.precipitation_sum;
    if (!Array.isArray(rain) || rain.length === 0) throw new Error('Sin datos de lluvia');
    return {
      ok: true,
      rain24: rain[0] || 0,
      rain48: (rain[0] || 0) + (rain[1] || 0),
      rain72: (rain[0] || 0) + (rain[1] || 0) + (rain[2] || 0),
    };
  } catch (e) {
    console.error(`Weather error (${lat},${lon}):`, e.message);
    return { ok: false, rain24: null, rain48: null, rain72: null, error: e.message };
  }
}

// ══════════════════════════════════════════════════════
//  HELPER — eval landslide risk for a zona given rain
// ══════════════════════════════════════════════════════
function evalLandslideRisk(zona, rain24, rain48, prevRiesgo, riverStatus) {
  if (rain24 == null || rain48 == null) {
    return {
      riesgo: prevRiesgo || zona.riesgo_base || 'unknown',
      razon: 'Fuente de lluvia no disponible. Mantener vigilancia y consultar fuentes oficiales.',
      empeoró: false,
    };
  }

  let riesgo = zona.riesgo_base;
  let razon = '';

  if (rain24 >= zona.umbral_danger || rain48 >= zona.umbral_danger_48h) {
    riesgo = 'danger';
    razon = `Lluvia crítica: ${rain24.toFixed(0)}mm/24h o ${rain48.toFixed(0)}mm/48h supera umbral (${zona.umbral_danger}mm/24h).`;
  } else if (rain24 >= zona.umbral_warn || rain48 >= zona.umbral_warn_48h) {
    riesgo = 'warn';
    razon = `Lluvia: ${rain24.toFixed(0)}mm/24h. Suelo con saturación elevada — riesgo de remoción.`;
  } else if (zona.riesgo_base === 'warn') {
    riesgo = 'warn';
    razon = `Zona históricamente activa. Condiciones actuales moderadas (${rain24.toFixed(0)}mm/24h).`;
  } else {
    razon = `Sin alerta. Lluvia: ${rain24.toFixed(0)}mm/24h — dentro de parámetros normales.`;
  }

  // Boost si el río tributario ya está en alerta
  if (riverStatus === 'danger' && riesgo !== 'danger') {
    riesgo = 'warn';
    razon += ' ⚠️ Río tributario en nivel de alerta — riesgo combinado elevado.';
  }

  const empeoró = (prevRiesgo === 'ok' && riesgo !== 'ok') ||
                  (prevRiesgo === 'warn' && riesgo === 'danger');

  return { riesgo, razon, empeoró };
}


// ══════════════════════════════════════════════════════
//  IDEAM — URLs de feeds RSS / XML oficiales
//  Todos son públicos, sin autenticación
// ══════════════════════════════════════════════════════
const IDEAM_FEEDS = [
  {
    id:   'ideam_rss',
    name: 'IDEAM Noticias y Boletines',
    url:  'http://www.ideam.gov.co/rss/noticias/0/RSS.xml',
    type: 'rss',
  },
  {
    id:   'ideam_avisos',
    name: 'IDEAM Avisos y Alertas',
    url:  'http://www.ideam.gov.co/rss/avisos-alertas/0/RSS.xml',
    type: 'rss',
  },
];

// Entidades locales/regionales. Agrega aqui RSS/Atom publicos de alcaldias,
// Bomberos, Defensa Civil, gestion del riesgo, CORPONOR, etc.
const LOCAL_ENTITY_FEEDS = [
  // { id: 'corponor_alertas', name: 'CORPONOR Alertas', url: 'https://...', type: 'rss' },
];

const OFFICIAL_FEEDS = [...IDEAM_FEEDS, ...LOCAL_ENTITY_FEEDS];

// Palabras clave región Norte de Santander
const IDEAM_KEYWORDS_REGION = [
  'norte de santander', 'nortesantander', 'cúcuta', 'cucuta',
  'pamplonita', 'zulia', 'táchira', 'tachira', 'catatumbo',
  'sardinata', 'tibú', 'tibu', 'ocaña', 'ocana', 'pamplona',
  'villa del rosario', 'los patios', 'el zulia', 'convención',
];

// Palabras clave de tipo hidrometeorológico
const IDEAM_KEYWORDS_TIPO = [
  'inundación', 'inundacion', 'creciente', 'desbordamiento',
  'deslizamiento', 'remoción', 'remocion', 'avenida torrencial',
  'alerta roja', 'alerta naranja', 'alerta amarilla',
  'lluvia', 'precipitación', 'precipitacion', 'vendaval',
  'nivel', 'caudal', 'hidrologica', 'hidrológica',
];

// ── Parsear XML RSS ────────────────────────────────────
function parseRSS(xml) {
  const items = [];
  const tagRe = /<(?:item|entry)[\s>]([\s\S]*?)<\/(?:item|entry)>/gi;
  let match;
  while ((match = tagRe.exec(xml)) !== null) {
    const block = match[1];
    const get = (tag) => {
      const m = block.match(new RegExp(
        `<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`, 'i'
      ));
      return m ? (m[1] || m[2] || '').trim() : '';
    };
    const title   = get('title');
    const desc    = get('description') || get('summary') || get('content');
    const link    = get('link');
    const pubDate = get('pubDate') || get('published') || get('updated');
    if (title || desc) items.push({ title, desc, link, pubDate });
  }
  return items;
}

// ── Determinar nivel desde texto IDEAM ────────────────
function inferLevel(text) {
  const t = text.toLowerCase();
  if (t.includes('roja') || t.includes('crítico') || t.includes('critico') ||
      t.includes('evacu') || t.includes('emergencia')) return 'danger';
  if (t.includes('naranja') || t.includes('amarilla') || t.includes('precaución') ||
      t.includes('precaucion') || t.includes('vigilancia') || t.includes('alerta')) return 'warn';
  return 'info';
}

// ── Verificar relevancia regional ─────────────────────
function isRelevant(item) {
  const text = `${item.title} ${item.desc}`.toLowerCase();
  const inRegion = IDEAM_KEYWORDS_REGION.some(k => text.includes(k));
  const isTipo   = IDEAM_KEYWORDS_TIPO.some(k => text.includes(k));
  return inRegion || isTipo;
}

// ── Fetch feed IDEAM con timeout ──────────────────────
async function fetchIDEAMFeed(feed) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const r = await fetch(feed.url, {
      headers: { 'User-Agent': 'AlertaRios/2.1 Colombia' },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const text = await r.text();
    return parseRSS(text).filter(isRelevant).slice(0, 8);
  } catch (e) {
    console.warn(`[IDEAM] ${feed.id} error:`, e.message);
    return [];
  }
}

async function getNASAPowerRain(lat, lon) {
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const url = 'https://power.larc.nasa.gov/api/temporal/hourly/point'
    + `?parameters=PRECTOTCORR&community=AG&longitude=${lon}&latitude=${lat}`
    + `&start=${ymd}&end=${ymd}&format=JSON&time-standard=UTC`;

  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'AlertaRios/2.1 Colombia' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    const values = d.properties?.parameter?.PRECTOTCORR || {};
    const rain24 = Object.values(values)
      .map(Number)
      .filter(value => Number.isFinite(value) && value >= 0)
      .reduce((sum, value) => sum + value, 0);
    return { ok: true, rain24 };
  } catch (e) {
    console.warn(`NASA POWER error (${lat},${lon}):`, e.message);
    return { ok: false, rain24: null, error: e.message };
  }
}

// ── Fingerprint para deduplicar ───────────────────────
function fingerprint(title) {
  return (title || '').slice(0, 60).toLowerCase().replace(/\s+/g, '');
}

// ══════════════════════════════════════════════════════
//  SCHEDULED FUNCTION — every 30 min
//  Checks rivers + landslides, writes Firestore, sends push
// ══════════════════════════════════════════════════════
exports.checkRivers = functions.pubsub
  .schedule('every 30 minutes')
  .onRun(async (context) => {

    // Load previous state
    const [riverSnap, slideSnap] = await Promise.all([
      db.collection('rivers_status').doc('latest').get(),
      db.collection('landslide_status').doc('latest').get(),
    ]);
    const prevRivers   = riverSnap.exists  ? riverSnap.data()  : {};
    const prevSlides   = slideSnap.exists  ? slideSnap.data()  : {};

    const riverResults = {};
    const slideResults = {};
    const newAlerts    = [];

    // ── 1. CHECK RIVERS ────────────────────────────────
    for (const c of CUENCAS) {
      const [bajoData, altoData] = await Promise.all([
        getDischarge(c.lat, c.lon, 3),
        getDischarge(c.lat_alto, c.lon_alto, 3),
      ]);

      if (!bajoData.ok || !altoData.ok) {
        const prev = prevRivers[c.id] || {};
        riverResults[c.id] = {
          ...prev,
          status: prev.status || 'unknown',
          upstream_status: prev.upstream_status || 'unknown',
          data_available: false,
          source_error: [bajoData.error, altoData.error].filter(Boolean).join(' | '),
          timestamp: Date.now(),
        };
        continue;
      }

      const arr_bajo = bajoData.values;
      const arr_alto = altoData.values;
      const q_bajo = arr_bajo[0] || 0;
      const q_alto = arr_alto[0] || 0;
      const q_bajo_ayer = arr_bajo[1] || q_bajo;
      const trend = q_bajo - q_bajo_ayer;

      const status = q_bajo >= c.umbral_danger ? 'danger'
                   : q_bajo >= c.umbral_warn   ? 'warn' : 'ok';

      const upstream_status = q_alto >= c.umbral_danger * 0.4 ? 'danger'
                             : q_alto >= c.umbral_warn  * 0.5 ? 'warn' : 'ok';

      const prevStatus   = prevRivers[c.id]?.status           || 'ok';
      const prevUpstream = prevRivers[c.id]?.upstream_status  || 'ok';

      riverResults[c.id] = {
        q_bajo, q_alto, trend, status, upstream_status,
        timestamp: Date.now(),
      };

      // Downstream — alert only when status WORSENS
      if (status === 'danger' && prevStatus !== 'danger') {
        newAlerts.push({
          type:    'river',
          level:   'danger',
          title:   `🚨 ${c.nombre} — DESBORDAMIENTO PROBABLE`,
          body:    `Caudal: ${q_bajo.toFixed(0)} m³/s (umbral crítico: ${c.umbral_danger} m³/s). Municipios en riesgo: ${c.municipios_riesgo.join(', ')}.`,
          rio_id:  c.id,
          source:  'GloFAS / Copernicus EU',
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
      } else if (status === 'warn' && prevStatus === 'ok') {
        newAlerts.push({
          type:   'river',
          level:  'warn',
          title:  `⚠️ ${c.nombre} — Precaución`,
          body:   `Caudal: ${q_bajo.toFixed(0)} m³/s. Umbral de alerta: ${c.umbral_warn} m³/s. Vigilar evolución.`,
          rio_id: c.id,
          source: 'GloFAS / Copernicus EU',
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      // Upstream surge — alert only when meaningfully new
      const upstreamPct = q_alto / (c.umbral_warn * 0.5);
      const prevQAlto   = prevRivers[c.id]?.q_alto || 0;
      const subioBastante = prevQAlto > 0
        ? q_alto > prevQAlto * 1.2     // subió >20% vs lectura anterior
        : upstreamPct >= 1.5;

      if ((upstream_status === 'danger' || upstream_status === 'warn') &&
          prevUpstream === 'ok' && subioBastante) {
        newAlerts.push({
          type:   'river_upstream',
          level:  upstream_status,
          title:  `🏔 Creciente en nacimiento — ${c.nombre}`,
          body:   `Caudal en cuenca alta: ${q_alto.toFixed(0)} m³/s. La ola puede llegar al tramo bajo en 2–6 horas.`,
          rio_id: c.id,
          source: 'GloFAS Cuenca Alta',
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      // Time-to-flood warning (only once, when first enters the window)
      if (trend > 0 && status !== 'danger') {
        const remaining = c.umbral_danger - q_bajo;
        const horasEstimadas = remaining > 0 ? Math.round(remaining / Math.max(trend, 0.01)) : 0;
        if (horasEstimadas > 0 && horasEstimadas <= 6 && prevStatus !== 'danger') {
          const prevTTF = prevRivers[c.id]?.ttf_hours;
          if (!prevTTF || prevTTF > 6) {
            newAlerts.push({
              type:   'river_ttf',
              level:  horasEstimadas <= 3 ? 'danger' : 'warn',
              title:  `⏱ ${c.nombre} podría desbordar en ~${horasEstimadas}h`,
              body:   `Con la tendencia actual (+${trend.toFixed(1)} m³/s·h), se alcanzaría el umbral crítico en ~${horasEstimadas} horas.`,
              rio_id: c.id,
              source: 'GloFAS Proyección',
              timestamp: admin.firestore.FieldValue.serverTimestamp(),
            });
          }
        }
        riverResults[c.id].ttf_hours = trend > 0 ? Math.round((c.umbral_danger - q_bajo) / Math.max(trend, 0.01)) : null;
      }
    }

    // ── 2. CHECK RAIN (región general) ─────────────────
    const [regionWx, nasaRegionWx] = await Promise.all([
      getWeatherAt(7.89, -72.51),
      getNASAPowerRain(7.89, -72.51),
    ]);

    riverResults._rain_sources = {
      open_meteo: { ok: regionWx.ok, rain24: regionWx.rain24, error: regionWx.error || null },
      nasa_power: { ok: nasaRegionWx.ok, rain24: nasaRegionWx.rain24, error: nasaRegionWx.error || null },
      updated_at: Date.now(),
    };

    const rainCandidates = [
      regionWx.ok ? { source: 'Open-Meteo', rain24: regionWx.rain24 } : null,
      nasaRegionWx.ok ? { source: 'NASA POWER', rain24: nasaRegionWx.rain24 } : null,
    ].filter(Boolean);
    const regionRain = rainCandidates.sort((a, b) => b.rain24 - a.rain24)[0] || null;

    if (regionRain && regionRain.rain24 >= 60 && (prevRivers._rain_alerted_at || 0) < Date.now() - 3 * 3600 * 1000) {
      newAlerts.push({
        type:   'rain',
        level:  'danger',
        title:  `🌧 Lluvia extrema — ${regionRain.rain24.toFixed(0)}mm/24h`,
        body:   `Alta probabilidad de crecientes repentinas en todos los ríos de montaña. Evitar zonas ribereñas.`,
        source: regionRain.source,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
      riverResults._rain_alerted_at = Date.now();
    } else if (regionRain && regionRain.rain24 >= 30 && regionRain.rain24 < 60) {
      // Solo guardar en estado, sin push para lluvia moderada
    }

    // ── 3. CHECK LANDSLIDES ─────────────────────────────
    for (const zona of ZONAS_DESLIZAMIENTO) {
      // Fetch weather specifically for each landslide zone
      const [wx, nasaWx] = await Promise.all([
        getWeatherAt(zona.lat, zona.lon),
        getNASAPowerRain(zona.lat, zona.lon),
      ]);

      const riverStatus = riverResults[zona.rio_afectado]?.status || 'ok';
      const prevRiesgo  = prevSlides[zona.id]?.riesgo || zona.riesgo_base;

      const { riesgo, razon, empeoró } = evalLandslideRisk(
        zona, wx.rain24, wx.rain48, prevRiesgo, riverStatus
      );

      slideResults[zona.id] = {
        riesgo, razon,
        rain24: wx.rain24,
        rain48: wx.rain48,
        nasa_power_rain24: nasaWx.rain24,
        data_available: wx.ok,
        nasa_power_available: nasaWx.ok,
        source_error: [wx.error, nasaWx.error].filter(Boolean).join(' | ') || null,
        rio_afectado: zona.rio_afectado,
        municipio: zona.municipio,
        timestamp: Date.now(),
      };

      // Push solo cuando empeora
      if (empeoró) {
        if (riesgo === 'danger') {
          newAlerts.push({
            type:       'landslide',
            level:      'danger',
            title:      `🏔 DESLIZAMIENTO CRÍTICO — ${zona.nombre}`,
            body:       `${razon} Impacto en ${CUENCAS.find(c => c.id === zona.rio_afectado)?.nombre || zona.rio_afectado}: ${zona.impacto_rio}`,
            zona_id:    zona.id,
            municipio:  zona.municipio,
            rio_id:     zona.rio_afectado,
            source:     'Open-Meteo + UNGRD',
            timestamp:  admin.firestore.FieldValue.serverTimestamp(),
          });
        } else if (riesgo === 'warn') {
          newAlerts.push({
            type:       'landslide',
            level:      'warn',
            title:      `⚠️ Riesgo de deslizamiento — ${zona.nombre}`,
            body:       `${razon} Zona: ${zona.municipio}. ${zona.descripcion}`,
            zona_id:    zona.id,
            municipio:  zona.municipio,
            rio_id:     zona.rio_afectado,
            source:     'Open-Meteo + UNGRD',
            timestamp:  admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      }
    }

    // ── 4. CHECK IDEAM RSS ─────────────────────────────
    // Carga alertas oficiales del IDEAM y las fusiona con las propias.
    // Solo guarda alertas que no hayan sido guardadas antes (dedup por fingerprint).
    try {
      const recentSnap = await db.collection('alerts')
        .where('source', '==', 'IDEAM Oficial')
        .orderBy('timestamp', 'desc')
        .limit(50)
        .get();

      const existingFPs = new Set(
        recentSnap.docs.map(d => fingerprint(d.data().title))
      );

      const allIDEAMItems = (
        await Promise.all(OFFICIAL_FEEDS.map(fetchIDEAMFeed))
      ).flat();

      for (const item of allIDEAMItems) {
        const fp = fingerprint(item.title);
        if (existingFPs.has(fp)) continue;   // ya guardada

        const fullText = `${item.title} ${item.desc}`;
        const level = inferLevel(fullText);

        // Solo push si es warn o danger
        const ideamAlert = {
          type:      'ideam',
          level,
          title:     item.title?.slice(0, 160) || 'Alerta IDEAM',
          body:      (item.desc || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400),
          link:      item.link || '',
          source:    'IDEAM Oficial',
          pub_date:  item.pubDate || '',
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        };

        await db.collection('alerts').add(ideamAlert);
        existingFPs.add(fp);

        if (level === 'danger' || level === 'warn') {
          await sendPushToAll(ideamAlert);
          console.log(`[IDEAM] Nueva alerta guardada y push enviado: "${item.title?.slice(0, 60)}"`);
        } else {
          console.log(`[IDEAM] Ítem informativo guardado: "${item.title?.slice(0, 60)}"`);
        }
      }

      console.log(`[IDEAM] ${allIDEAMItems.length} ítem(s) procesados`);
    } catch (e) {
      console.error('[IDEAM] Error general:', e.message);
    }

    // ── 5. SAVE TO FIRESTORE ────────────────────────────
    await Promise.all([
      db.collection('rivers_status').doc('latest').set(riverResults),
      db.collection('landslide_status').doc('latest').set(slideResults),
    ]);

    // ── 6. SAVE ALERTS + SEND PUSH ──────────────────────
    for (const alert of newAlerts) {
      await db.collection('alerts').add(alert);
      await sendPushToAll(alert);
    }

    console.log(`✅ checkRivers done — ${newAlerts.length} new alert(s).`);
    console.log(`   Rivers: ${Object.keys(riverResults).filter(k=>!k.startsWith('_')).length} checked`);
    console.log(`   Landslides: ${Object.keys(slideResults).length} zones checked`);
    return null;
  });

// ══════════════════════════════════════════════════════
//  SEND PUSH to all subscribed FCM tokens
// ══════════════════════════════════════════════════════
async function sendPushToAll(alert) {
  const tokensSnap = await db.collection('fcm_tokens').get();
  const tokens = tokensSnap.docs.map(d => d.data().token).filter(Boolean);
  if (!tokens.length) return;

  const isLandslide = alert.type === 'landslide';
  const isDanger    = alert.level === 'danger';

  // Color coding: deslizamientos en morado, ríos en rojo/amarillo
  const color = isLandslide
    ? (isDanger ? '#c874ff' : '#9b4fff')
    : (isDanger ? '#f0433a' : '#f5a623');

  const channelId = isLandslide ? 'alerta_deslizamientos' : 'alerta_rios';

  const message = {
    notification: { title: alert.title, body: alert.body },
    data: {
      level:    alert.level,
      type:     alert.type    || 'river',
      source:   alert.source  || '',
      rio_id:   alert.rio_id  || '',
      zona_id:  alert.zona_id || '',
    },
    android: {
      priority: isDanger ? 'high' : 'normal',
      notification: {
        color,
        sound:     isDanger ? 'alarm' : 'default',
        channelId,
        // Vibration pattern para deslizamientos: distinto al de inundaciones
        vibrateTimingsMillis: isLandslide
          ? [0, 500, 200, 500, 200, 500]
          : [0, 300, 150, 300],
      },
    },
    apns: {
      payload: {
        aps: {
          sound:               isDanger ? 'alarm.wav' : 'default',
          badge:               1,
          'interruption-level': isDanger ? 'critical' : 'active',
        },
      },
    },
    tokens,
  };

  try {
    const resp = await admin.messaging().sendEachForMulticast(message);
    console.log(`📲 Push "${alert.title}": ${resp.successCount} ok, ${resp.failureCount} failed`);

    // Clean up invalid tokens
    const invalid = [];
    resp.responses.forEach((r, i) => {
      if (!r.success && r.error?.code === 'messaging/registration-token-not-registered') {
        invalid.push(tokens[i]);
      }
    });
    if (invalid.length) {
      const batch = db.batch();
      tokensSnap.docs.forEach(doc => {
        if (invalid.includes(doc.data().token)) batch.delete(doc.ref);
      });
      await batch.commit();
      console.log(`🧹 Cleaned ${invalid.length} invalid token(s)`);
    }
  } catch (e) {
    console.error('Push error:', e.message);
  }
}

// ══════════════════════════════════════════════════════
//  HTTP — Register FCM token
// ══════════════════════════════════════════════════════
exports.registerToken = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    return res.sendStatus(204);
  }
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'No token' });
  await db.collection('fcm_tokens').doc(token).set({
    token,
    created: admin.firestore.FieldValue.serverTimestamp(),
  });
  res.json({ ok: true });
});

// ══════════════════════════════════════════════════════
//  HTTP — Get current status (rivers + landslides)
// ══════════════════════════════════════════════════════
exports.getStatus = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');

  const [riverDoc, slideDoc, alertsSnap] = await Promise.all([
    db.collection('rivers_status').doc('latest').get(),
    db.collection('landslide_status').doc('latest').get(),
    db.collection('alerts').orderBy('timestamp', 'desc').limit(30).get(),
  ]);

  res.json({
    rivers:      riverDoc.data()  || {},
    landslides:  slideDoc.data()  || {},
    alerts:      alertsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
  });
});

// ══════════════════════════════════════════════════════
//  HTTP — Submit citizen report (from PWA)
// ══════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════
//  HTTP — Get IDEAM alerts only (for external consumers)
// ══════════════════════════════════════════════════════
exports.getIDEAMAlerts = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  try {
    const snap = await db.collection('alerts')
      .where('source', '==', 'IDEAM Oficial')
      .orderBy('timestamp', 'desc')
      .limit(20)
      .get();
    res.json({
      source: 'IDEAM Oficial',
      count:  snap.size,
      items:  snap.docs.map(d => ({ id: d.id, ...d.data() })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════
//  HTTP — Force IDEAM refresh (admin use, manual trigger)
// ══════════════════════════════════════════════════════
exports.refreshIDEAM = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  // Basic protection: require a configured secret header.
  const secret = functions.config().app?.admin_secret || '';
  if (!secret) {
    return res.status(503).json({ error: 'Admin secret is not configured' });
  }
  if (req.headers['x-admin-secret'] !== secret) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const allItems = (await Promise.all(OFFICIAL_FEEDS.map(fetchIDEAMFeed))).flat();

    const recentSnap = await db.collection('alerts')
      .where('source', '==', 'IDEAM Oficial')
      .orderBy('timestamp', 'desc')
      .limit(50)
      .get();
    const existingFPs = new Set(recentSnap.docs.map(d => fingerprint(d.data().title)));

    let saved = 0;
    for (const item of allItems) {
      const fp = fingerprint(item.title);
      if (existingFPs.has(fp)) continue;
      const level = inferLevel(`${item.title} ${item.desc}`);
      await db.collection('alerts').add({
        type: 'ideam', level,
        title:    item.title?.slice(0, 160) || 'Alerta IDEAM',
        body:     (item.desc || '').replace(/<[^>]+>/g, ' ').trim().slice(0, 400),
        link:     item.link || '',
        source:   'IDEAM Oficial',
        pub_date: item.pubDate || '',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
      existingFPs.add(fp);
      saved++;
    }
    res.json({ ok: true, processed: allItems.length, saved });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

exports.submitReport = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    return res.sendStatus(204);
  }

  const { tipo, lugar, rio, descripcion, urgencia, lat, lon } = req.body;
  if (!lugar || !descripcion) return res.status(400).json({ error: 'Faltan campos requeridos' });

  const tipoLabels = {
    inundacion: '🌊 Inundación', deslizamiento: '🏔 Deslizamiento',
    obstruccion: '🪨 Obstrucción río', desbordamiento: '💧 Desbordamiento',
    lluvia: '⛈️ Lluvia extrema', otro: '📢 Aviso ciudadano',
  };

  const report = {
    type:      'citizen_report',
    level:     urgencia || 'info',
    title:     `${tipoLabels[tipo] || '📍 Reporte'} en ${lugar}`,
    body:      descripcion + (rio ? ` Río: ${rio}.` : ''),
    tipo,
    lugar,
    rio_id:    rio || null,
    lat:       lat || null,
    lon:       lon || null,
    source:    'Reporte ciudadano',
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection('alerts').add(report);

  // Push only if urgent
  if (urgencia === 'danger' || urgencia === 'warn') {
    await sendPushToAll(report);
  }

  res.json({ ok: true });
});
