const { chromium } = require('playwright');
const robotsParser = require('robots-parser');
const { URL } = require('url');
const { pool } = require('../db/init');

let browserInstance = null;

/**
 * Normalize URL - preserve hash for SPAs, remove query params, trailing slash
 */
function normalizeUrl(url, preserveHash = false) {
  try {
    const u = new URL(url);
    // For SPAs, preserve hash routes (hash starting with #/)
    if (!preserveHash || !u.hash || !u.hash.startsWith('#/')) {
      u.hash = '';
    }
    u.search = '';
    return u.href.replace(/\/$/, '');
  } catch {
    return null;
  }
}

/**
 * Check if two URLs are from the same domain
 */
function sameDomain(a, b) {
  try {
    return new URL(a).hostname === new URL(b).hostname;
  } catch {
    return false;
  }
}

/**
 * Load robots.txt
 */
async function loadRobots(url) {
  try {
    const https = require('https');
    const http = require('http');
    const u = new URL(url);
    const robotsUrl = `${u.origin}/robots.txt`;
    
    return new Promise((resolve) => {
      const client = u.protocol === 'https:' ? https : http;
      const req = client.get(robotsUrl, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const robots = robotsParser(robotsUrl, data);
            console.log('🤖 robots.txt loaded');
            resolve(robots);
          } catch {
            resolve({ isAllowed: () => true });
          }
        });
      });
      req.on('error', () => {
        console.log('⚠️ robots.txt not found, crawling allowed');
        resolve({ isAllowed: () => true });
      });
      req.setTimeout(5000, () => {
        req.destroy();
        console.log('⚠️ robots.txt timeout, crawling allowed');
        resolve({ isAllowed: () => true });
      });
    });
  } catch {
    console.log('⚠️ robots.txt not found, crawling allowed');
    return { isAllowed: () => true };
  }
}

/**
 * Crawl a single page
 */
async function crawlPage(context, url) {
  const page = await context.newPage();

  // Block unnecessary resources for faster crawling
  await page.route('**/*', route => {
    const resourceType = route.request().resourceType();
    if (['image', 'font', 'media', 'stylesheet'].includes(resourceType)) {
      route.abort();
    } else {
      route.continue();
    }
  });

  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 15000
    });

    // Wait a bit for SPA content to load
    await page.waitForTimeout(2000);

    // Extract title with fallback
    let title = "Untitled";
    try {
      title = await page.evaluate(() => {
        const titleEl = document.querySelector("title");
        const h1El = document.querySelector("h1");
        const titleText = titleEl?.textContent?.trim() || "";
        const h1Text = h1El?.textContent?.trim() || "";
        return titleText || h1Text || "Untitled";
      });
    } catch (error) {
      try {
        title = await page.title() || "Untitled";
      } catch (e) {
        title = "Untitled";
      }
    }

    // Extract all links (including hash routes for SPAs)
    const links = await page.$$eval('a[href]', as =>
      as.map(a => {
        const href = a.getAttribute('href');
        if (!href) return null;
        try {
          // Resolve relative URLs
          const base = window.location.href;
          return new URL(href, base).href;
        } catch {
          // Handle hash-only links
          if (href.startsWith('#')) {
            return window.location.origin + window.location.pathname + href;
          }
          return href;
        }
      }).filter(Boolean)
    );

    return { title, links };
  } catch (error) {
    console.warn(`Error crawling ${url}:`, error.message);
    return { title: "Untitled", links: [] };
  } finally {
    await page.close();
  }
}

/**
 * Main crawl function - adapted from the provided Playwright crawler
 */
async function crawlWebsite({ jobId, domain, maxDepth = 3, maxPages = 500, onProgress }) {
  const baseUrl = domain.startsWith('http') ? domain : `https://${domain}`;
  const baseDomain = new URL(baseUrl).hostname;

  const visited = new Set();
  const queue = [{ url: baseUrl, depth: 0, parentUrl: null }];
  const pages = [];
  const CONCURRENCY = 6;

  // Load robots.txt
  // const robots = await loadRobots(baseUrl);

  // Launch browser
  const browser = await chromium.launch({ 
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ]
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  try {
    while (queue.length > 0 && visited.size < maxPages) {
      const batch = queue.splice(0, CONCURRENCY);

      await Promise.all(
        batch.map(async (item) => {
          // For hash routes, preserve hash; otherwise normalize
          const hasHashRoute = item.url.includes('#/');
          const url = normalizeUrl(item.url, hasHashRoute);
          
          // Skip if already visited, invalid, or exceeds depth
          if (!url || visited.has(url) || item.depth > maxDepth) {
            return;
          }

          // Check robots.txt
          // if (!robots.isAllowed(url, '*')) {
          //   console.log(`🚫 Blocked by robots.txt: ${url}`);
          //   return;
          // }

          visited.add(url);
          console.log(`✔ [${item.depth}] ${url}`);

          // Crawl the page
          const { title, links } = await crawlPage(context, url);

          // Clean up title
          let cleanedTitle = title;
          if (!cleanedTitle || cleanedTitle === 'ERROR: Error' || cleanedTitle === 'Error' || cleanedTitle === 'ERROR') {
            try {
              const urlObj = new URL(url);
              const hash = urlObj.hash?.substring(1);
              const pathParts = urlObj.pathname.split('/').filter(p => p);
              if (hash && hash.startsWith('/')) {
                cleanedTitle = hash.substring(1).split('/').pop()?.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) || 'Page';
              } else if (hash) {
                cleanedTitle = hash.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) || 'Page';
              } else {
                cleanedTitle = pathParts.length > 0 
                  ? pathParts[pathParts.length - 1].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
                  : 'Home';
              }
            } catch {
              cleanedTitle = 'Page';
            }
          }

          // Store page in database
          try {
            const pageResult = await pool.query(
              'INSERT INTO pages (job_id, url, depth, parent_url, title, status_code) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
              [jobId, url, item.depth, item.parentUrl, cleanedTitle, 200]
            );

            pages.push({
              id: pageResult.rows[0].id,
              url: url,
              depth: item.depth,
              parentUrl: item.parentUrl,
              title: cleanedTitle,
            });
          } catch (dbError) {
            console.error(`Error storing page ${url} in DB:`, dbError.message);
          }

          // Process links
          for (const link of links) {
            // Check if this is a hash route
            const isHashRoute = link.includes('#/');
            const normalizedLink = normalizeUrl(link, isHashRoute);
            
            if (
              normalizedLink &&
              !visited.has(normalizedLink) &&
              sameDomain(normalizedLink, baseUrl) &&
              item.depth < maxDepth
            ) {
              queue.push({
                url: normalizedLink,
                depth: item.depth + 1,
                parentUrl: url
              });
            }
          }

          // Report progress
          if (onProgress) {
            await onProgress({ pagesCrawled: pages.length });
          }
        })
      );
    }
  } finally {
    await browser.close();
  }

  return pages;
}

module.exports = { crawlWebsite };

