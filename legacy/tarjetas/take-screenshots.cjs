const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 414, height: 896 },
    deviceScaleFactor: 2
  });
  
  const basePath = 'http://127.0.0.1:8000';
  const outPath = 'D:/presencia digital/tarjetas on/tarjetas-on/tarjetas-on/assets/mockups';
  
  const demos = [
    { url: `${basePath}/beauty-premium/index.html`, out: 'beauty-premium-preview.jpg' },
    { url: `${basePath}/barber-premium/index.html`, out: 'barber-premium-preview.jpg' },
    { url: `${basePath}/taller-premium/index.html`, out: 'taller-premium-preview.jpg' }
  ];
  
  for (const demo of demos) {
    console.log(`Taking screenshot of ${demo.url}`);
    await page.goto(demo.url, { waitUntil: 'networkidle' });
    
    // Wait an extra second for images to load
    await page.waitForTimeout(2000);
    
    await page.screenshot({
      path: path.join(outPath, demo.out),
      type: 'jpeg',
      quality: 90
    });
    console.log(`Saved ${demo.out}`);
  }
  
  await browser.close();
})();
