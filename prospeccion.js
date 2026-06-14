import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

function getArg(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

function slugify(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
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

function readCsv(filePath) {
  if (!fs.existsSync(filePath)) return [];

  const content = fs.readFileSync(filePath, 'utf8').replace(/^\ufeff/, '');
  const lines = content.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length <= 1) return [];

  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    return row;
  });
}

function cleanPhoneNumber(phone) {
  if (!phone || phone.toLowerCase() === 'sin datos') return '';
  return phone.replace(/[^0-9]/g, '');
}

function getOutputName(inputFile) {
  const parsed = path.parse(inputFile);
  return path.join(parsed.dir, `${parsed.name}_contacto_manual${parsed.ext || '.csv'}`);
}

function getXlsxOutputName(inputFile) {
  const parsed = path.parse(inputFile);
  return path.join(parsed.dir, `${parsed.name}_contacto_manual.xlsx`);
}

function runNodeScript(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: false
  });

  if (result.error) {
    console.error(`Error ejecutando ${script}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`${script} termino con codigo ${result.status}`);
    process.exit(result.status || 1);
  }
}

function summarize(rawFile, finalFile) {
  const rawRows = readCsv(rawFile);
  const finalRows = readCsv(finalFile);
  const finalXlsxFile = getXlsxOutputName(rawFile);
  const counts = {
    ALTA: 0,
    MEDIA: 0,
    BAJA: 0,
    'NO CONTACTAR': 0
  };

  for (const row of finalRows) {
    const classification = row['clasificación'] || row.clasificacion || '';
    if (Object.prototype.hasOwnProperty.call(counts, classification)) {
      counts[classification]++;
    }
  }

  const withPhone = rawRows.filter((row) => cleanPhoneNumber(row.telefono)).length;

  console.log('\n=== RESUMEN DE PROSPECCION ===');
  console.log(`Leads encontrados: ${rawRows.length}`);
  console.log(`Leads con teléfono: ${withPhone}`);
  console.log(`Prospectos ALTA: ${counts.ALTA}`);
  console.log(`Prospectos MEDIA: ${counts.MEDIA}`);
  console.log(`Prospectos BAJA: ${counts.BAJA}`);
  console.log(`NO CONTACTAR: ${counts['NO CONTACTAR']}`);
  console.log(`Archivo crudo generado: ${rawFile}`);
  console.log(`Archivo CSV generado: ${finalFile}`);
  console.log(`Archivo XLSX generado: ${finalXlsxFile}`);
  console.log('\nSiguiente paso recomendado: abre el XLSX final y contacta manualmente a los prospectos con prioridad ALTA y MEDIA.');
}

function main() {
  const nicho = getArg('nicho');
  const zona = getArg('zona');
  const limite = getArg('limite', '40');
  const salida = getArg('salida') || `leads_${slugify(nicho)}_${slugify(zona)}.csv`;

  if (!nicho || !zona) {
    console.error('Uso: npm run prospeccion -- --nicho "barberías" --zona "Satélite Naucalpan" --limite 30');
    process.exit(1);
  }

  const rawFile = path.resolve(process.cwd(), salida);
  const finalFile = getOutputName(rawFile);

  console.log('=== FLUJO COMPLETO PROSPECTOR ON ===');
  console.log(`Nicho: ${nicho}`);
  console.log(`Zona: ${zona}`);
  console.log(`Limite: ${limite}`);

  runNodeScript('prospector_general.js', [
    '--nicho',
    nicho,
    '--zona',
    zona,
    '--limite',
    limite,
    '--salida',
    salida
  ]);

  runNodeScript('export_contacto_general.js', [
    '--archivo',
    salida,
    '--nicho',
    nicho,
    '--zona',
    zona
  ]);

  summarize(rawFile, finalFile);
}

main();
