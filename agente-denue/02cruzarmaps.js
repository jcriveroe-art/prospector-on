import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import dotenv from 'dotenv';

dotenv.config();

// --- CONFIGURACIÓN DE RUTAS Y CONSTANTES ---
const OUTPUT_DIR = path.join(process.cwd(), 'agente-denue', 'output');
const MAPS_RAW_DIR = path.join(OUTPUT_DIR, 'maps-raw');
const MATCH_THRESHOLD = 0.55; // Umbral de similitud configurable

// Asegurar directorios
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
if (!fs.existsSync(MAPS_RAW_DIR)) fs.mkdirSync(MAPS_RAW_DIR, { recursive: true });

const TARGET_MUNICIPIOS = (process.env.DENUE_MUNICIPIOS || '')
  .split(',')
  .map(m => m.trim())
  .filter(Boolean);

if (TARGET_MUNICIPIOS.length === 0) {
  console.error('❌ DENUE_MUNICIPIOS no está definido en .env');
  process.exit(1);
}

// --- FUNCIONES DE NORMALIZACIÓN Y BÚSQUEDA ---

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index !== -1 && index + 1 < process.argv.length) {
    return process.argv[index + 1];
  }
  const prefixArg = process.argv.find(arg => arg.startsWith(name + '='));
  if (prefixArg) {
    return prefixArg.split('=')[1];
  }
  return null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function slugify(text) {
  return normalizeMunicipio(text).replace(/\s+/g, '_');
}

function normalizeMunicipio(m) {
  if (!m) return '';
  return m
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim();
}

function normalizeName(str) {
  if (!str) return '';
  // Reemplazar caracteres corruptos de codificación (ej. ) por 'n' o ' '
  let cleanStr = str.replace(/\uFFFD/g, 'n');
  let norm = cleanStr
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Quita acentos
    .replace(/[^a-z0-9\s]/g, ' ')    // Convierte caracteres especiales en espacios
    .replace(/\s+/g, ' ')            // Colapsa múltiples espacios
    .trim();

  // Eliminar palabras genéricas del giro y términos geográficos (evita falsos positivos por coincidencia de municipio/estado)
  const stopWords = [
    // Municipios / Geográficos
    'san francisco de los romo',
    'pabellon de arteaga',
    'rincon de romos',
    'jesus maria',
    'aguascalientes',
    'calvillo',
    'ags',
    // Artículos y Preposiciones
    'de',
    'la',
    'el',
    'los',
    'las',
    'del',
    'con',
    'para',
    'por',
    'un',
    'una',
    'unos',
    'unas',
    'y',
    'en',
    'al',
    // Descriptores de Giro y Comida muy genéricos
    'restaurant',
    'restaurante',
    'taqueria',
    'cenaduria',
    'cocina economica',
    'comida',
    'tacos',
    'birria',
    'loncheria',
    'pizzas',
    'pizzeria',
    'cafeteria',
    'cafe',
    'antojitos',
    'gorditas',
    'comedor',
    'sa de cv',
    's a de c v',
    'servicio',
    'italiano',
    'italiana',
    'italian',
    'italiannis',
    'italianni',
    'mexicano',
    'mexicana',
    'china',
    'chinos',
    'japones',
    'sushi',
    'pizza',
    'mariscos',
    'carnes',
    'barbacoa',
    'hamburguesas',
    'alitas',
    'cocina',
    'villasuncion',
    'altaria',
    'galerias',
    'punto 45',
    'alameda',
    'san marcos',
    'plaza',
    'centro',
    'norte',
    'sur',
    'oriente',
    'poniente',
    'birrieria',
    'croqueria',
    'rosticeria',
    'antojeria',
    'jardines',
    'prado',
    'bosques',
    'lomas',
    'villas'
  ];

  for (const word of stopWords) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    norm = norm.replace(regex, ' ');
  }

  return norm.replace(/\s+/g, ' ').trim();
}

function getBigrams(str) {
  const result = new Set();
  for (let i = 0; i < str.length - 1; i++) {
    result.add(str.slice(i, i + 2));
  }
  return result;
}

function nameSimilarity(a, b) {
  const normA = normalizeName(a);
  const normB = normalizeName(b);
  if (!normA || !normB) return 0;
  if (normA === normB) return 1.0;

  const ba = getBigrams(normA);
  const bb = getBigrams(normB);
  if (ba.size === 0 || bb.size === 0) return 0;

  let intersection = 0;
  for (const bi of ba) {
    if (bb.has(bi)) intersection++;
  }
  return (2 * intersection) / (ba.size + bb.size);
}

function scoreBusinessMatch(denueName, mapsName, denuePhone = '', mapsPhone = '') {
  const cleanD = String(denuePhone || '').replace(/[^0-9]/g, '');
  const cleanM = String(mapsPhone || '').replace(/[^0-9]/g, '');
  
  // Endurecer para evitar que cadenas/franquicias se cuelen si DENUE no es cadena
  const lowerMaps = String(mapsName || '').toLowerCase();
  const lowerDenue = String(denueName || '').toLowerCase();
  const chainTerms = [
    'domino', 'mcdonald', 'oxxo', 'subway', 'kfc', 'burger king', 'pizza hut', 
    'little caesars', 'starbucks', 'vips', 'sanborns', 'walmart', 'soriana', 
    'chedraui', 'costco', 'sams', 'seven eleven', '7-eleven', 'cinnabon', 
    'wing stop', 'wingstop', 'pollo loco', 'pollo feliz', 'alsea', 'italiannis', 'italianni'
  ];
  const isMapsChain = chainTerms.some(term => lowerMaps.includes(term));
  const isDenueChain = chainTerms.some(term => lowerDenue.includes(term));
  if (isMapsChain && !isDenueChain) {
    return 0; // Rechazar match si Maps es franquicia/cadena y DENUE no
  }

  // Comparar solo los últimos 10 dígitos para evitar inconsistencias de formato (+52, etc.)
  const cleanD10 = cleanD.slice(-10);
  const cleanM10 = cleanM.slice(-10);

  // Si coinciden por teléfono de 10 dígitos, es match automático
  if (cleanD10 && cleanM10 && cleanD10.length === 10 && cleanM10.length === 10 && cleanD10 === cleanM10) {
    return 1.0;
  }

  const nameSim = nameSimilarity(denueName, mapsName);
  
  // Penalizar score si ambos registros tienen teléfonos válidos pero diferentes
  let finalScore = nameSim;
  if (cleanD10 && cleanM10 && cleanD10.length === 10 && cleanM10.length === 10 && cleanD10 !== cleanM10) {
    finalScore -= 0.30;
  }

  return Math.max(0, Math.round(finalScore * 100) / 100);
}

function cleanValue(val) {
  if (!val || val.trim() === '' || val.trim().toLowerCase() === 'null' || val.trim().toLowerCase() === 'undefined') {
    return 'sin datos';
  }
  return val.trim().replace(/[\uE000-\uF8FF]/g, '').trim();
}

async function safeGetText(page, selector, fallback = 'sin datos') {
  try {
    const el = page.locator(selector).first();
    if (await el.isVisible()) {
      const text = await el.textContent();
      return text ? cleanValue(text) : fallback;
    }
  } catch (e) {}
  return fallback;
}

async function scrollFeed(page, maxResults = 80) {
  console.log('   Desplazando feed de Google Maps para recolectar fichas...');
  const feedSelector = 'div[role="feed"]';

  try {
    await page.waitForSelector(feedSelector, { timeout: 12000 });
  } catch (e) {
    console.log('   [Aviso] No se encontró feed. Puede ser un resultado único.');
  }

  let previousCount = 0;
  let noChangeCount = 0;

  while (true) {
    const links = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[href*="/maps/place/"]'));
      return anchors.map(a => a.href);
    });
    const uniqueLinks = [...new Set(links)];

    if (uniqueLinks.length >= maxResults) {
      console.log(`   [Scroll] Límite alcanzado: ${uniqueLinks.length} enlaces.`);
      return uniqueLinks.slice(0, maxResults);
    }

    if (uniqueLinks.length === previousCount) {
      noChangeCount++;
      if (noChangeCount >= 4) {
        console.log(`   [Scroll] Fin de feed. Encontrados: ${uniqueLinks.length} enlaces.`);
        return uniqueLinks;
      }
    } else {
      noChangeCount = 0;
      previousCount = uniqueLinks.length;
    }

    await page.evaluate((sel) => {
      const feed = document.querySelector(sel);
      if (feed) feed.scrollBy(0, 1000);
      else window.scrollBy(0, 1000);
    }, feedSelector);

    await page.waitForTimeout(1500);
  }
}

async function extractBusinessDetails(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForSelector('h1', { timeout: 12000 });
    await page.waitForTimeout(1000);

    const name = await safeGetText(page, 'h1', 'Sin Nombre');

    // Dirección
    let address = 'sin datos';
    try {
      const addrEl = page.locator('button[data-item-id="address"]').first();
      if (await addrEl.isVisible()) {
        address = await addrEl.textContent();
      } else {
        const addrAria = page.locator('button[aria-label*="Dirección"], button[aria-label*="Address"]').first();
        if (await addrAria.isVisible()) address = await addrAria.textContent();
      }
    } catch (e) {}

    // Teléfono
    let phone = 'sin datos';
    try {
      const phoneEl = page.locator('button[data-item-id^="phone:"]').first();
      if (await phoneEl.isVisible()) {
        const rawPhone = await phoneEl.getAttribute('data-item-id');
        if (rawPhone) phone = rawPhone.replace('phone:tel:', '').trim();
      } else {
        const phoneAria = page.locator('button[aria-label*="Teléfono"], button[aria-label*="Phone"]').first();
        if (await phoneAria.isVisible()) phone = await phoneAria.textContent();
      }
    } catch (e) {}

    // Sitio Web
    let website = 'sin datos';
    try {
      const webEl = page.locator('a[data-item-id="authority"]').first();
      if (await webEl.isVisible()) {
        const href = await webEl.getAttribute('href');
        if (href) website = href.trim();
      } else {
        const webAria = page.locator('a[aria-label*="Sitio web"], a[aria-label*="Website"]').first();
        if (await webAria.isVisible()) {
          const href = await webAria.getAttribute('href');
          if (href) website = href.trim();
        }
      }
    } catch (e) {}

    // Categoría
    let category = 'sin datos';
    const catSelectors = [
      'button[jsaction*="pane.rating.category"]',
      'button[jsaction*="category"]',
      'button[class*="fontBodyMedium"]'
    ];
    for (const selector of catSelectors) {
      const text = await safeGetText(page, selector);
      const lowered = text.toLowerCase();
      if (text !== 'sin datos' && isNaN(Number(text)) && !lowered.includes('reseña') && !lowered.includes('review')) {
        category = text;
        break;
      }
    }

    // Rating e reviews
    let rating = 'sin datos';
    let reviewsCount = 'sin datos';
    try {
      const ratingEl = page.locator('div.F7nice').first();
      if (await ratingEl.isVisible()) {
        const text = await ratingEl.textContent();
        if (text) {
          if (text.includes('(')) {
            const parts = text.split('(');
            rating = parts[0].trim();
            reviewsCount = parts[1].replace(')', '').trim();
          } else {
            const match = text.match(/^([0-5](?:[.,][0-9])?)(.*)$/);
            if (match) {
              rating = match[1].replace(',', '.');
              reviewsCount = match[2].trim() || 'sin datos';
            }
          }
        }
      }
    } catch (e) {}

    return {
      maps_nombre: cleanValue(name),
      maps_direccion: cleanValue(address),
      maps_rating: cleanValue(rating),
      maps_reviews_count: cleanValue(reviewsCount),
      maps_telefono: cleanValue(phone),
      maps_categoria: cleanValue(category),
      maps_website: cleanValue(website),
      maps_url: url
    };
  } catch (err) {
    throw new Error(`Fallo al extraer detalles de la ficha: ${err.message}`);
  }
}

function calcularFugas(denue, maps) {
  const fugas = [];

  // 1. Sin reseñas o muy pocas (menos de 10)
  const reviews = maps.maps_reviews_count;
  if (!reviews || reviews === 'sin datos') {
    fugas.push('sin_reseñas');
  } else {
    const numReviews = parseInt(String(reviews).replace(/[^0-9]/g, ''), 10);
    if (isNaN(numReviews) || numReviews < 10) {
      fugas.push('pocas_reseñas');
    }
  }

  // 2. Sin website
  const web = maps.maps_website;
  if (!web || web === 'sin datos') {
    fugas.push('sin_website');
  }

  // 3. Rating bajo (< 4.0)
  const ratingStr = maps.maps_rating;
  if (ratingStr && ratingStr !== 'sin datos') {
    const ratingNum = parseFloat(ratingStr);
    if (!isNaN(ratingNum) && ratingNum < 4.0) {
      fugas.push('rating_bajo');
    }
  } else {
    fugas.push('sin_rating');
  }

  // 4. Teléfono diferente al DENUE
  const denuePhone = denue.telefono ? String(denue.telefono).replace(/[^0-9]/g, '') : '';
  const mapsPhone = maps.maps_telefono ? String(maps.maps_telefono).replace(/[^0-9]/g, '') : '';
  if (denuePhone && mapsPhone && denuePhone.length >= 10 && mapsPhone.length >= 10 && denuePhone !== mapsPhone) {
    fugas.push('telefono_diferente');
  }

  return fugas;
}

// --- PROGRAMA PRINCIPAL ---

async function main() {
  console.log('=== PASO 2: CRUCE DENUE VS GOOGLE MAPS POR LOTES ===');

  const inputPath = path.join(OUTPUT_DIR, 'denuelimpio.json');
  const seenOutputPhones = new Set();

  if (!fs.existsSync(inputPath)) {
    console.error(`❌ Error: No se encontró el archivo oficial en: ${inputPath}`);
    console.error('Por favor, ejecuta primero: node agente-denue/01leerdenue.js');
    process.exit(1);
  }

  console.log(`📖 Leyendo DENUE desde: ${inputPath}`);
  const denueRecords = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

  // Normalizar los municipios permitidos para filtrar
  const targetNormalized = TARGET_MUNICIPIOS.map(normalizeMunicipio);

  // Filtrar DENUE para municipios objetivo
  const filteredDenue = denueRecords.filter(r => {
    const normM = normalizeMunicipio(r.municipio || '');
    return targetNormalized.includes(normM);
  });

  console.log(`📊 Universo filtrado por 6 municipios objetivo: ${filteredDenue.length} de ${denueRecords.length}`);

  // Configurar Límites y Flags
  const limiteMunicipios = getArg('--limiteMunicipios') ? parseInt(getArg('--limiteMunicipios'), 10) : null;
  const limiteDenue = getArg('--limiteDenue') ? parseInt(getArg('--limiteDenue'), 10) : null;
  const visible = hasFlag('--visible');
  const giro = getArg('--giro') || process.env.DENUE_GIRO || 'restaurante';
  const estado = process.env.DENUE_ESTADO || 'Aguascalientes';

  let targetRecords = [...filteredDenue];
  if (limiteDenue !== null) {
    targetRecords = targetRecords.slice(0, limiteDenue);
    console.log(`⚠️ Límite de DENUE activo: se procesarán máximo los primeros ${limiteDenue} registros.`);
  }

  // Agrupar por municipio
  const groupedDenue = {};
  for (const r of targetRecords) {
    const normM = normalizeMunicipio(r.municipio || '');
    const matchedTarget = TARGET_MUNICIPIOS.find(target => normalizeMunicipio(target) === normM) || r.municipio;
    if (!groupedDenue[matchedTarget]) {
      groupedDenue[matchedTarget] = [];
    }
    groupedDenue[matchedTarget].push(r);
  }

  let municipiosToProcess = Object.keys(groupedDenue);
  if (limiteMunicipios !== null) {
    municipiosToProcess = municipiosToProcess.slice(0, limiteMunicipios);
    console.log(`⚠️ Límite de municipios activo: se procesarán máximo los primeros ${limiteMunicipios} municipios.`);
  }

  console.log(`\nMunicipios a procesar: ${municipiosToProcess.join(', ')}`);

  // Estructuras de resultados
  const finalEnMaps = [];
  const finalNoEnMaps = [];
  const conteoPorMunicipio = {};
  let totalMapsRawCount = 0;

  // Iniciar Playwright solo si hace falta buscar algún municipio sin caché
  let browser = null;

  try {
    for (const mun of municipiosToProcess) {
      console.log(`\n--------------------------------------------------`);
      console.log(`Procesando Municipio: ${mun}`);
      console.log(`--------------------------------------------------`);

      const slug = slugify(mun);
      const mapsRawPath = path.join(MAPS_RAW_DIR, `${slug}.json`);

      let mapsRaw = [];
      if (fs.existsSync(mapsRawPath)) {
        try {
          mapsRaw = JSON.parse(fs.readFileSync(mapsRawPath, 'utf8'));
          console.log(`[Caché] Cargados ${mapsRaw.length} registros desde maps-raw/${slug}.json`);
        } catch (e) {
          console.warn(`[Caché] Error al leer caché. Se re-escribirá.`);
        }
      }

      // Si no hay datos en caché, realizar búsqueda en Google Maps
      if (mapsRaw.length === 0) {
        console.log(`[Scraper] Caché vacía o inexistente. Iniciando búsqueda en Google Maps...`);
        if (!browser) {
          console.log(`Iniciando navegador (visible: ${visible})...`);
          browser = await chromium.launch({ headless: !visible });
        }

        const context = await browser.newContext({
          locale: 'es-MX',
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        });
        const page = await context.newPage();
        await page.route('**/*.{png,jpg,jpeg,gif,svg,css,woff,woff2}', route => route.abort());

        const query = `${giro} en ${mun}, ${estado}`;
        try {
          console.log(`🔍 Buscando: "${query}"`);
          await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForSelector('div[role="feed"], h1, div.fontHeadlineSmall', { timeout: 15000 }).catch(() => null);

          // Capturar múltiples resultados
          const urls = await scrollFeed(page, 80);
          console.log(`   Se encontraron ${urls.length} enlaces.`);

          let count = 0;
          for (const url of urls) {
            count++;
            console.log(`   [${count}/${urls.length}] Ficha: ${url}`);
            try {
              const details = await extractBusinessDetails(page, url);
              details.maps_municipio_detectado = mun;
              mapsRaw.push(details);

              // Guardar incrementalmente
              fs.writeFileSync(mapsRawPath, JSON.stringify(mapsRaw, null, 2), 'utf8');

              await page.waitForTimeout(2000 + Math.random() * 2000);
            } catch (err) {
              console.warn(`   ⚠️ Error al extraer: ${err.message}`);
              await page.waitForTimeout(4000);
            }
          }
        } catch (e) {
          console.error(`❌ Error al procesar municipio ${mun} en Maps: ${e.message}`);
        } finally {
          await page.close();
          await context.close();
        }
      }

      totalMapsRawCount += mapsRaw.length;

      // Deduplicar registros de Maps
      const seenUrls = new Set();
      const uniqueMaps = [];
      for (const item of mapsRaw) {
        const url = item.maps_url || '';
        if (url && seenUrls.has(url)) continue;
        if (url) seenUrls.add(url);
        uniqueMaps.push(item);
      }

      console.log(`[Cruce] Cruzando ${groupedDenue[mun].length} negocios DENUE con ${uniqueMaps.length} de Maps únicos...`);

      let munEnMaps = 0;
      let munNoEnMaps = 0;

      // Cruzar registros DENUE de este municipio
      for (const denue of groupedDenue[mun]) {
        // Evitar duplicados por teléfono
        const cleanPhoneNum = String(denue.telefono || '').replace(/[^0-9]/g, '');
        if (cleanPhoneNum) {
          if (seenOutputPhones.has(cleanPhoneNum)) {
            continue;
          }
          seenOutputPhones.add(cleanPhoneNum);
        }

        let bestMatch = null;
        let bestScore = -1;

        for (const maps of uniqueMaps) {
          const score = scoreBusinessMatch(
            denue.nombre,
            maps.maps_nombre,
            denue.telefono,
            maps.maps_telefono
          );

          if (score > bestScore) {
            bestScore = score;
            bestMatch = maps;
          }
        }

        if (bestScore >= MATCH_THRESHOLD && bestMatch) {
          munEnMaps++;
          const fugas = calcularFugas(denue, bestMatch);

          finalEnMaps.push({
            nombre: denue.nombre,
            telefono: denue.telefono,
            municipio: denue.municipio,
            giro: denue.giro,
            score: denue.score, // Score del DENUE
            mapsnombre: bestMatch.maps_nombre,
            mapsdireccion: bestMatch.maps_direccion,
            mapsrating: bestMatch.maps_rating,
            mapsreviews: bestMatch.maps_reviews_count,
            mapswebsite: bestMatch.maps_website,
            mapsphone: bestMatch.maps_telefono,
            fugas: fugas,
            matchScore: bestScore,
            fuente: 'maps'
          });
        } else {
          munNoEnMaps++;
          finalNoEnMaps.push({
            nombre: denue.nombre,
            telefono: denue.telefono,
            municipio: denue.municipio,
            giro: denue.giro,
            score: denue.score,
            motivo: 'no_match_in_maps',
            fuente: 'nomaps'
          });
        }
      }

      conteoPorMunicipio[mun] = {
        totalDenue: groupedDenue[mun].length,
        enMaps: munEnMaps,
        noEnMaps: munNoEnMaps
      };

      console.log(`   Resultados ${mun}: En Maps = ${munEnMaps} | No en Maps = ${munNoEnMaps}`);
    }
  } finally {
    if (browser) {
      console.log('Cerrando navegador...');
      await browser.close();
    }
  }

  // Escribir outputs finales
  const enMapsPath = path.join(OUTPUT_DIR, 'enmaps.json');
  const noEnMapsPath = path.join(OUTPUT_DIR, 'noenmaps.json');
  const statsPath = path.join(OUTPUT_DIR, 'cruce-stats.json');

  fs.writeFileSync(enMapsPath, JSON.stringify(finalEnMaps, null, 2), 'utf8');
  fs.writeFileSync(noEnMapsPath, JSON.stringify(finalNoEnMaps, null, 2), 'utf8');

  const stats = {
    totalDenueEntrada: targetRecords.length,
    totalMunicipiosProcesados: municipiosToProcess.length,
    totalMapsRaw: totalMapsRawCount,
    totalEnMaps: finalEnMaps.length,
    totalNoEnMaps: finalNoEnMaps.length,
    conteoPorMunicipio,
    timestamp: new Date().toISOString()
  };

  fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2), 'utf8');

  console.log('\n==================================================');
  console.log('🎉 CRUCE FINALIZADO CON ÉXITO');
  console.log('==================================================');
  console.log(`Total DENUE Procesados:         ${stats.totalDenueEntrada}`);
  console.log(`Municipios Procesados:          ${stats.totalMunicipiosProcesados}`);
  console.log(`Negocios Encontrados en Maps:   ${stats.totalEnMaps}`);
  console.log(`Negocios No Encontrados:        ${stats.totalNoEnMaps}`);
  console.log(`Archivos creados:\n  - ${enMapsPath}\n  - ${noEnMapsPath}\n  - ${statsPath}`);
  console.log('==================================================\n');
}

main().catch(err => {
  console.error('❌ Error crítico en 02cruzarmaps.js:', err);
  process.exit(1);
});
