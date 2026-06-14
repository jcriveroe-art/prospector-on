import fs from 'fs';
import path from 'path';

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
 * 6. Reglas para posible_whatsapp_url y estado_whatsapp
 */
function getPosibleWhatsappUrlAndEstado(phone, prioridad) {
  const digits = cleanPhoneNumber(phone);
  
  if (!phone || phone.toLowerCase() === 'sin datos' || !digits) {
    return {
      posible_whatsapp_url: 'sin teléfono',
      estado_whatsapp: 'número inválido'
    };
  }
  
  if (prioridad === 'NO CONTACTAR') {
    return {
      posible_whatsapp_url: 'NO CONTACTAR',
      estado_whatsapp: 'sin verificar'
    };
  }

  if (digits.length <= 8) {
    return {
      posible_whatsapp_url: 'revisar manualmente',
      estado_whatsapp: 'número inválido'
    };
  }
  
  let cleanNum = digits;
  if (digits.startsWith('52')) {
    // Ya tiene 52 al inicio
  } else if (digits.length === 10) {
    cleanNum = '52' + digits;
  }
  
  return {
    posible_whatsapp_url: `https://wa.me/${cleanNum}`,
    estado_whatsapp: 'sin verificar'
  };
}

function calculatePriority(ratingStr, reviewsStr) {
  const r = parseFloat(ratingStr);
  const cleanReviews = (reviewsStr || '').replace(/[^0-9]/g, '');
  const n = parseInt(cleanReviews, 10);
  
  if (isNaN(r) || isNaN(n)) {
    return 'BAJA';
  }
  
  if (r < 3.5) {
    return 'NO CONTACTAR';
  }
  
  if (r < 4.0 || n < 10) {
    return 'BAJA';
  }
  
  if (r >= 4.5 && n >= 80) {
    return 'ALTA';
  }
  
  if (r >= 4.2 && n >= 50) {
    return 'MEDIA';
  }
  
  return 'MEDIA';
}

function getBusinessEnfoque(nombre, categoria) {
  const textToAnalyze = `${nombre} ${categoria}`.toLowerCase();
  
  if (textToAnalyze.includes('hospital') || textToAnalyze.includes('24 horas')) {
    return {
      type: 'hospital',
      enfoque: 'confianza, urgencias y atención inmediata'
    };
  }
  if (textToAnalyze.includes('clínica') || textToAnalyze.includes('clinica')) {
    return {
      type: 'clinica',
      enfoque: 'confianza médica, especialidad y agendamiento'
    };
  }
  if (textToAnalyze.includes('cremación') || textToAnalyze.includes('cremacion') || textToAnalyze.includes('pets in the sky')) {
    return {
      type: 'cremacion',
      enfoque: 'sensibilidad, confianza y acompañamiento emocional'
    };
  }
  if (textToAnalyze.includes('farmacia')) {
    return {
      type: 'farmacia',
      enfoque: 'catálogo, promociones, WhatsApp y Google Maps'
    };
  }
  if (textToAnalyze.includes('tienda') || textToAnalyze.includes('petshop')) {
    return {
      type: 'tienda',
      enfoque: 'catálogo, productos, WhatsApp y presencia local'
    };
  }
  if (textToAnalyze.includes('veterinario') || textToAnalyze.includes('veterinaria')) {
    return {
      type: 'veterinaria',
      enfoque: 'confianza, servicios, reseñas y citas por WhatsApp'
    };
  }
  
  return {
    type: 'otro',
    enfoque: 'presencia digital, confianza y conversión'
  };
}

function getFraseReputacion(ratingStr, reviewsStr) {
  const r = parseFloat(ratingStr);
  const cleanReviews = (reviewsStr || '').replace(/[^0-9]/g, '');
  const n = parseInt(cleanReviews, 10);
  
  if (isNaN(r) || isNaN(n)) {
    return 'Vi su negocio en Google Maps y noté que ya tienen operación y presencia en la zona.';
  }
  
  if (r < 3.5) {
    return 'sin contacto recomendado';
  }
  
  if (r >= 4.8 && n >= 80) {
    return `Vi que tienen una reputación muy fuerte en Google Maps, con ${ratingStr} estrellas y ${reviewsStr} reseñas.`;
  }
  
  if (r >= 4.5 && n >= 80) {
    return `Vi que tienen buena reputación en Google Maps, con ${ratingStr} estrellas y ${reviewsStr} reseñas.`;
  }
  
  if (r >= 4.5 && n < 80) {
    return `Vi que tienen muy buen rating en Google Maps, aunque todavía podrían aprovechar mejor esa confianza en su presencia digital.`;
  }
  
  if (r >= 4.0) {
    return `Vi su negocio en Google Maps y noté que ya tienen operación y presencia en la zona.`;
  }
  
  return `Vi su negocio en Google Maps y noté que ya tienen operación y presencia en la zona.`;
}

function getFraseWebsite(website) {
  if (!website || website === 'sin datos') {
    return 'También noté que no aparece un sitio web visible, y ahí hay una oportunidad para mejorar cómo los encuentran y cómo generan confianza antes del primer mensaje.';
  }
  return 'También vi que ya tienen sitio web, así que la oportunidad sería modernizar y alinear mejor Google Maps, redes y WhatsApp.';
}

function getRazonPersonalizacion(r, n, type, website, prioridad) {
  if (prioridad === 'NO CONTACTAR') {
    return 'Baja reputación o datos insuficientes';
  }
  
  const hasWeb = website && website !== 'sin datos';
  const parts = [];
  
  if (type === 'hospital') parts.push('Hospital/24h');
  else if (type === 'clinica') parts.push('Clínica');
  else if (type === 'cremacion') parts.push('Servicio emocional');
  else if (type === 'farmacia') parts.push('Farmacia');
  else if (type === 'tienda') parts.push('Tienda');
  else parts.push('Veterinaria');
  
  if (r >= 4.8 && n >= 80) parts.push('Alta reputación');
  else if (r >= 4.5 && n >= 80) parts.push('Reputación fuerte');
  else if (r >= 4.5) parts.push('Buen rating');
  else parts.push('Presencia básica');

  if (!hasWeb) parts.push('sin website');
  else parts.push('con website');
  
  return parts.join(' + ');
}

function main() {
  const csvPath = path.join(process.cwd(), 'leads.csv');
  const outputPath = path.join(process.cwd(), 'leads_contacto_manual.csv');

  console.log('📱 === INICIANDO EXPORTACIÓN REFINADA PARA CONTACTO MANUAL ===');
  console.log(`📂 Leyendo archivo origen: ${csvPath}`);

  if (!fs.existsSync(csvPath)) {
    console.error('❌ Error: No se encontró el archivo "leads.csv" en la raíz del proyecto.');
    process.exit(1);
  }

  // Leer y remover UTF-8 BOM
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const cleanContent = csvContent.replace(/^\ufeff/, '');
  const lines = cleanContent.split(/\r?\n/).filter(line => line.trim() !== '');

  if (lines.length <= 1) {
    console.warn('⚠️ El archivo "leads.csv" está vacío o solo contiene la cabecera.');
    process.exit(0);
  }

  const headers = parseCsvLine(lines[0]);
  const finalLeads = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    if (values.length < headers.length) continue;

    const lead = {};
    headers.forEach((header, index) => {
      lead[header] = values[index] || 'sin datos';
    });

    const nombreNegocio = lead.nombre || 'tu negocio';
    
    // Calcular prioridad
    const prioridad_contacto = calculatePriority(lead.rating, lead.reseñas);
    
    // Obtener variables de personalización
    const businessDetails = getBusinessEnfoque(lead.nombre, lead.categoria);
    const frase_reputacion = getFraseReputacion(lead.rating, lead.reseñas);
    const frase_website = getFraseWebsite(lead.website);
    
    // Construir mensaje de WhatsApp
    let mensaje_personalizado = '';
    if (prioridad_contacto === 'NO CONTACTAR') {
      mensaje_personalizado = 'NO CONTACTAR - baja reputación o datos insuficientes';
    } else {
      mensaje_personalizado = `Hola, buen día. Soy Juan Carlos de Presencia Digital.

${frase_reputacion}

Creo que hay una oportunidad clara de que ${nombreNegocio} comunique mejor ${businessDetails.enfoque} desde Google, redes y WhatsApp.

${frase_website}

Nosotros ayudamos a negocios locales buenos a verse más profesionales, modernos y confiables, para que su presencia digital esté al nivel de lo que ya ofrecen.

¿Con quién podría revisar una propuesta breve?`;
    }

    // 6. Obtener posible_whatsapp_url y estado_whatsapp
    const whatsappData = getPosibleWhatsappUrlAndEstado(lead.telefono, prioridad_contacto);
    const posible_whatsapp_url = whatsappData.posible_whatsapp_url;
    const estado_whatsapp = whatsappData.estado_whatsapp;

    // 7. Obtener posible_whatsapp_url_with_message
    let posible_whatsapp_url_with_message = '';
    
    if (prioridad_contacto === 'NO CONTACTAR') {
      posible_whatsapp_url_with_message = 'NO CONTACTAR';
    } else if (posible_whatsapp_url === 'sin teléfono') {
      posible_whatsapp_url_with_message = 'sin teléfono';
    } else if (posible_whatsapp_url === 'revisar manualmente') {
      posible_whatsapp_url_with_message = 'revisar manualmente';
    } else {
      const cleanNum = posible_whatsapp_url.replace('https://wa.me/', '');
      posible_whatsapp_url_with_message = `https://wa.me/${cleanNum}?text=${encodeURIComponent(mensaje_personalizado)}`;
    }

    // Nuevas columnas solicitadas de llenado manual
    const score_manual = '';
    const clasificacion = '';
    const resultado_contacto = 'pendiente';
    const notas_contacto = '';

    // Razón de personalización
    const r = parseFloat(lead.rating);
    const cleanReviews = (lead.reseñas || '').replace(/[^0-9]/g, '');
    const n = parseInt(cleanReviews, 10);
    const razon_personalizacion = getRazonPersonalizacion(r, n, businessDetails.type, lead.website, prioridad_contacto);

    // Integrar datos finales mapeados al estándar exacto solicitado
    const enrichedLead = {
      ...lead,
      score_manual,
      clasificacion,
      prioridad_contacto,
      posible_whatsapp_url,
      posible_whatsapp_url_with_message,
      estado_whatsapp,
      resultado_contacto,
      notas_contacto,
      mensaje_personalizado,
      razon_personalizacion
    };

    finalLeads.push(enrichedLead);
  }

  console.log(`📋 Procesando ${finalLeads.length} prospectos. Escribiendo leads_contacto_manual.csv...`);

  // Columnas exactas configuradas según tu especificación
  const outputHeaders = [
    ...headers,
    'score_manual',
    'clasificacion',
    'prioridad_contacto',
    'posible_whatsapp_url',
    'posible_whatsapp_url_with_message',
    'estado_whatsapp',
    'resultado_contacto',
    'notas_contacto',
    'mensaje_personalizado',
    'razon_personalizacion'
  ];

  const rows = [outputHeaders.join(',')];
  
  finalLeads.forEach(lead => {
    const row = outputHeaders.map(header => escapeCsvValue(lead[header]));
    rows.push(row.join(','));
  });

  // Escribir archivo final con UTF-8 BOM
  fs.writeFileSync(outputPath, '\ufeff' + rows.join('\n'), 'utf-8');

  console.log(`\n🎉 ¡Archivo generado con éxito!`);
  console.log(`📂 Guardado en: ${outputPath}`);
  console.log(`✨ Total leads procesados: ${finalLeads.length}`);
}

main();
