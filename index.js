const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs').promises;

if (process.argv.length < 3) {
  console.error('❌ Error: Missing required BASE_URL argument');
  console.log('Usage: node index.js "<target-url>"');
  console.log('Note: Wrap URLs with special characters in quotes!');
  console.log('Example: node index.js "https://www.zsgrosslingova.sk/gallery-1"');
  process.exit(1);
}

const isValidUrl = (url) => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

if (!isValidUrl(process.argv[2])) {
  console.error('❌ Invalid URL format detected');
  console.log('Common issues:');
  console.log('- Missing URL protocol (https://)');
  console.log('- Unescaped special characters (# or :) - use quotes!');
  console.log('- Malformed URL structure');
  process.exit(1);
}

// ======================
// CONSTANT CONFIGURATION
// ======================
const CONFIG = {
  DOWNLOAD_DIR: 'photos',
  BASE_URL: process.argv[2],
  TIMEOUTS: {
    DOWNLOAD: 30000,
    ELEMENT_VISIBLE: 15000,
    ANIMATION: 2000,
    POLL_INTERVAL: 500
  },
  SELECTORS: {
    IMAGE_LINK: '[title="Zobraziť obrázok v novom okne"]',
    NEXT_BUTTON: 'div ::-p-text(chevron_right)'
  },
  MESSAGES: {
    DOWNLOAD_START: (n) => `⬇️ Downloading photo ${n}...`,
    DOWNLOAD_SUCCESS: (name) => `✅ Downloaded: ${name}`,
    NAVIGATION_PROGRESS: (n) => `⏭ Moving to photo ${n}...`,
    COMPLETION: (count) => `🎉 Finished! Downloaded ${count} photos`
  }
};

// =================
// CORE FUNCTIONALITY
// =================
async function checkDirectoryEmpty(directory) {
  const files = await fs.readdir(directory);
  if (files.length > 0) {
    throw new Error(`Tartget directory must be empty. Directory ${directory} contains ${files.length} files - aborting`);
  }
}

async function waitForDownloadCompletion(directory) {
  const startTime = Date.now();
  let filesBefore = await fs.readdir(directory);

  while (Date.now() - startTime < CONFIG.TIMEOUTS.DOWNLOAD) {
    const filesAfter = await fs.readdir(directory);
    const newFiles = filesAfter.filter(f => !filesBefore.includes(f));
    const completedFile = newFiles.find(f => !f.endsWith('.crdownload'));

    if (completedFile) return completedFile;
    await new Promise(resolve => setTimeout(resolve, CONFIG.TIMEOUTS.POLL_INTERVAL));
  }
  throw new Error('Download timed out');
}

// ==============
// BROWSER SETUP
// ==============
async function configureDownloads(page, downloadPath) {
  const client = await page.createCDPSession();
  await client.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloadPath
  });
}

async function setupBrowser() {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  return { browser, page };
}

// ================
// GALLERY NAVIGATION
// ================
async function handleNextButton(page, photoCount) {
  try {
    console.log('Current URL:', page.url());
    const nextContainer = await page.waitForSelector(CONFIG.SELECTORS.NEXT_BUTTON, {
      visible: true,
      timeout: CONFIG.TIMEOUTS.ELEMENT_VISIBLE
    });

    if (!nextContainer) return false;

    console.log(CONFIG.MESSAGES.NAVIGATION_PROGRESS(photoCount));
    await nextContainer.click();

    await page.waitForSelector(CONFIG.SELECTORS.IMAGE_LINK, {
      visible: true,
      timeout: CONFIG.TIMEOUTS.ELEMENT_VISIBLE
    });

    await new Promise(resolve => setTimeout(resolve, CONFIG.TIMEOUTS.ANIMATION));
    return true;
  } catch (error) {
    console.log('End of album reached');
    return false;
  }
}

// ==============
// MAIN EXECUTION
// ==============
async function main() {
  const downloadPath = path.join(__dirname, CONFIG.DOWNLOAD_DIR);
  await fs.mkdir(downloadPath, { recursive: true });

  try {
    await checkDirectoryEmpty(downloadPath);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  const { browser, page } = await setupBrowser();
  await configureDownloads(page, downloadPath);

  try {
    await page.goto(CONFIG.BASE_URL);
    let photoCount = 0;

    while (true) {
      console.log(CONFIG.MESSAGES.DOWNLOAD_START(photoCount));
      await page.click(CONFIG.SELECTORS.IMAGE_LINK);
      const filename = await waitForDownloadCompletion(downloadPath);
      console.log(CONFIG.MESSAGES.DOWNLOAD_SUCCESS(filename));

      const hasNext = await handleNextButton(page, photoCount + 1);
      if (!hasNext) break;

      photoCount++;
    }

    console.log(CONFIG.MESSAGES.COMPLETION(photoCount + 1));
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error('❌ Critical error:', error);
  process.exit(1);
});