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

function main() {
  const csvPath = path.join(process.cwd(), 'leads_barberias_satelite_naucalpan.csv');
  
  console.log('📖 === INICIANDO EXPORTACIÓN DE BARBERÍAS PARA CHATGPT ===');
  console.log(`📂 Buscando archivo: ${csvPath}`);
  
  if (!fs.existsSync(csvPath)) {
    console.error('❌ Error: No se encontró el archivo "leads_barberias_satelite_naucalpan.csv" en la raíz del proyecto.');
    console.error('👉 Por favor, ejecuta primero "npm run barberias" para recolectar las barberías de Google Maps.');
    process.exit(1);
  }

  // Leer contenido y remover UTF-8 BOM si está presente
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const cleanContent = csvContent.replace(/^\ufeff/, '');
  const lines = cleanContent.split(/\r?\n/).filter(line => line.trim() !== '');

  if (lines.length <= 1) {
    console.warn('⚠️ El archivo está vacío o solo contiene la fila de cabeceras.');
    process.exit(0);
  }

  const headers = parseCsvLine(lines[0]);
  const leads = [];

  // Extraer máximo 50 prospectos (líneas 1 a 50 del CSV)
  const maxToProcess = Math.min(lines.length, 51); // 51 porque la línea 0 es la cabecera
  for (let i = 1; i < maxToProcess; i++) {
    const values = parseCsvLine(lines[i]);
    const lead = {};
    headers.forEach((header, index) => {
      lead[header] = values[index] || 'sin datos';
    });
    leads.push(lead);
  }

  console.log(`📋 Procesando ${leads.length} prospectos desde el CSV...`);

  // Construir el archivo Markdown con el prompt especializado de barberías
  let mdContent = `Actúa como estratega comercial de Presencia Digital. Evalúa estos prospectos de barberías locales para venderles servicios de presencia digital, branding visual, reels de alta calidad para redes sociales, optimización de ficha de Google Maps, automatización de WhatsApp Business y posible software de gestión (Control ON).
  
Criterio principal:
Buscamos barberías que ya estén operando, tengan reputación y muestren un potencial estético e imagen visual fuerte que no esté debidamente aprovechada en redes y su sitio web. La estética visual del corte, la barbería y su diseño importan muchísimo en este nicho.

Califica cada prospecto con:
- Score 0-100
- Clasificación: CALIENTE, TIBIO o FRÍO
- Razón breve
- Oportunidad principal (branding, fotografía, citas, website, reseñas)
- Qué venderle: Negocio ON, Control ON o ambos
- Mensaje inicial sugerido por WhatsApp adaptado a barberías

Prioriza esta idea central:
'Tu barbería ya tiene excelente servicio y talento, pero tu presencia digital e imagen visual antes de agendar no refleja lo profesional que eres.'

Devuelve una tabla clara consolidada de los prospectos evaluados.

---

### PROSPECTOS DE BARBERÍAS A EVALUAR:

`;

  leads.forEach((lead, index) => {
    let direccion = lead.direccion || 'sin datos';
    direccion = direccion.replace(/[\uE000-\uF8FF]/g, '').trim();

    mdContent += `### ${index + 1}. ${lead.nombre || 'sin datos'}\n`;
    mdContent += `- **Categoría:** ${lead.categoria || 'sin datos'}\n`;
    mdContent += `- **Rating:** ${lead.rating || 'sin datos'}\n`;
    mdContent += `- **Reseñas:** ${lead.reseñas || 'sin datos'}\n`;
    mdContent += `- **Teléfono:** ${lead.telefono || 'sin datos'}\n`;
    mdContent += `- **Website:** ${lead.website || 'sin datos'}\n`;
    mdContent += `- **Dirección:** ${direccion}\n`;
    mdContent += `- **Google Maps URL:** ${lead.mapsUrl || 'sin datos'}\n\n`;
  });

  const outputPath = path.join(process.cwd(), 'prospectos_barberias_para_chatgpt.md');
  fs.writeFileSync(outputPath, mdContent, 'utf8');

  console.log(`\n🎉 ¡Archivo de exportación de barberías creado con éxito!`);
  console.log(`📂 Guardado en: ${outputPath}`);
  console.log(`✨ Listo para abrir, copiar y pegar en ChatGPT.`);
}

main();
