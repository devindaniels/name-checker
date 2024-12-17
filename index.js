import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fs from "fs/promises";
import Tesseract from "tesseract.js";
import { createCanvas, loadImage } from "canvas";

puppeteer.use(StealthPlugin());

function log(message, type = "info") {
  const timestamp = new Date().toISOString();
  const colors = {
    info: "\x1b[36m",
    warn: "\x1b[33m",
    error: "\x1b[31m",
    debug: "\x1b[35m",
    reset: "\x1b[0m",
  };

  const colorStart = colors[type] || colors.info;
  console.log(`${colorStart}[${timestamp}] ${message}${colors.reset}`);
}

async function saveBufferToFile(buffer, filename) {
  try {
    await fs.writeFile(filename, buffer);
    log(`Saved image to ${filename}`, "debug");
  } catch (error) {
    log(`Error saving file ${filename}: ${error}`, "error");
  }
}

async function solveCaptcha(buffer) {
  log("Solving CAPTCHA...", "info");

  try {
    // Save original CAPTCHA image
    await saveBufferToFile(buffer, "original_captcha.png");

    const img = await loadImage(buffer);
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext("2d");

    // Draw original image
    ctx.drawImage(img, 0, 0);

    // Enhance contrast
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
      const newVal = avg > 128 ? 255 : 0;
      data[i] = data[i + 1] = data[i + 2] = newVal;
    }

    ctx.putImageData(imageData, 0, 0);

    // Tesseract recognition
    const {
      data: { text },
    } = await Tesseract.recognize(canvas.toDataURL(), "eng", {
      tessedit_char_whitelist: "0123456789+ ",
      tessedit_pageseg_mode: "7",
    });

    log(`Raw Tesseract output: ${text}`, "debug");

    // Parse numbers and calculate sum
    const numbers = text
      .trim()
      .split("+")
      .map((num) => parseInt(num.trim(), 10));

    if (numbers.length !== 2 || numbers.some(isNaN)) {
      throw new Error(`Failed to parse numbers from: ${text}`);
    }

    const sum = numbers[0] + numbers[1];
    log(`CAPTCHA Math: ${numbers[0]} + ${numbers[1]} = ${sum}`, "info");

    return sum.toString();
  } catch (error) {
    log(`CAPTCHA solving error: ${error}`, "error");
    throw error;
  }
}

async function searchCompany(searchTerm, options = {}) {
  const {
    headless = false,
    userAgents = [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.93 Safari/537.36",
    ],
  } = options;

  log(`Initiating search for: ${searchTerm}`, "info");

  const browser = await puppeteer.launch({
    headless,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-web-security",
      "--disable-features=IsolateOrigins,site-per-process",
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars",
      "--window-size=1920,1080",
    ],
    defaultViewport: null,
  });

  const page = await browser.newPage();

  try {
    // Stealth and anti-detection setup
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(navigator, "plugins", {
        get: () => [{ name: "Chrome PDF Plugin" }, { name: "Chrome PDF Viewer" }],
      });
    });

    // Random user agent
    const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
    await page.setUserAgent(randomUserAgent);

    // Navigate to search page
    await page.goto(
      "https://www.mca.gov.in/content/mca/global/en/mca/fo-llp-services/company-llp-name-search.html",
      { waitUntil: "networkidle2", timeout: 45000 }
    );

    // Wait for search input and type search term
    log(`Entering search term: ${searchTerm}`, "info");
    await page.waitForSelector("#masterdata-search-box");
    await page.type("#masterdata-search-box", searchTerm);

    // Get cookies for debugging
    const cookies = await page.cookies();
    log(`Got cookies: ${JSON.stringify(cookies)}`, "debug");

    // Click search
    log("Clicking search...", "info");
    await page.click("#searchicon");

    // Wait for CAPTCHA modal
    log("Waiting for CAPTCHA modal...", "info");
    await page.waitForSelector("#captchaModal", {
      visible: true,
      timeout: 10000,
    });

    // Get CAPTCHA solution
    const captchaElement = await page.$("#captchaCanvas");
    const captchaImage = await captchaElement.screenshot();
    const solution = await solveCaptcha(captchaImage);
    log(`CAPTCHA solution: ${solution}`, "info");

    // Enter solution in modal
    await page.waitForSelector("#customCaptchaInput");
    await page.focus("#customCaptchaInput");
    await page.type("#customCaptchaInput", solution);
    await page.keyboard.press("Enter");

    // Wait for results table
    await page.waitForSelector(".table.two-masterdata.table-borderless", {
      visible: true,
      timeout: 15000,
    });

    // Extract results
    const results = await page.evaluate(() => {
      const table = document.querySelector(".table.two-masterdata.table-borderless");
      if (!table) return [];

      const rows = table.querySelectorAll("tbody tr");
      return Array.from(rows).map((row) => {
        const cells = row.querySelectorAll("td");
        return {
          companyName: cells[1]?.textContent.trim(),
          cinNumber: cells[0]?.textContent.trim(),
        };
      });
    });

    return results;
  } catch (error) {
    log(`Search Error: ${error}`, "error");

    // Save screenshot for debugging
    await page.screenshot({ path: "error_screenshot.png", fullPage: true });

    throw error;
  } finally {
    await browser.close();
  }
}

async function main() {
  try {
    const searchTerm = "Commenda";
    const results = await searchCompany(searchTerm, {
      headless: false, // Set to true in production
    });

    if (results && results.length > 0) {
      log("Search Results:", "info");
      results.forEach((row, index) => {
        log(`Result ${index + 1}: ${JSON.stringify(row)}`, "info");
      });
    } else {
      log("No results found", "warn");
    }
  } catch (error) {
    log(`Main Execution Error: ${error}`, "error");
  }
}

main();
