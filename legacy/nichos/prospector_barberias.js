import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import dotenv from 'dotenv';

// Cargar variables de entorno (por si acaso, aunque no usamos OpenAI/Gemini)
dotenv.config();

// Función de limpieza de datos estándar
function cleanValue(val) {
  if (!val || val.trim() === '' || val.trim().toLowerCase() === 'null' || val.trim().toLowerCase() === 'undefined') {
    return 'sin datos';
  }
  return val.trim();
}

// Función segura para obtener texto con locator
async function safeGetText(page, selector, fallback = 'sin datos') {
  try {
    const el = page.locator(selector).first();
    if (await el.isVisible()) {
      const text = await el.textContent();
      return text ? cleanValue(text) : fallback;
    }
  } catch (e) {
    // Silenciar errores menores de selección
  }
  return fallback;
}

/**
 * Función para desplazar la barra lateral de búsqueda y cargar hasta el número de prospectos requeridos
 */
async function scrollFeed(page, maxResults = 50) {
  console.log('\n🔄 Desplazando resultados en Google Maps...');
  const feedSelector = 'div[role="feed"]';
  
  try {
    await page.waitForSelector(feedSelector, { timeout: 15000 });
  } catch (e) {
    console.warn('⚠️ Nota: No se detectó el contenedor role="feed". Intentando extraer enlaces visibles.');
  }

  let previousCount = 0;
  let noChangeCount = 0;
  
  while (true) {
    // Obtener enlaces a lugares individuales de Google Maps (/maps/place/...)
    const links = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[href*="/maps/place/"]'));
      return anchors.map(a => a.href);
    });
    
    // Filtrar duplicados
    const uniqueLinks = [...new Set(links)];
    console.log(`   👉 Enlaces de negocios encontrados hasta ahora: ${uniqueLinks.length} / ${maxResults}`);
    
    if (uniqueLinks.length >= maxResults) {
      console.log(`   ✅ ¡Objetivo alcanzado! Se encontraron ${uniqueLinks.length} prospectos.`);
      return uniqueLinks.slice(0, maxResults);
    }
    
    if (uniqueLinks.length === previousCount) {
      noChangeCount++;
      // Si después de varios intentos no carga más datos, detenemos el scroll
      if (noChangeCount >= 5) {
        console.log('   🏁 Se llegó al final de los resultados disponibles o límite del scroll.');
        return uniqueLinks;
      }
    } else {
      noChangeCount = 0;
      previousCount = uniqueLinks.length;
    }
    
    // Scroll hacia abajo en el contenedor de resultados
    await page.evaluate((sel) => {
      const feed = document.querySelector(sel);
      if (feed) {
        feed.scrollBy(0, 1000);
      } else {
        window.scrollBy(0, 1000);
      }
    }, feedSelector);
    
    // Esperar un momento a que carguen más resultados
    await page.waitForTimeout(1500);
  }
}

/**
 * Extrae los detalles de la página de un negocio específico
 */
async function extractBusinessDetails(page, url) {
  console.log(`\n🔍 Extrayendo detalles desde URL: ${url}`);
  
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    // Esperar a que cargue el nombre (h1)
    await page.waitForSelector('h1', { timeout: 15000 });
    await page.waitForTimeout(1000); // Pausa para carga asíncrona de datos secundarios
    
    const nombre = await safeGetText(page, 'h1');
    
    // Extraer Categoría
    let categoria = 'sin datos';
    const catSelectors = [
      'button[jsaction*="pane.rating.category"]',
      'button[jsaction*="category"]',
      'button[class*="fontBodyMedium"]'
    ];
    for (const sel of catSelectors) {
      const text = await safeGetText(page, sel);
      if (text && text !== 'sin datos' && isNaN(Number(text)) && !text.includes('reseña') && !text.includes('review')) {
        categoria = text;
        break;
      }
    }

    // Extraer Rating y Reseñas
    let rating = 'sin datos';
    let reseñas = 'sin datos';
    try {
      const ratingEl = page.locator('div.F7nice').first();
      if (await ratingEl.isVisible()) {
        const text = await ratingEl.textContent();
        if (text) {
          if (text.includes('(')) {
            const parts = text.split('(');
            rating = parts[0].trim();
            reseñas = parts[1].replace(')', '').trim();
          } else {
            const match = text.match(/^([0-5](?:\.[0-9])?)(.*)$/);
            if (match) {
              rating = match[1];
              reseñas = match[2].trim() || 'sin datos';
            }
          }
        }
      }
      
      // Fallback para rating usando aria-label de estrellas
      if (rating === 'sin datos') {
        const starEl = page.locator('span[role="img"][aria-label*="estrellas"], span[role="img"][aria-label*="stars"]').first();
        if (await starEl.isVisible()) {
          const label = await starEl.getAttribute('aria-label');
          if (label) {
            const match = label.match(/([0-5](?:[.,][0-9])?)/);
            if (match) rating = match[1];
          }
        }
      }
    } catch (e) {
      // Ignorar fallos de rating
    }

    // Extraer Dirección y limpiar íconos como el pin map ( o \ue0c8)
    let direccion = 'sin datos';
    try {
      const addrEl = page.locator('button[data-item-id="address"]').first();
      if (await addrEl.isVisible()) {
        direccion = (await addrEl.textContent() || '').trim();
      } else {
        const addrElAria = page.locator('button[aria-label*="Dirección"], button[aria-label*="Address"]').first();
        if (await addrElAria.isVisible()) {
          direccion = (await addrElAria.textContent() || '').trim();
        }
      }
    } catch (e) {}
    direccion = direccion.replace(/[\uE000-\uF8FF]/g, '').trim(); // Limpieza robusta de íconos Unicode de Maps

    // Extraer Teléfono
    let telefono = 'sin datos';
    try {
      const phoneEl = page.locator('button[data-item-id^="phone:"]').first();
      if (await phoneEl.isVisible()) {
        const rawPhone = await phoneEl.getAttribute('data-item-id');
        if (rawPhone) {
          telefono = rawPhone.replace('phone:tel:', '').trim();
        }
      } else {
        const phoneElAria = page.locator('button[aria-label*="Teléfono"], button[aria-label*="Phone"]').first();
        if (await phoneElAria.isVisible()) {
          telefono = (await phoneElAria.textContent() || '').trim();
        }
      }
    } catch (e) {}

    // Extraer Website
    let website = 'sin datos';
    try {
      const webEl = page.locator('a[data-item-id="authority"]').first();
      if (await webEl.isVisible()) {
        website = (await webEl.getAttribute('href') || '').trim();
      } else {
        const webElAria = page.locator('a[aria-label*="Sitio web"], a[aria-label*="Website"]').first();
        if (await webElAria.isVisible()) {
          website = (await webElAria.getAttribute('href') || '').trim();
        }
      }
    } catch (e) {}

    // Limpieza final de valores
    const result = {
      nombre: cleanValue(nombre),
      categoria: cleanValue(categoria),
      rating: cleanValue(rating),
      reseñas: cleanValue(reseñas),
      telefono: cleanValue(telefono),
      website: cleanValue(website),
      direccion: cleanValue(direccion),
      mapsUrl: url
    };

    console.log(`   🏷️  Nombre: ${result.nombre}`);
    console.log(`   📂 Categoría: ${result.categoria}`);
    console.log(`   ⭐️ Rating: ${result.rating} (${result.reseñas} reseñas)`);
    console.log(`   📞 Teléfono: ${result.telefono}`);
    console.log(`   🌐 Website: ${result.website}`);

    return result;

  } catch (error) {
    console.error(`❌ Error extrayendo datos de la URL: ${url}`, error);
    return {
      nombre: 'sin datos',
      categoria: 'sin datos',
      rating: 'sin datos',
      reseñas: 'sin datos',
      telefono: 'sin datos',
      website: 'sin datos',
      direccion: 'sin datos',
      mapsUrl: url
    };
  }
}

// Función auxiliar para escapar valores en el CSV
function escapeCsvValue(val) {
  if (val === null || val === undefined) return 'sin datos';
  let str = String(val).trim();
  if (str === '') return 'sin datos';
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    str = '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * Guarda los leads finales en un archivo CSV compatible con Excel en español
 */
function saveLeadsToCsv(leads, filename = 'leads_barberias_satelite_naucalpan.csv') {
  const headers = [
    'nombre', 'categoria', 'rating', 'reseñas', 'telefono', 'website', 
    'direccion', 'mapsUrl'
  ];

  const rows = [headers.join(',')];
  for (const lead of leads) {
    const row = [
      escapeCsvValue(lead.nombre),
      escapeCsvValue(lead.categoria),
      escapeCsvValue(lead.rating),
      escapeCsvValue(lead.reseñas),
      escapeCsvValue(lead.telefono),
      escapeCsvValue(lead.website),
      escapeCsvValue(lead.direccion),
      escapeCsvValue(lead.mapsUrl)
    ];
    rows.push(row.join(','));
  }

  // Escribir archivo con UTF-8 BOM (\ufeff)
  fs.writeFileSync(filename, '\ufeff' + rows.join('\n'), 'utf-8');
  console.log(`\n💾 ¡Resultados guardados exitosamente en "${filename}"!`);
}

/**
 * Función Principal
 */
async function main() {
  const query = 'barberías en Satélite Naucalpan';
  const maxLeads = 50;
  const isHeadless = process.env.HEADLESS !== 'false';
  
  console.log('🚀 === PROSPECTOR-ON BARBERÍAS INICIADO (OFFLINE) ===');
  console.log(`📍 Búsqueda: "${query}"`);
  console.log(`📊 Límite de negocios: ${maxLeads}`);
  console.log(`🖥️  Modo invisible (headless): ${isHeadless ? 'Sí' : 'No'}`);
  
  const browser = await chromium.launch({
    headless: isHeadless,
    args: ['--disable-blink-features=AutomationControlled']
  });
  
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  
  const page = await context.newPage();
  
  try {
    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
    console.log(`🌐 Navegando a: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
    
    // Obtener los enlaces de negocios
    const leadUrls = await scrollFeed(page, maxLeads);
    
    if (leadUrls.length === 0) {
      console.log('❌ No se encontraron negocios. Finalizando.');
      await browser.close();
      return;
    }
    
    console.log(`\n📋 Se procederá a procesar ${leadUrls.length} negocios...`);
    const finalLeads = [];
    
    for (let i = 0; i < leadUrls.length; i++) {
      console.log(`\n-----------------------------------------`);
      console.log(`💼 [${i + 1}/${leadUrls.length}] Procesando negocio`);
      
      const rawDetails = await extractBusinessDetails(page, leadUrls[i]);
      
      if (rawDetails.nombre && rawDetails.nombre !== 'sin datos') {
        finalLeads.push(rawDetails);
      } else {
        console.log('⚠️ Omitiendo negocio por falta de datos básicos.');
      }
      
      await page.waitForTimeout(1000);
    }
    
    // Guardar los resultados calificados en el CSV
    saveLeadsToCsv(finalLeads, 'leads_barberias_satelite_naucalpan.csv');
    
  } catch (error) {
    console.error('❌ Error crítico en el flujo principal:', error);
  } finally {
    console.log('\n🔒 Cerrando navegador...');
    await browser.close();
    console.log('🏁 === PROCESO TERMINADO ===');
  }
}

// Ejecutar proceso
main();
