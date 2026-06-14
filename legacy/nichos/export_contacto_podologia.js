import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import dotenv from 'dotenv';

// Cargar variables de entorno
dotenv.config();

const apiKey = process.env.OPENAI_API_KEY;
const hasApiKey = apiKey && apiKey !== 'tu_api_key_aqui';
let openai = null;
if (hasApiKey) {
  openai = new OpenAI({ apiKey });
}

// Prompt del Sistema para calificar las podologías
const PODOLOGIA_SYSTEM_PROMPT = `Eres un estratega comercial y experto de primer nivel en consultoría de Presencia Digital, marketing local y ventas B2B para PYMES, especializado en el sector de salud, podología y clínicas pequeñas.
Tu tarea es calificar la calidad de un prospecto de podología extraído de Google Maps para ofrecerle servicios de presencia digital, branding, gestión de reseñas, campañas locales y automatización de WhatsApp.

Reglas de Calificación:
- ALTA si rating >= 4.5 y reseñas >= 40
- MEDIA si rating >= 4.0 y reseñas >= 15
- BAJA si rating < 4.0 o reseñas < 15
- NO CONTACTAR si no tiene teléfono válido, reseñas < 3, o la categoría no está relacionada con salud/podología.

Genera un JSON con los campos: score (0-100), clasificacion (ALTA|MEDIA|BAJA|NO CONTACTAR), razon_breve, oportunidad_principal, que_venderle.
`;

function getScoringUserPrompt(business) {
  return `Califica el siguiente negocio de podología extraído de Google Maps:

Nombre: ${business.nombre || 'sin datos'}
Categoría: ${business.categoria || 'sin datos'}
Rating: ${business.rating || 'sin datos'}
Reseñas: ${business.reseñas || 'sin datos'}
Sitio Web: ${business.website || 'sin datos'}
Dirección: ${business.direccion || 'sin datos'}
URL de Google Maps: ${business.mapsUrl || 'sin datos'}
`; 
}

function getLocalFallbackQualification(business) {
  const r = parseFloat(business.rating) || 0;
  const n = parseInt((business.reseñas || '').replace(/[^0-9]/g, ''), 10) || 0;
  const hasWeb = business.website && business.website.toLowerCase() !== 'sin datos';
  let score = 50;
  let clasificacion = 'BAJA';
  let razon_breve = '';
  let oportunidad_principal = '';
  let que_venderle = 'Servicios de Presencia Digital';

  if (r >= 4.5 && n >= 40) {
    score = 85;
    clasificacion = 'ALTA';
    razon_breve = 'Excelente rating y muchas reseñas.';
    oportunidad_principal = 'Optimización de sitio web, gestión de reseñas y campañas locales.';
    que_venderle = 'Presencia Digital Premium';
  } else if (r >= 4.0 && n >= 15) {
    score = 70;
    clasificacion = 'MEDIA';
    razon_breve = 'Buen rating y reseñas suficientes.';
    oportunidad_principal = 'Mejorar branding y generar contenido educativo.';
    que_venderle = 'Paquete Intermedio de Marketing';
  } else if (r < 4.0 || n < 15) {
    score = 45;
    clasificacion = 'BAJA';
    razon_breve = 'Rating bajo o pocas reseñas.';
    oportunidad_principal = 'Recopilación de testimonios y optimización de Google Maps.';
    que_venderle = 'Servicios Básicos de Presencia';
  }
  if (!business.telefono || business.telefono.toLowerCase() === 'sin datos' || n < 3 || !(business.categoria || '').toLowerCase().includes('podología')) {
    clasificacion = 'NO CONTACTAR';
    razon_breve = 'Datos de contacto insuficientes o categoría no relevante.';
    score = 20;
  }
  return { score, clasificacion, razon_breve, oportunidad_principal, que_venderle };
}

function cleanPhoneNumber(phone) {
  if (!phone || phone.toLowerCase() === 'sin datos') return '';
  return phone.replace(/[^0-9]/g, '');
}

function escapeCsvValue(val) {
  if (val === null || val === undefined) return '';
  let str = String(val).trim();
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    str = '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function calculatePriorityPodologia(ratingStr, reviewsStr, phoneStr, categoryStr) {
  const r = parseFloat(ratingStr);
  const n = parseInt((reviewsStr || '').replace(/[^0-9]/g, ''), 10);
  const phone = cleanPhoneNumber(phoneStr);
  const cat = (categoryStr || '').toLowerCase();
  if (!phone) return 'NO CONTACTAR';
  if (isNaN(r) || isNaN(n)) return 'NO CONTACTAR';
  if (n < 3) return 'NO CONTACTAR';
  if (!cat.includes('podología') && !cat.includes('podologia') && !cat.includes('clínica') && !cat.includes('salud')) return 'NO CONTACTAR';
  if (r >= 4.5 && n >= 40) return 'ALTA';
  if (r >= 4.0 && n >= 15) return 'MEDIA';
  return 'BAJA';
}

async function scoreBusinessWithOpenAI(business, index, total) {
  console.log(`[${index}/${total}] 🧠 Calificando ${business.nombre}...`);
  if (!openai) {
    const localQual = getLocalFallbackQualification(business);
    console.log(`   💡 (Fallback local) ${localQual.clasificacion} (Score ${localQual.score})`);
    return localQual;
  }
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: PODOLOGIA_SYSTEM_PROMPT },
        { role: 'user', content: getScoringUserPrompt(business) }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2
    });
    const parsed = JSON.parse(response.choices[0].message.content);
    return {
      score: parsed.score ?? 50,
      clasificacion: parsed.clasificacion ?? 'BAJA',
      razon_breve: parsed.razon_breve ?? '',
      oportunidad_principal: parsed.oportunidad_principal ?? '',
      que_venderle: parsed.que_venderle ?? ''
    };
  } catch (e) {
    console.warn('OpenAI error, usando fallback local', e.message);
    return getLocalFallbackQualification(business);
  }
}

async function main() {
  const csvPath = path.join(process.cwd(), 'leads_podologia_satelite_naucalpan.csv');
  const manualOut = path.join(process.cwd(), 'leads_podologia_contacto_manual.csv');
  const xlsxOut = path.join(process.cwd(), 'podologia_presencia_digital_calificadas.xlsx - Podología calificadas.csv');

  if (!fs.existsSync(csvPath)) {
    console.error('Archivo origen no encontrado:', csvPath);
    process.exit(1);
  }
  const rawContent = fs.readFileSync(csvPath, 'utf8').replace(/^\ufeff/, '');
  const lines = rawContent.split(/\r?\n/).filter(l => l.trim());
  const headers = lines[0].split(',');
  const rawLeads = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(',');
    const obj = {};
    headers.forEach((h, idx) => obj[h] = vals[idx] || 'sin datos');
    rawLeads.push(obj);
  }

  const finalLeads = [];
  const contactable = [];
  for (const lead of rawLeads) {
    const prioridad = calculatePriorityPodologia(lead.rating, lead.reseñas, lead.telefono, lead.categoria);
    lead.prioridad_contacto = prioridad;
    if (prioridad !== 'NO CONTACTAR') contactable.push(lead);
  }

  let count = 0;
  for (const lead of rawLeads) {
    let qualification;
    if (lead.prioridad_contacto === 'NO CONTACTAR') {
      qualification = {
        score: '20',
        clasificacion: 'NO CONTACTAR',
        razon_breve: 'Datos insuficientes o categoría no relevante.',
        oportunidad_principal: 'N/A',
        que_venderle: 'N/A'
      };
    } else {
      count++;
      qualification = await scoreBusinessWithOpenAI(lead, count, contactable.length);
    }
    const cleanPhone = cleanPhoneNumber(lead.telefono);
    const whatsappUrl = cleanPhone ? `https://wa.me/${cleanPhone.startsWith('52') ? cleanPhone : '52' + cleanPhone}` : '';
    const mensaje = `Hola, soy de Presencia Digital. Noté su clínica de podología en Google Maps y veo oportunidades para mejorar su presencia online y captar más pacientes. ¿Podemos conversar?`;
    const whatsappMsg = whatsappUrl ? `${whatsappUrl}?text=${encodeURIComponent(mensaje)}` : '';

    const enriched = {
      ...lead,
      posible_whatsapp_url: whatsappUrl,
      posible_whatsapp_url_with_message: whatsappMsg,
      estado_whatsapp: cleanPhone ? 'sin verificar' : 'número inválido',
      resultado_contacto: 'pendiente',
      score: String(qualification.score),
      clasificacion: qualification.clasificacion,
      razon_breve: qualification.razon_breve,
      oportunidad_principal: qualification.oportunidad_principal,
      que_venderle: qualification.que_venderle,
      mensaje_personalizado: mensaje,
      notas_contacto: ''
    };
    finalLeads.push(enriched);
  }

  // CSV 1 (Excel format)
  const xlsxHeaders = ['#','Prospecto','Categoría','Rating','Reseñas','Teléfono','Posible WhatsApp','Link con mensaje','Estado WhatsApp','Resultado contacto','Prioridad','Score','Clasificación','Razón breve','Oportunidad principal','Qué venderle','Mensaje personalizado','Website','Dirección','Google Maps URL','Notas'];
  const xlsxRows = ['Prospectos de Podología - Presencia Digital ON,,,,,,,,,,,,,,,,,,,,', xlsxHeaders.join(',')];
  finalLeads.forEach((lead, i) => {
    const row = [
      i+1,
      escapeCsvValue(lead.nombre),
      escapeCsvValue(lead.categoria),
      escapeCsvValue(lead.rating),
      escapeCsvValue(lead.reseñas),
      escapeCsvValue(lead.telefono),
      escapeCsvValue(lead.posible_whatsapp_url),
      escapeCsvValue(lead.posible_whatsapp_url_with_message),
      escapeCsvValue(lead.estado_whatsapp),
      escapeCsvValue(lead.resultado_contacto),
      escapeCsvValue(lead.prioridad_contacto),
      escapeCsvValue(lead.score),
      escapeCsvValue(lead.clasificacion),
      escapeCsvValue(lead.razon_breve),
      escapeCsvValue(lead.oportunidad_principal),
      escapeCsvValue(lead.que_venderle),
      escapeCsvValue(lead.mensaje_personalizado),
      escapeCsvValue(lead.website),
      escapeCsvValue(lead.direccion),
      escapeCsvValue(lead.mapsUrl),
      escapeCsvValue(lead.notas_contacto)
    ];
    xlsxRows.push(row.join(','));
  });
  fs.writeFileSync(xlsxOut, '\ufeff' + xlsxRows.join('\n'), 'utf-8');
  console.log('Guardado Excel CSV:', xlsxOut);

  // CSV 2 (manual)
  const manualHeaders = [...headers, 'posible_whatsapp_url','posible_whatsapp_url_with_message','estado_whatsapp','resultado_contacto','prioridad_contacto','mensaje_personalizado','notas_contacto'];
  const manualRows = [manualHeaders.join(',')];
  finalLeads.forEach(l => {
    const row = manualHeaders.map(h => escapeCsvValue(l[h]));
    manualRows.push(row.join(','));
  });
  fs.writeFileSync(manualOut, '\ufeff' + manualRows.join('\n'), 'utf-8');
  console.log('Guardado manual CSV:', manualOut);
}

main();
