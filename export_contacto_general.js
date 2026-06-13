import fs from 'fs';
import path from 'path';
import xlsx from 'xlsx';

const SEEN_FILE = path.join(process.cwd(), 'prospector_seen.json');

function getArg(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

function parseCsv(filepath) {
  const content = fs.readFileSync(filepath, 'utf-8').replace(/^\uFEFF/, '');
  const lines = content.split('\n').filter(l => l.trim());
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map(line => {
    const values = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());
    const obj = {};
    headers.forEach((h, i) => { obj[h] = values[i] || 'sin datos'; });
    return obj;
  });
}

function normalizeText(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeTextKey(value) {
  return normalizeText(value);
}

function normalizeZoneToken(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function rowSearchText(row) {
  return normalizeText([
    row.nombre,
    row.categoria,
    row.direccion,
    row.mapsUrl,
    row.maps_url,
    row.website,
    row.descripcion
  ].filter(Boolean).join(' '));
}

function hasPostalCodeInRange(text, from, to) {
  const matches = text.match(/\b\d{5}\b/g) || [];
  return matches.some((cp) => {
    const value = Number.parseInt(cp, 10);
    return value >= from && value <= to;
  });
}

function inferZonaFromText(row) {
  const text = rowSearchText(row);

  if (
    text.includes('atizapan') ||
    text.includes('atizapan de zaragoza') ||
    text.includes('ciudad lopez mateos') ||
    text.includes('cdad lopez mateos') ||
    hasPostalCodeInRange(text, 52900, 52999)
  ) {
    return 'atizapan';
  }

  if (
    text.includes('naucalpan') ||
    text.includes('satelite') ||
    text.includes('echegaray') ||
    text.includes('lomas verdes') ||
    hasPostalCodeInRange(text, 53100, 53599)
  ) {
    return 'naucalpan/satelite';
  }

  if (
    text.includes('tlalnepantla') ||
    hasPostalCodeInRange(text, 54000, 54199)
  ) {
    return 'tlalnepantla';
  }

  if (
    text.includes('azcapotzalco') ||
    text.includes('gustavo a madero') ||
    text.includes('cdmx') ||
    text.includes('ciudad de mexico')
  ) {
    return 'cdmx';
  }

  return '';
}

function getTargetZone(inputFile) {
  return normalizeZoneToken(getArg('zona') || path.basename(inputFile, path.extname(inputFile)));
}

function isLeadInTargetZone(row, targetZone) {
  const inferred = inferZonaFromText(row);
  if (!inferred) return { inZone: true, uncertain: true, inferred };

  if (targetZone.includes('atizapan')) {
    return { inZone: inferred === 'atizapan', uncertain: false, inferred };
  }

  if (targetZone.includes('naucalpan') || targetZone.includes('satelite')) {
    return { inZone: inferred === 'naucalpan/satelite', uncertain: false, inferred };
  }

  if (targetZone.includes('tlalnepantla')) {
    return { inZone: inferred === 'tlalnepantla', uncertain: false, inferred };
  }

  if (targetZone.includes('cdmx') || targetZone.includes('ciudad de mexico')) {
    return { inZone: inferred === 'cdmx', uncertain: false, inferred };
  }

  return { inZone: true, uncertain: true, inferred };
}

function splitByTargetZone(leads, targetZone) {
  const enZona = [];
  const fueraZona = [];
  const zonaIncierta = [];

  for (const lead of leads) {
    const result = isLeadInTargetZone(lead, targetZone);
    if (result.uncertain) {
      zonaIncierta.push(lead);
    } else if (result.inZone) {
      enZona.push(lead);
    } else {
      fueraZona.push(lead);
    }
  }

  return { enZona, fueraZona, zonaIncierta };
}

function cleanPhoneKey(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function getPhoneKey(lead) {
  const whatsapp = String(lead.whatsapp_link || lead.posible_whatsapp_url || '');
  const whatsappMatch = whatsapp.match(/wa\.me\/(\d+)/i);
  if (whatsappMatch) return whatsappMatch[1];
  return cleanPhoneKey(lead.telefono);
}

function normalizeMapsUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === 'sin datos') return '';

  try {
    const url = new URL(raw);
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/$/, '').toLowerCase();
  } catch (e) {
    return raw.split('?')[0].split('#')[0].replace(/\/$/, '').toLowerCase();
  }
}

function getLeadKeys(lead) {
  const nombre = normalizeTextKey(lead.nombre);
  const direccion = normalizeTextKey(lead.direccion);
  return {
    phone: getPhoneKey(lead),
    mapsUrl: normalizeMapsUrl(lead.mapsUrl || lead.maps_url),
    nameAddress: nombre && direccion ? `${nombre}__${direccion}` : ''
  };
}

function emptySeen() {
  return {
    version: 1,
    updatedAt: null,
    leads: []
  };
}

function loadSeen() {
  if (!fs.existsSync(SEEN_FILE)) return emptySeen();

  try {
    const parsed = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf-8'));
    if (!parsed || !Array.isArray(parsed.leads)) {
      throw new Error('Formato invalido: falta arreglo "leads".');
    }
    return parsed;
  } catch (error) {
    console.error(`Error leyendo historial local ${SEEN_FILE}: ${error.message}`);
    console.error('No se exporto nada para evitar perder o corromper el historial.');
    process.exit(1);
  }
}

function buildSeenIndexes(seen) {
  const indexes = {
    phones: new Set(),
    mapsUrls: new Set(),
    nameAddresses: new Set()
  };

  for (const item of seen.leads) {
    if (item.phone) indexes.phones.add(item.phone);
    if (item.mapsUrl) indexes.mapsUrls.add(item.mapsUrl);
    if (item.nameAddress) indexes.nameAddresses.add(item.nameAddress);
  }

  return indexes;
}

function isDuplicateByKeys(keys, indexes) {
  return Boolean(
    (keys.phone && indexes.phones.has(keys.phone)) ||
    (keys.mapsUrl && indexes.mapsUrls.has(keys.mapsUrl)) ||
    (keys.nameAddress && indexes.nameAddresses.has(keys.nameAddress))
  );
}

function addKeysToIndexes(keys, indexes) {
  if (keys.phone) indexes.phones.add(keys.phone);
  if (keys.mapsUrl) indexes.mapsUrls.add(keys.mapsUrl);
  if (keys.nameAddress) indexes.nameAddresses.add(keys.nameAddress);
}

function splitNewAndDuplicateLeads(leads, seen) {
  const indexes = buildSeenIndexes(seen);
  const nuevos = [];
  const duplicados = [];

  for (const lead of leads) {
    const keys = getLeadKeys(lead);
    if (isDuplicateByKeys(keys, indexes)) {
      duplicados.push(lead);
      continue;
    }

    nuevos.push(lead);
    addKeysToIndexes(keys, indexes);
  }

  return { nuevos, duplicados };
}

function updateSeenWithNewLeads(seen, leads) {
  const indexes = buildSeenIndexes(seen);

  for (const lead of leads) {
    const keys = getLeadKeys(lead);
    if (!keys.phone && !keys.mapsUrl && !keys.nameAddress) continue;
    if (isDuplicateByKeys(keys, indexes)) continue;

    seen.leads.push({
      ...keys,
      nombre: lead.nombre || 'sin datos',
      direccion: lead.direccion || 'sin datos',
      addedAt: new Date().toISOString()
    });
    addKeysToIndexes(keys, indexes);
  }

  seen.version = 1;
  seen.updatedAt = new Date().toISOString();
  fs.writeFileSync(SEEN_FILE, JSON.stringify(seen, null, 2), 'utf-8');
  return seen.leads.length;
}

function normalizarFugasFotos(texto) {
  return String(texto || '')
    .replace(/Sin fotos[^|]*/gi, 'posible baja actividad visual en la ficha - requiere validacion visual')
    .replace(/Solo\s+\d+\s*foto\(s\)[^|]*/gi, 'posible baja actividad visual en la ficha - requiere validacion visual')
    .replace(/pocas fotos[^|]*/gi, 'posible baja actividad visual en la ficha - requiere validacion visual')
    .replace(/\d+\s*fotos[^|]*/gi, 'posible baja actividad visual en la ficha - requiere validacion visual');
}

function formatFotosEstimadas(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === 'sin datos') return 'requiere validacion visual';
  return `${raw} (estimado; requiere validacion visual)`;
}

function detectarFugas(lead) {
  const resenas = parseInt(String(lead.resenas || 0).replace(/[^0-9]/g, ''), 10) || 0;
  const rating = parseFloat(String(lead.rating || '0').replace(',', '.')) || 0;
  const website = String(lead.website || '').toLowerCase();
  const fotos = parseInt(String(lead.fotos || '0').replace(/[^0-9]/g, ''), 10) || 0;
  const ultimaResena = String(lead.ultima_resena || '').toLowerCase();
  const respondeResenas = String(lead.responde_resenas || '').toLowerCase();
  const publicaciones = parseInt(String(lead.publicaciones || '0').replace(/[^0-9]/g, ''), 10) || 0;
  const descripcion = String(lead.descripcion || '').toLowerCase();
  const horarios = String(lead.horarios || '').toLowerCase();

  const fugas = [];
  let score = 0;

  // REPUTACIÓN
  if (rating > 0 && rating <= 4.3) {
    fugas.push(`Calificación baja (${rating}★) — afecta la decisión de nuevos pacientes`);
    score += 3;
  }

  // RESEÑAS
  if (resenas === 0) {
    fugas.push('Sin reseñas en Google — el negocio no genera confianza digital');
    score += 3;
  } else if (resenas < 15) {
    fugas.push(`Solo ${resenas} reseñas — muy pocas para generar confianza vs competencia`);
    score += 2;
  } else if (resenas < 30) {
    fugas.push(`${resenas} reseñas — por debajo del promedio de competidores bien posicionados`);
    score += 1;
  }

  // ÚLTIMA RESEÑA ANTIGUA
  if (
    ultimaResena.includes('año') ||
    ultimaResena.includes('2 años') ||
    ultimaResena.includes('3 años') ||
    ultimaResena.includes('a year ago') ||
    ultimaResena.includes('years ago')
  ) {
    fugas.push(`Última reseña: "${lead.ultima_resena}" — ficha parece abandonada`);
    score += 3;
  } else if (
    ultimaResena !== 'sin datos' &&
    !ultimaResena.includes('hace 1 mes') &&
    !ultimaResena.includes('semana') &&
    !ultimaResena.includes('día') &&
    !ultimaResena.includes('hoy') &&
    ultimaResena.includes('mes')
  ) {
    fugas.push(`Última reseña hace varios meses — actividad baja en Google`);
    score += 1;
  }

  // SITIO WEB
  if (!website || website === 'sin datos') {
    fugas.push('Sin sitio web — pierde pacientes que buscan más información antes de llamar');
    score += 2;
  } else if (website.includes('facebook.com')) {
    fugas.push('Solo tiene Facebook como web — no tiene dominio propio ni página profesional');
    score += 2;
  }

  // FOTOS: dato estimado, no evidencia confirmada.
  if (fotos === 0) {
    fugas.push('posible baja actividad visual en la ficha - requiere validacion visual');
    score += 3;
  } else if (fotos < 5) {
    fugas.push('posible baja actividad visual en la ficha - requiere validacion visual');
    score += 2;
  } else if (fotos < 15) {
    fugas.push('posible oportunidad de mejorar actividad visual en la ficha - requiere validacion visual');
    score += 1;
  }

  // NO RESPONDE RESEÑAS
  if (respondeResenas === 'no') {
    fugas.push('No responde reseñas — señal de abandono para pacientes que investigan antes de ir');
    score += 2;
  }

  // SIN PUBLICACIONES
  if (publicaciones === 0) {
    fugas.push('Sin publicaciones en Google Business — ficha estática, Google la penaliza en el ranking');
    score += 2;
  }

  // SIN DESCRIPCIÓN
  if (!descripcion || descripcion === 'sin datos' || descripcion.length < 30) {
    fugas.push('Sin descripción del negocio — no comunica servicios ni diferenciadores al paciente');
    score += 1;
  }

  // SIN HORARIOS
  if (!horarios || horarios === 'sin datos') {
    fugas.push('Sin horarios publicados — pacientes no saben cuándo llamar o visitar');
    score += 1;
  }

  // PRIORIDAD BASADA EN SCORE ACUMULADO
  let prioridad;
  if (score >= 7) {
    prioridad = '1. ALTA PRIORITARIA';
  } else if (score >= 4) {
    prioridad = '2. ALTA';
  } else if (score >= 2) {
    prioridad = '3. MEDIA';
  } else if (score >= 1) {
    prioridad = '4. BAJA';
  } else {
    prioridad = '5. NO CONTACTAR';
  }

  const fugaTexto = fugas.length > 0
    ? normalizarFugasFotos(fugas.join(' | '))
    : 'Sin fugas detectadas con datos disponibles';

  return { prioridad, fuga: fugaTexto, score, totalFugas: fugas.length };
}

function buildMessage(lead) {
  const nombre = lead.nombre || 'tu negocio';
  return `Hola, soy Juan Carlos de Presencia Digital. Vi ${nombre} en Google Maps y detecté detalles que podrían estar haciendo que algunos clientes elijan otra opción antes de escribirles. ¿Les puedo compartir qué encontré?`;
}

function getWhatsappLink(phone, message) {
  const digits = String(phone || '').replace(/[^0-9]/g, '');
  if (!digits || digits.length < 8) return '';
  const number = digits.startsWith('52') ? digits : `52${digits}`;
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

function processLeads(leads) {
  return leads.map(lead => {
    const { prioridad, fuga, score, totalFugas } = detectarFugas(lead);
    const mensaje = buildMessage(lead);
    const whatsappLink = getWhatsappLink(lead.telefono, mensaje);

    return {
      nombre: lead.nombre || 'Sin nombre',
      categoria: lead.categoria || 'sin datos',
      prioridad,
      score,
      total_fugas: totalFugas,
      fugas_detectadas: fuga,
      rating: lead.rating || 'sin datos',
      resenas: lead.resenas || '0',
      fotos_estimadas: formatFotosEstimadas(lead.fotos),
      diagnostico_fotos: 'requiere validacion visual',
      ultima_resena: lead.ultima_resena || 'sin datos',
      responde_resenas: lead.responde_resenas || 'no',
      publicaciones: lead.publicaciones || '0',
      website: lead.website || 'sin datos',
      horarios: lead.horarios || 'sin datos',
      descripcion: lead.descripcion || 'sin datos',
      telefono: lead.telefono || 'sin datos',
      whatsapp_link: whatsappLink,
      abrir_whatsapp: whatsappLink ? `=HYPERLINK("${whatsappLink}","Abrir WhatsApp")` : 'Sin teléfono',
      direccion: lead.direccion || 'sin datos',
      maps_url: lead.mapsUrl || 'sin datos'
    };
  }).sort((a, b) => b.score - a.score);
}

function writeCsv(leads, filename) {
  const headers = [
    'nombre', 'categoria', 'prioridad', 'score', 'total_fugas', 'fugas_detectadas',
    'rating', 'resenas', 'fotos_estimadas', 'diagnostico_fotos', 'ultima_resena', 'responde_resenas',
    'publicaciones', 'website', 'horarios', 'descripcion',
    'telefono', 'whatsapp_link', 'direccion', 'maps_url'
  ];

  function escapeCsv(val) {
    if (val === null || val === undefined) return '';
    let str = String(val).trim();
    if (str.includes('"') || str.includes(',') || str.includes('\n')) {
      str = `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  const rows = [headers.join(',')];
  for (const lead of leads) {
    rows.push(headers.map(h => escapeCsv(lead[h])).join(','));
  }

  fs.writeFileSync(filename, '\ufeff' + rows.join('\n'), 'utf-8');
  console.log(`CSV guardado: ${filename}`);
}

function writeXlsx(leads, filename) {
  const headers = [
    'Nombre', 'Categoría', 'Prioridad', 'Score', 'Total Fugas', 'Fugas Detectadas',
    'Rating', 'Reseñas', 'Fotos', 'Última Reseña', 'Responde Reseñas',
    'Publicaciones', 'Website', 'Horarios', 'Descripción',
    'Teléfono', 'Abrir WhatsApp', 'Dirección', 'Maps URL'
  ];

  headers[8] = 'Fotos estimadas';
  headers.splice(9, 0, 'Diagnostico fotos');

  const rows = leads.map(lead => [
    lead.nombre,
    lead.categoria,
    lead.prioridad,
    lead.score,
    lead.total_fugas,
    lead.fugas_detectadas,
    lead.rating,
    lead.resenas,
    lead.fotos_estimadas,
    lead.diagnostico_fotos,
    lead.ultima_resena,
    lead.responde_resenas,
    lead.publicaciones,
    lead.website,
    lead.horarios,
    lead.descripcion,
    lead.telefono,
    lead.abrir_whatsapp,
    lead.direccion,
    lead.maps_url
  ]);

  const ws = xlsx.utils.aoa_to_sheet([headers, ...rows]);

  // Ancho de columnas
  ws['!cols'] = [
    { wch: 35 }, // nombre
    { wch: 20 }, // categoria
    { wch: 22 }, // prioridad
    { wch: 8  }, // score
    { wch: 10 }, // total fugas
    { wch: 80 }, // fugas detectadas
    { wch: 8  }, // rating
    { wch: 10 }, // resenas
    { wch: 34 }, // fotos estimadas
    { wch: 28 }, // diagnostico fotos
    { wch: 20 }, // ultima resena
    { wch: 15 }, // responde resenas
    { wch: 12 }, // publicaciones
    { wch: 30 }, // website
    { wch: 12 }, // horarios
    { wch: 40 }, // descripcion
    { wch: 18 }, // telefono
    { wch: 20 }, // whatsapp
    { wch: 35 }, // direccion
    { wch: 40 }, // maps url
  ];

  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, 'Prospectos');
  xlsx.writeFile(wb, filename);
  console.log(`XLSX guardado: ${filename}`);
}

function printResumen(leads) {
  const conteo = {};
  leads.forEach(l => {
    conteo[l.prioridad] = (conteo[l.prioridad] || 0) + 1;
  });

  console.log('\n=== RESUMEN ===');
  console.log(`Total leads: ${leads.length}`);
  Object.entries(conteo).sort().forEach(([k, v]) => {
    console.log(`  ${k}: ${v}`);
  });

  console.log('\n=== TOP 5 PARA CONTACTAR HOY ===');
  leads.slice(0, 5).forEach((l, i) => {
    console.log(`\n${i + 1}. ${l.nombre}`);
    console.log(`   Prioridad: ${l.prioridad} (score: ${l.score})`);
    console.log(`   Fugas: ${l.fugas_detectadas}`);
    console.log(`   WhatsApp: ${l.whatsapp_link || 'sin teléfono'}`);
  });
}

async function main() {
  const archivo = getArg('archivo');

  if (!archivo) {
    console.error('Uso: node export_contacto_general.js --archivo "leads_xxx.csv"');
    process.exit(1);
  }

  const inputFile = archivo.endsWith('.csv') ? archivo : `${archivo}.csv`;

  if (!fs.existsSync(inputFile)) {
    console.error(`Archivo no encontrado: ${inputFile}`);
    process.exit(1);
  }

  console.log(`\n=== EXPORT CONTACTO GENERAL ===`);
  console.log(`Procesando: ${inputFile}`);

  const raw = parseCsv(inputFile);
  console.log(`Leads crudos: ${raw.length}`);

  const seen = loadSeen();
  const { nuevos, duplicados } = splitNewAndDuplicateLeads(raw, seen);
  const targetZone = getTargetZone(inputFile);
  const { enZona, fueraZona, zonaIncierta } = splitByTargetZone(nuevos, targetZone);
  const nuevosParaContacto = [...enZona, ...zonaIncierta];

  const processed = processLeads(nuevosParaContacto);
  const duplicateProcessed = processLeads(duplicados);
  const fueraZonaProcessed = processLeads(fueraZona);

  const base = inputFile.replace('.csv', '');
  const csvOut = `${base}_contacto_manual.csv`;
  const xlsxOut = `${base}_contacto_manual.xlsx`;
  const dupOut = `${base}_duplicados.csv`;
  const fueraZonaOut = `${base}_fuera_zona.csv`;

  writeCsv(processed, csvOut);
  writeXlsx(processed, xlsxOut);
  writeCsv(duplicateProcessed, dupOut);
  if (fueraZonaProcessed.length > 0) {
    writeCsv(fueraZonaProcessed, fueraZonaOut);
  }

  const totalHistorico = updateSeenWithNewLeads(seen, nuevosParaContacto);

  printResumen(processed);

  console.log('\n=== HISTORIAL LOCAL ===');
  console.log(`Leads crudos: ${raw.length}`);
  console.log(`Leads despues de dedupe historico: ${nuevos.length}`);
  console.log(`Leads en zona: ${enZona.length}`);
  console.log(`Leads fuera de zona: ${fueraZona.length}`);
  console.log(`Leads con zona incierta: ${zonaIncierta.length}`);
  console.log(`Nuevos exportados: ${nuevosParaContacto.length}`);
  console.log(`Duplicados contra historico: ${duplicados.length}`);
  console.log(`Total historico actualizado: ${totalHistorico}`);
  console.log(`Archivo duplicados: ${dupOut}`);
  console.log(`Archivo fuera de zona: ${fueraZonaProcessed.length > 0 ? fueraZonaOut : 'no generado'}`);

  console.log('\nListo. Abre el XLSX para contactar.');
}

main();
