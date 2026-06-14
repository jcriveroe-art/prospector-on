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
      // Manejar comillas dobles escapadas ""
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
  const csvPath = path.join(process.cwd(), 'leads.csv');
  
  console.log('📖 === INICIANDO EXPORTACIÓN PARA CHATGPT ===');
  console.log(`📂 Buscando archivo: ${csvPath}`);
  
  if (!fs.existsSync(csvPath)) {
    console.error('❌ Error: No se encontró el archivo "leads.csv" en la raíz del proyecto.');
    console.error('👉 Por favor, ejecuta primero "npm start" para recolectar los prospectos de Google Maps.');
    process.exit(1);
  }

  // Leer contenido y remover UTF-8 BOM si está presente
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const cleanContent = csvContent.replace(/^\ufeff/, '');
  const lines = cleanContent.split(/\r?\n/).filter(line => line.trim() !== '');

  if (lines.length <= 1) {
    console.warn('⚠️ El archivo "leads.csv" está vacío o solo contiene la fila de cabeceras.');
    process.exit(0);
  }

  const headers = parseCsvLine(lines[0]);
  const leads = [];

  // Extraer máximo 20 prospectos (líneas 1 a 20 del CSV)
  const maxToProcess = Math.min(lines.length, 21); // 21 porque la línea 0 es la cabecera
  for (let i = 1; i < maxToProcess; i++) {
    const values = parseCsvLine(lines[i]);
    const lead = {};
    headers.forEach((header, index) => {
      lead[header] = values[index] || 'sin datos';
    });
    leads.push(lead);
  }

  console.log(`📋 Procesando ${leads.length} prospectos desde el CSV...`);

  // Construir el archivo Markdown con el prompt del usuario
  let mdContent = `Actúa como estratega comercial de Presencia Digital. Evalúa estos prospectos de negocios locales para venderles servicios de presencia digital, branding visual, reels, mejora de Google Maps, WhatsApp Business y posible Control ON.

Criterio principal:
Buscamos negocios que parecen tener buen producto o servicio, operación real y oportunidad clara de mejora visual/digital.

Califica cada prospecto con:
- Score 0-100
- Clasificación: CALIENTE, TIBIO o FRÍO
- Razón breve
- Oportunidad principal
- Qué venderle: Negocio ON, Control ON o ambos
- Mensaje inicial sugerido por WhatsApp

Prioriza esta idea:
'Tu negocio ya es bueno, pero no se ve tan profesional como debería.'

Devuelve una tabla clara.

---

### PROSPECTOS A EVALUAR:

`;

  leads.forEach((lead, index) => {
    // Limpiar caracteres no estándar (como los íconos de pin de mapa que Google inserta como \ue0c8 o )
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

  const outputPath = path.join(process.cwd(), 'prospectos_para_chatgpt.md');
  fs.writeFileSync(outputPath, mdContent, 'utf8');

  console.log(`\n🎉 ¡Archivo de exportación creado con éxito!`);
  console.log(`📂 Guardado en: ${outputPath}`);
  console.log(`✨ Listo para abrir, copiar y pegar en ChatGPT.`);
}

main();
