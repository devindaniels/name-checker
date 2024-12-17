import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fetch from "node-fetch";
import Tesseract from "tesseract.js";
import { createCanvas, loadImage } from "canvas";
import fs from "fs/promises";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Add stealth plugin
puppeteer.use(StealthPlugin());

// Endpoints
const BASE_URL = "https://www.mca.gov.in";
const GENERATE_CAPTCHA_ENDPOINT = `${BASE_URL}/bin/mca/generateCaptchaWithHMAC`;
const VALIDATE_CAPTCHA_ENDPOINT = `${BASE_URL}/bin/mca/HmacCaptchaValidationServlet`;
const SEARCH_ENDPOINT = `${BASE_URL}/bin/mca/mds/commonSearch`;

// Function to save buffer to file
async function saveBufferToFile(buffer, filename) {
  try {
    await fs.writeFile(filename, buffer);
    console.log(`Saved image to ${filename}`);
  } catch (error) {
    console.error(`Error saving file ${filename}:`, error);
  }
}

// Function to save canvas to file
async function saveCanvasToFile(canvas, filename) {
  try {
    const buffer = canvas.toBuffer("image/png");
    await fs.writeFile(filename, buffer);
    console.log(`Saved processed image to ${filename}`);
  } catch (error) {
    console.error(`Error saving processed file ${filename}:`, error);
  }
}

// Enhanced CAPTCHA solving function
async function solveCaptcha(buffer) {
  console.log("Starting CAPTCHA solving process...");

  try {
    // Save original CAPTCHA image
    await saveBufferToFile(buffer, "original_captcha.png");
    console.log("Saved original CAPTCHA image");

    const img = await loadImage(buffer);
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext("2d");

    // Draw original image
    ctx.drawImage(img, 0, 0);
    await saveCanvasToFile(canvas, "step1_basic_draw.png");
    console.log("Saved initial processed image");

    // Enhance contrast
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
      const newVal = avg > 128 ? 255 : 0;
      data[i] = data[i + 1] = data[i + 2] = newVal;
    }

    ctx.putImageData(imageData, 0, 0);
    await saveCanvasToFile(canvas, "step2_processed.png");
    console.log("Saved contrast-enhanced image");

    // Tesseract recognition
    console.log("Starting Tesseract OCR...");
    const {
      data: { text },
    } = await Tesseract.recognize(canvas.toBuffer("image/png"), "eng", {
      tessedit_char_whitelist: "0123456789+ ",
      tessedit_pageseg_mode: "7",
    });

    console.log("Raw Tesseract output:", text);

    // Parse numbers and calculate sum
    const cleanText = text.replace(/[^0-9+]/g, "");
    console.log("Cleaned text:", cleanText);

    const numbers = cleanText.split("+").map((num) => parseInt(num.trim(), 10));
    console.log("Parsed numbers:", numbers);

    if (numbers.length !== 2 || numbers.some(isNaN)) {
      throw new Error(`Failed to parse numbers from: ${text}`);
    }

    const sum = numbers[0] + numbers[1];
    console.log(`CAPTCHA solution: ${numbers[0]} + ${numbers[1]} = ${sum}`);

    return sum.toString();
  } catch (error) {
    console.error("Error in CAPTCHA solving:", error);
    throw error;
  }
}

async function searchCompany(searchTerm) {
  console.log("Starting search...");
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--disable-infobars",
      "--window-position=0,0",
      "--ignore-certifcate-errors",
      "--ignore-certifcate-errors-spki-list",
    ],
    defaultViewport: {
      width: 1920,
      height: 1080,
    },
  });

  let page;
  try {
    page = await browser.newPage();

    // Set up network monitoring
    let isStabilized = false;
    let networkRequestCount = 0;

    page.on("request", (request) => {
      networkRequestCount++;
      // console.log("Request URL:", request.url());
    });

    page.on("requestfinished", () => {
      networkRequestCount--;
      if (networkRequestCount === 0) {
        isStabilized = true;
      }
    });

    page.on("requestfailed", () => {
      networkRequestCount--;
    });

    // Enhanced page configuration
    await page.setDefaultNavigationTimeout(60000);

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
    });

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    // Navigate to page
    console.log("Navigating to search page...");
    await page.goto(
      "https://www.mca.gov.in/content/mca/global/en/mca/fo-llp-services/company-llp-name-search.html",
      {
        waitUntil: ["networkidle0", "domcontentloaded"],
        timeout: 60000,
      }
    );

    // Wait for page to stabilize
    console.log("Waiting for page to stabilize...");
    await wait(5000);

    // Type search term
    console.log("Entering search term:", searchTerm);
    await page.waitForSelector("#masterdata-search-box", { visible: true });
    await page.type("#masterdata-search-box", searchTerm);

    // Verify search term was entered
    const enteredValue = await page.$eval("#masterdata-search-box", (el) => el.value);
    console.log("Entered value:", enteredValue);

    // Click search button
    console.log("Clicking search...");
    await Promise.all([
      page
        .waitForNavigation({ waitUntil: "networkidle0", timeout: 30000 })
        .catch((e) => console.log("Navigation timeout:", e)),
      page.click("#searchicon"),
    ]);

    // Wait for CAPTCHA modal
    console.log("Waiting for CAPTCHA modal...");
    await page.waitForSelector("#captchaModal", {
      visible: true,
      timeout: 10000,
    });

    // Wait for CAPTCHA to render
    await wait(2000);

    // Get CAPTCHA element
    const captchaElement = await page.$("#captchaCanvas");
    if (!captchaElement) {
      throw new Error("CAPTCHA element not found");
    }

    // Take screenshot of CAPTCHA
    const captchaBox = await captchaElement.boundingBox();
    const captchaImage = await page.screenshot({
      clip: {
        x: captchaBox.x,
        y: captchaBox.y,
        width: captchaBox.width,
        height: captchaBox.height,
      },
    });

    // Solve CAPTCHA
    console.log("Solving CAPTCHA...");
    const solution = await solveCaptcha(captchaImage);
    console.log("Got CAPTCHA solution:", solution);

    // Input solution
    console.log("Entering CAPTCHA solution...");
    await page.waitForSelector("#customCaptchaInput", { visible: true });
    await page.click("#customCaptchaInput");
    await page.$eval("#customCaptchaInput", (el) => (el.value = "")); // Clear existing value
    await page.type("#customCaptchaInput", solution, { delay: 100 });

    // Verify input
    const enteredCaptcha = await page.$eval("#customCaptchaInput", (el) => el.value);
    console.log("Verified CAPTCHA input:", enteredCaptcha);

    // Submit CAPTCHA
    console.log("Submitting CAPTCHA...");
    await page.keyboard.press("Enter");

    // Wait for results
    try {
      await page.waitForSelector(".table.two-masterdata.table-borderless", {
        visible: true,
        timeout: 15000,
      });

      // Extract results
      const results = await page.evaluate(() => {
        const table = document.querySelector(".table.two-masterdata.table-borderless");
        if (!table) return [];

        const rows = Array.from(table.querySelectorAll("tr"));
        return rows
          .map((row) => {
            const cells = Array.from(row.querySelectorAll("td"));
            if (cells.length === 0) return null;
            return cells.map((cell) => ({
              text: cell.textContent.trim(),
              html: cell.innerHTML,
            }));
          })
          .filter((row) => row !== null);
      });

      return results;
    } catch (e) {
      console.log("No results table found, checking for error message...");
      const errorMessage = await page
        .$eval("#errormessage", (el) => el.textContent)
        .catch(() => null);
      if (errorMessage) {
        console.log("Error message found:", errorMessage);
      }
      return [];
    }
  } catch (error) {
    console.error("Search error:", error);
    await page.screenshot({ path: "error-state.png", fullPage: true });
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

async function main() {
  try {
    const searchTerm = "Commenda";
    console.log("Starting search for:", searchTerm);

    const results = await searchCompany(searchTerm);

    if (results.length > 0) {
      console.log("Search Results:");
      results.forEach((row, index) => {
        console.log(`Result ${index + 1}:`, row);
      });
    } else {
      console.log("No results found");
    }
  } catch (error) {
    console.error("Error in main:", error);
  }
}

main();
