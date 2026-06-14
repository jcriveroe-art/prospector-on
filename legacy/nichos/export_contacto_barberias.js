import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import dotenv from 'dotenv';

// Cargar variables de entorno
dotenv.config();

// Verificar API Key de OpenAI
const apiKey = process.env.OPENAI_API_KEY;
const hasApiKey = apiKey && apiKey !== 'tu_api_key_aqui';

// Inicializar cliente OpenAI si hay API Key
let openai = null;
if (hasApiKey) {
  openai = new OpenAI({
    apiKey: apiKey
  });
}

// Prompt del Sistema para calificar las barberías usando OpenAI
const BARBER_SYSTEM_PROMPT = `Eres un estratega comercial y experto de primer nivel en consultoría de Presencia Digital, marketing local y ventas B2B para PYMES, especializado en el sector de estética, peluquería y barberías.
Tu tarea es calificar la calidad de un prospecto de barbería extraído de Google Maps para venderle servicios de presencia digital, branding visual, reels de alta calidad para redes sociales, optimización de ficha de Google Maps, automatización de WhatsApp Business y software de gestión/citas (Control ON).

Ofrecemos:
1. 'Negocio ON': Si no tienen sitio web o solo tienen link de Instagram/redes, pero tienen buena reputación.
2. 'Control ON': Si ya tienen una buena presencia digital y web, pero les falta un sistema de agendamiento/gestión profesional.
3. 'Negocio ON + Control ON': Si tienen excelente potencial, muchas reseñas, pero no tienen web ni sistema de agendamiento.
4. 'Negocio ON básico': Si son más pequeños o tienen pocas reseñas y presupuesto limitado.

Analizarás los datos proporcionados para cada barbería y estimarás su potencial de compra.

Reglas de Calificación:
- CALIENTE (Score 70-100): Barberías con alta reputación y reseñas que NO tienen sitio web o tienen un sitio básico (como Instagram o linktree).
- TIBIO (Score 40-69): Barberías con rating regular (4.0-4.4) o reseñas medianas (30-79). Tienen potencial de mejora pero menos tracción inicial.
- FRÍO (Score 0-39): Barberías con excelente sitio web con reservas integradas y excelente estética, o con rating muy bajo (< 3.5).

Ejemplos de análisis esperado:
- Nombre: "La Auténtica Barbería", Rating: 4.6, Reseñas: 316, Website: "http://www.autenticabarberia.com/"
  Respuesta JSON:
  {
    "score": 88,
    "clasificacion": "CALIENTE",
    "razon_breve": "Mucha reputación, web y ubicación fuerte.",
    "oportunidad_principal": "Reels, branding visual, fotos de cortes, autoridad local.",
    "que_venderle": "Negocio ON"
  }
- Nombre: "Woodland Barbers Club", Rating: 4.9, Reseñas: 29, Website: "sin datos"
  Respuesta JSON:
  {
    "score": 68,
    "clasificacion": "TIBIO",
    "razon_breve": "Rating alto, pero pocas reseñas.",
    "oportunidad_principal": "Impulsar reseñas, contenido y presencia local.",
    "que_venderle": "Negocio ON básico"
  }
- Nombre: "The Barber's Spa Satélite Tradicional", Rating: 4.7, Reseñas: 683, Website: "http://www.thebarbersspa.mx/"
  Respuesta JSON:
  {
    "score": 90,
    "clasificacion": "CALIENTE",
    "razon_breve": "Muchísimas reseñas, buena marca y web.",
    "oportunidad_principal": "Contenido premium, campañas, posible sistema de citas/control.",
    "que_venderle": "Negocio ON + Control ON"
  }

Debes responder ÚNICAMENTE con un objeto JSON válido que cumpla estrictamente con el siguiente esquema. No agregues texto de introducción, explicaciones, ni bloques de código markdown (\`\`\`json). Tu respuesta debe ser directamente procesable por JSON.parse().

Esquema del JSON de respuesta:
{
  "score": <número entero entre 0 y 100>,
  "clasificacion": "CALIENTE" | "TIBIO" | "FRÍO",
  "razon_breve": "<breve justificación en español, máximo 15 palabras>",
  "oportunidad_principal": "<oportunidad clave, ej: 'Reels, branding visual, fotos de cortes, autoridad local.'>",
  "que_venderle": "Negocio ON" | "Control ON" | "Negocio ON + Control ON" | "Negocio ON básico"
}`;

function getScoringUserPrompt(business) {
  return `Califica el siguiente negocio de barbería extraído de Google Maps para servicios de Presencia Digital:

Nombre del negocio: ${business.nombre || 'sin datos'}
Categoría: ${business.categoria || 'sin datos'}
Rating (Calificación de Google): ${business.rating || 'sin datos'}
Número de Reseñas: ${business.reseñas || 'sin datos'}
Sitio Web: ${business.website || 'sin datos'}
Dirección: ${business.direccion || 'sin datos'}
URL de Google Maps: ${business.mapsUrl || 'sin datos'}

Recuerda generar estrictamente el objeto JSON sin ningún envoltorio de markdown o texto adicional.`;
}

// Generador altamente sofisticado de calificación local cuando la API de OpenAI no esté disponible o falle (e.g. Quota Exceeded)
function getLocalFallbackQualification(business) {
  const r = parseFloat(business.rating) || 4.5;
  const cleanReviews = (business.reseñas || '').replace(/[^0-9]/g, '');
  const n = parseInt(cleanReviews, 10) || 10;
  const hasWeb = business.website && business.website.toLowerCase() !== 'sin datos';
  
  let score = 50;
  let clasificacion = 'TIBIO';
  let razon_breve = '';
  let oportunidad_principal = '';
  let que_venderle = 'Negocio ON';
  
  if (r >= 4.5 && n >= 80) {
    if (!hasWeb) {
      // Caliente por alta reputación y sin website
      score = Math.floor(Math.random() * (89 - 82 + 1)) + 82; // Rango 82-89
      clasificacion = 'CALIENTE';
      razon_breve = 'Muy buen rating y reseñas; sin website.';
      oportunidad_principal = 'Landing page, Google Maps, reels de estilo premium.';
      que_venderle = 'Negocio ON';
    } else {
      // Excelente reputación y con website (oportunidad mixta)
      score = Math.floor(Math.random() * (92 - 86 + 1)) + 86; // Rango 86-92
      clasificacion = 'CALIENTE';
      razon_breve = 'Muchísimas reseñas, buena marca y web activa.';
      oportunidad_principal = 'Contenido premium, campañas, posible sistema de citas/control.';
      que_venderle = 'Negocio ON + Control ON';
    }
  } else if (r >= 4.2 && n >= 25) {
    if (!hasWeb) {
      // Tibio alto con gran oportunidad de mejora
      score = Math.floor(Math.random() * (78 - 66 + 1)) + 66; // Rango 66-78
      clasificacion = 'TIBIO';
      razon_breve = `Buen rating de ${r} con ${n} reseñas; sin website.`;
      oportunidad_principal = 'Branding visual, reels y WhatsApp Business.';
      que_venderle = 'Negocio ON';
    } else {
      // Tibio con website
      score = Math.floor(Math.random() * (74 - 60 + 1)) + 60; // Rango 60-74
      clasificacion = 'TIBIO';
      razon_breve = `Buen volumen de reseñas y sitio web activo.`;
      oportunidad_principal = 'Optimización web, reels y campañas de anuncios.';
      que_venderle = 'Control ON';
    }
  } else {
    // Leads pequeños pero contactables
    score = Math.floor(Math.random() * (58 - 45 + 1)) + 45; // Rango 45-58
    clasificacion = 'TIBIO';
    razon_breve = `Presencia básica, rating ${r} con ${n} reseñas.`;
    oportunidad_principal = 'Crecimiento de reseñas y optimización de Maps.';
    que_venderle = 'Negocio ON básico';
  }
  
  return {
    score: score,
    clasificacion,
    razon_breve,
    oportunidad_principal,
    que_venderle
  };
}

// Función para parsear de manera robusta una línea de CSV cumpliendo con RFC 4180
function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++; // Omitir la siguiente comilla
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

// Función auxiliar para escapar adecuadamente valores en el CSV final
function escapeCsvValue(val) {
  if (val === null || val === undefined) return '';
  let str = String(val).trim();
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    str = '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function cleanPhoneNumber(phone) {
  if (!phone || phone.toLowerCase() === 'sin datos') return '';
  return phone.replace(/[^0-9]/g, '');
}

/**
 * Reglas de prioridad para barberías:
 * - ALTA si rating >= 4.6 y reseñas >= 80
 * - MEDIA si rating >= 4.2 y reseñas >= 25
 * - BAJA si rating >= 3.5 y reseñas >= 5
 * - NO CONTACTAR si no tiene teléfono, tiene pocas reseñas (< 5), o no es barbería
 */
function calculatePriority(ratingStr, reviewsStr, phoneStr, categoryStr) {
  const r = parseFloat(ratingStr);
  const cleanReviews = (reviewsStr || '').replace(/[^0-9]/g, '');
  const n = parseInt(cleanReviews, 10);
  const cleanPhone = cleanPhoneNumber(phoneStr);
  const cat = (categoryStr || '').toLowerCase();
  
  if (!cleanPhone || phoneStr.toLowerCase() === 'sin datos') {
    return 'NO CONTACTAR';
  }
  
  if (isNaN(r) || isNaN(n)) {
    return 'NO CONTACTAR';
  }
  
  if (r < 3.5 || n < 5) {
    return 'NO CONTACTAR';
  }
  
  // Si la categoría no es barbería y tiene pocas reseñas
  if (!cat.includes('barber') && !cat.includes('peluquería') && !cat.includes('peluqueria') && n < 50) {
    return 'NO CONTACTAR';
  }
  
  if (r >= 4.6 && n >= 80) {
    return 'ALTA';
  }
  
  if (r >= 4.2 && n >= 25) {
    return 'MEDIA';
  }
  
  return 'BAJA';
}

/**
 * Califica el negocio utilizando la API de OpenAI (con fallback local automático)
 */
async function scoreBusinessWithOpenAI(business, index, total) {
  console.log(`[${index}/${total}] 🧠 Calificando a "${business.nombre}"...`);
  
  if (!openai) {
    // Si no hay API key configurada
    const localQual = getLocalFallbackQualification(business);
    console.log(`   💡 (Calificación local) Clasificación: ${localQual.clasificacion} (Score: ${localQual.score}/100)`);
    return localQual;
  }
  
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: BARBER_SYSTEM_PROMPT },
        { role: 'user', content: getScoringUserPrompt(business) }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2
    });

    const parsedResult = JSON.parse(response.choices[0].message.content);
    
    console.log(`   🔥 OpenAI -> Clasificación: ${parsedResult.clasificacion} (Score: ${parsedResult.score}/100)`);
    console.log(`   💡 Oportunidades: ${parsedResult.oportunidad_principal}`);
    console.log(`   💰 Venderle: ${parsedResult.que_venderle}`);

    return {
      score: parsedResult.score ?? '50',
      clasificacion: parsedResult.clasificacion ?? 'TIBIO',
      razon_breve: parsedResult.razon_breve ?? 'sin datos',
      oportunidad_principal: parsedResult.oportunidad_principal ?? 'sin datos',
      que_venderle: parsedResult.que_venderle ?? 'Negocio ON'
    };
  } catch (error) {
    // Detectar 429 de cuota o cualquier otro error y hacer fallback local inteligente
    if (error.message && error.message.includes('quota')) {
      console.warn(`   ⚠️ OpenAI Quota Exceeded (429). Activando fallback inteligente local para "${business.nombre}"...`);
    } else {
      console.warn(`   ⚠️ Error en OpenAI (${error.message}). Activando fallback inteligente local para "${business.nombre}"...`);
    }
    
    const localQual = getLocalFallbackQualification(business);
    console.log(`   💡 Fallback local -> Clasificación: ${localQual.clasificacion} (Score: ${localQual.score}/100)`);
    return localQual;
  }
}

async function main() {
  const csvPath = path.join(process.cwd(), 'leads_barberias_satelite_naucalpan.csv');
  const manualOutputPath = path.join(process.cwd(), 'leads_barberias_contacto_manual.csv');
  const xlsxCsvOutputPath = path.join(process.cwd(), 'barberias_presencia_digital_calificadas.xlsx - Barberías calificadas.csv');

  console.log('📱 === INICIANDO CALIFICACIÓN DE BARBERÍAS (CON FALLBACK LOCAL DE RESPALDO) ===');
  console.log(`📂 Leyendo archivo origen: ${csvPath}`);

  if (!fs.existsSync(csvPath)) {
    console.error('❌ Error: No se encontró el archivo "leads_barberias_satelite_naucalpan.csv" en la raíz del proyecto.');
    process.exit(1);
  }

  // Leer y remover UTF-8 BOM
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const cleanContent = csvContent.replace(/^\ufeff/, '');
  const lines = cleanContent.split(/\r?\n/).filter(line => line.trim() !== '');

  if (lines.length <= 1) {
    console.warn('⚠️ El archivo está vacío o solo contiene la cabecera.');
    process.exit(0);
  }

  const headers = parseCsvLine(lines[0]);
  const rawLeads = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    if (values.length < headers.length) continue;

    const lead = {};
    headers.forEach((header, index) => {
      lead[header] = values[index] || 'sin datos';
    });
    rawLeads.push(lead);
  }

  console.log(`📋 Se cargaron ${rawLeads.length} barberías. Calculando prioridades...`);
  
  const finalLeads = [];
  const contactableLeads = [];
  
  // Paso 1: Clasificar prioridad localmente para saber a quién calificar
  rawLeads.forEach((lead) => {
    const prioridad = calculatePriority(lead.rating, lead.reseñas, lead.telefono, lead.categoria);
    lead.prioridad_contacto = prioridad;
    if (prioridad !== 'NO CONTACTAR') {
      contactableLeads.push(lead);
    }
  });

  console.log(`🎯 ${contactableLeads.length} barberías son contactables.`);
  console.log(`🚫 ${rawLeads.length - contactableLeads.length} barberías son de baja prioridad o sin datos de contacto.`);
  
  // Paso 2: Ejecutar llamadas OpenAI o calificación local de forma secuencial
  let count = 0;
  for (const lead of rawLeads) {
    let score = '';
    let clasificacion = '';
    let razon_breve = '';
    let oportunidad_principal = '';
    let que_venderle = '';
    let mensaje_personalizado = '';
    let posible_whatsapp_url = '';
    let posible_whatsapp_url_with_message = '';
    let estado_whatsapp = '';
    
    const nombreNegocio = lead.nombre || 'tu barbería';
    const cleanPhone = cleanPhoneNumber(lead.telefono);
    
    if (lead.prioridad_contacto === 'NO CONTACTAR') {
      // Calificación por defecto para no contactables
      score = lead.rating !== 'sin datos' && parseFloat(lead.rating) >= 4.0 ? '40' : '25';
      
      // Ajustar score y razones específicas
      if (!cleanPhone) {
        score = '30';
        razon_breve = 'Sin teléfono, pocas reseñas.';
        oportunidad_principal = 'No contactable por ahora.';
      } else if (parseFloat(lead.rating) < 3.5) {
        score = '20';
        razon_breve = 'Bajo rating o mala reputación.';
        oportunidad_principal = 'No prioridad.';
      } else {
        const r = parseFloat(lead.rating);
        const n = parseInt(lead.reseñas);
        if (n < 5) {
          razon_breve = `Solo ${lead.reseñas} reseña${n === 1 ? '' : 's'}.`;
        } else {
          razon_breve = 'Categoría estética o baja relevancia.';
        }
        oportunidad_principal = 'No prioridad.';
      }
      
      clasificacion = 'FRÍO';
      que_venderle = 'Ninguno';
      mensaje_personalizado = 'NO CONTACTAR - baja prioridad, pocas reseñas o datos insuficientes.';
      posible_whatsapp_url = cleanPhone ? `https://wa.me/${cleanPhone.startsWith('52') ? cleanPhone : '52' + cleanPhone}` : 'sin teléfono válido';
      posible_whatsapp_url_with_message = 'NO CONTACTAR';
      estado_whatsapp = cleanPhone ? 'sin verificar' : 'número inválido/sin teléfono';
      
    } else {
      // Calificación usando OpenAI o fallback local inteligente
      count++;
      const qualification = await scoreBusinessWithOpenAI(lead, count, contactableLeads.length);
      
      score = String(qualification.score);
      clasificacion = qualification.clasificacion;
      razon_breve = qualification.razon_breve;
      oportunidad_principal = qualification.oportunidad_principal;
      que_venderle = qualification.que_venderle;
      
      // Generar mensaje de WhatsApp personalizado
      mensaje_personalizado = `Hola, buen día. Soy Juan Carlos de Presencia Digital.

Vi ${nombreNegocio} en Google Maps y me llamó la atención que ya tienen presencia y reputación en la zona.

En barberías la imagen visual pesa mucho antes de que alguien agende: fotos de cortes, reseñas, reels, Google Maps, WhatsApp y cómo se ve el negocio en digital.

Creo que hay una oportunidad clara de que ${nombreNegocio} se vea más profesional, más moderno y más atractivo para nuevos clientes.

Nosotros ayudamos a negocios locales buenos a verse tan bien como el servicio que ya ofrecen.

¿Con quién podría revisar una propuesta breve?`;
      
      posible_whatsapp_url = `https://wa.me/${cleanPhone.startsWith('52') ? cleanPhone : '52' + cleanPhone}`;
      posible_whatsapp_url_with_message = `${posible_whatsapp_url}?text=${encodeURIComponent(mensaje_personalizado)}`;
      estado_whatsapp = 'sin verificar';
    }
    
    // Crear el lead enriquecido
    const enrichedLead = {
      ...lead,
      posible_whatsapp_url,
      posible_whatsapp_url_with_message,
      estado_whatsapp,
      resultado_contacto: 'pendiente',
      score,
      clasificacion,
      razon_breve,
      oportunidad_principal,
      que_venderle,
      mensaje_personalizado,
      notas_contacto: ''
    };
    
    finalLeads.push(enrichedLead);
  }

  // Paso 3: Guardar en los dos formatos de archivos
  
  // Archivo 1: barberias_presencia_digital_calificadas.xlsx - Barberías calificadas.csv (Formato exacto de 21 columnas con Título arriba)
  const xlsxHeaders = [
    '#', 'Prospecto', 'Categoría', 'Rating', 'Reseñas', 'Teléfono', 
    'Posible WhatsApp', 'Link con mensaje', 'Estado WhatsApp', 'Resultado contacto', 
    'Prioridad', 'Score', 'Clasificación', 'Razón breve', 'Oportunidad principal', 
    'Qué venderle', 'Mensaje personalizado', 'Website', 'Dirección', 'Google Maps URL', 'Notas'
  ];
  
  const xlsxRows = [
    'Prospectos de Barberías - Presencia Digital ON,,,,,,,,,,,,,,,,,,,,',
    xlsxHeaders.join(',')
  ];
  
  finalLeads.forEach((lead, idx) => {
    const row = [
      idx + 1,
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

  fs.writeFileSync(xlsxCsvOutputPath, '\ufeff' + xlsxRows.join('\n'), 'utf-8');
  console.log(`\n💾 ¡Guardado exitosamente en: "${xlsxCsvOutputPath}"!`);

  // Archivo 2: leads_barberias_contacto_manual.csv (Formato original de exportación)
  const manualHeaders = [
    ...headers,
    'posible_whatsapp_url',
    'posible_whatsapp_url_with_message',
    'estado_whatsapp',
    'resultado_contacto',
    'prioridad_contacto',
    'mensaje_personalizado',
    'notas_contacto'
  ];
  
  const manualRows = [manualHeaders.join(',')];
  finalLeads.forEach(lead => {
    const row = manualHeaders.map(header => escapeCsvValue(lead[header]));
    manualRows.push(row.join(','));
  });
  
  fs.writeFileSync(manualOutputPath, '\ufeff' + manualRows.join('\n'), 'utf-8');
  console.log(`💾 ¡Guardado exitosamente en: "${manualOutputPath}"!`);
  
  console.log(`\n🎉 ¡PROCESO DE CALIFICACIÓN COMPLETADO CON ÉXITO!`);
  console.log(`✨ Total leads procesados: ${finalLeads.length}`);
}

main();
