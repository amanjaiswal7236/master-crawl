const puppeteer = require('puppeteer');
const { parse: parseRobots } = require('robots-parser');
const { URL } = require('url');
const { pool } = require('../db/init');

let browserInstance = null;

// Helper function to replace deprecated page.waitForTimeout
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// NOTE: This function is NOT used - we preserve hash URLs as-is
// Hash URLs are kept with their hash fragments intact throughout the crawling process

async function getBrowser() {
  if (!browserInstance) {
    const { execSync } = require('child_process');
    const fs = require('fs');
    
    // Try to find system Chromium
    let executablePath = null;
    const chromiumPaths = [
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
    ];
    
    for (const path of chromiumPaths) {
      if (fs.existsSync(path)) {
        executablePath = path;
        console.log(`✅ Using system Chromium: ${path}`);
        break;
      }
    }
    
    // If system Chromium not found, Puppeteer will use its bundled version
    if (!executablePath) {
      console.log('⚠️  System Chromium not found, using Puppeteer bundled Chromium');
    }
    
    const launchOptions = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--window-size=1920,1080',
      ],
    };
    
    // Add executablePath if system Chromium is available
    if (executablePath) {
      launchOptions.executablePath = executablePath;
    }
    
    browserInstance = await puppeteer.launch(launchOptions);
  }
  return browserInstance;
}

async function checkRobotsTxt(baseUrl) {
  try {
    const robotsUrl = new URL('/robots.txt', baseUrl).href;
    const https = require('https');
    const http = require('http');
    const url = require('url');
    
    return new Promise((resolve) => {
      const client = robotsUrl.startsWith('https') ? https : http;
      const req = client.get(robotsUrl, (res) => {
        if (res.statusCode === 200) {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try {
              const robots = parseRobots(robotsUrl, data);
              resolve(robots);
            } catch (e) {
              resolve(null);
            }
          });
        } else {
          resolve(null);
        }
      });
      req.on('error', () => resolve(null));
      req.setTimeout(5000, () => {
        req.destroy();
        resolve(null);
      });
    });
  } catch (error) {
    console.warn(`Could not fetch robots.txt for ${baseUrl}:`, error.message);
    return null;
  }
}

async function crawlWebsite({ jobId, domain, maxDepth, maxPages, onProgress }) {
  const baseUrl = domain.startsWith('http') ? domain : `https://${domain}`;
  const baseDomain = new URL(baseUrl).hostname;
  
  const visited = new Set();
  const queue = [{ url: baseUrl, depth: 0, parentUrl: null }];
  const pages = [];
  
  let browser = null;
  let robots = null;
  
  try {
    browser = await getBrowser();
    robots = await checkRobotsTxt(baseUrl);
    
    while (queue.length > 0 && pages.length < maxPages) {
      const { url, depth, parentUrl } = queue.shift();
      
      if (depth > maxDepth) continue;
      if (visited.has(url)) continue;
      
      // Check robots.txt
      if (robots && !robots.isAllowed(url, 'SitemapBot')) {
        continue;
      }
      
      // Normalize URL (remove query params, but preserve hash)
      const normalizedUrl = normalizeUrl(url);
      if (visited.has(normalizedUrl)) continue;
      
      visited.add(normalizedUrl);
      visited.add(url);
      
      try {
        const page = await browser.newPage();
        
        // Set realistic user-agent to avoid bot detection
        const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
        await page.setUserAgent(userAgent);
        
        // Set browser-like headers to avoid detection
        const headers = {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-User': '?1',
          'Cache-Control': 'max-age=0',
        };
        
        // Add referrer if this is not the first page (simulate real browsing)
        if (parentUrl) {
          headers['Referer'] = parentUrl;
          headers['Sec-Fetch-Site'] = 'same-origin';
        } else {
          headers['Sec-Fetch-Site'] = 'none';
        }
        
        await page.setExtraHTTPHeaders(headers);
        
        // Remove webdriver property to avoid detection
        await page.evaluateOnNewDocument(() => {
          Object.defineProperty(navigator, 'webdriver', {
            get: () => false,
          });
          
          // Override plugins to look more realistic
          Object.defineProperty(navigator, 'plugins', {
            get: () => [1, 2, 3, 4, 5],
          });
          
          // Override languages
          Object.defineProperty(navigator, 'languages', {
            get: () => ['en-US', 'en'],
          });
          
          // Override permissions
          const originalQuery = window.navigator.permissions.query;
          window.navigator.permissions.query = (parameters) => (
            parameters.name === 'notifications' ?
              Promise.resolve({ state: Notification.permission }) :
              originalQuery(parameters)
          );
        });
        
        // Set reasonable timeouts
        page.setDefaultNavigationTimeout(90000); // Increased to 90s for slow sites
        page.setDefaultTimeout(90000);
        
        // Set viewport for consistent rendering
        await page.setViewport({ width: 1920, height: 1080 });
        
        // Navigate with multiple fallback strategies
        const navigationStrategies = [
          { waitUntil: 'networkidle2', timeout: 90000 },
          { waitUntil: 'domcontentloaded', timeout: 90000 },
          { waitUntil: 'load', timeout: 90000 },
        ];
        
        let navigationSucceeded = false;
        for (const strategy of navigationStrategies) {
          try {
            await page.goto(url, strategy);
            navigationSucceeded = true;
            break;
          } catch (error) {
            console.warn(`Navigation strategy ${strategy.waitUntil} failed for ${url}, trying next...`);
            if (strategy === navigationStrategies[navigationStrategies.length - 1]) {
              throw error; // Re-throw if all strategies fail
            }
          }
        }
        
        if (!navigationSucceeded) {
          throw new Error('All navigation strategies failed');
        }
        
        // Check if page was blocked (common indicators)
        const pageContent = await page.content();
        const pageTitle = await page.title();
        
        if (pageContent.includes('Access Denied') || 
            pageContent.includes('Blocked') || 
            pageContent.includes('Cloudflare') ||
            pageTitle.includes('Just a moment') ||
            pageContent.includes('Checking your browser')) {
          console.warn(`Page appears to be blocked by bot protection: ${url}`);
          // Wait a bit and try to see if challenge resolves
          await delay(5000);
          const newContent = await page.content();
          if (newContent === pageContent) {
            throw new Error('Page blocked by bot protection');
          }
        }
        
        // Enhanced SPA rendering wait - wait for DOM to be ready
        await page.waitForFunction(
          () => document.readyState === 'complete',
          { timeout: 10000 }
        ).catch(() => {}); // Continue if timeout
        
        // Wait for DOM mutations to settle (indicates content has loaded)
        await page.evaluate(() => {
          return new Promise((resolve) => {
            let lastMutationTime = Date.now();
            let timeoutId;
            
            const observer = new MutationObserver(() => {
              lastMutationTime = Date.now();
              if (timeoutId) clearTimeout(timeoutId);
              
              // If no mutations for 2 seconds, consider DOM stable
              timeoutId = setTimeout(() => {
                observer.disconnect();
                resolve();
              }, 2000);
            });
            
            if (document.body) {
              observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                characterData: true,
              });
            }
            
            // Timeout after 5 seconds
            setTimeout(() => {
              observer.disconnect();
              if (timeoutId) clearTimeout(timeoutId);
              resolve();
            }, 5000);
          });
        }).catch(() => {});
        
        // Wait for SPA framework to initialize and render
        await page.evaluate(() => {
          return new Promise((resolve) => {
            // Wait for common SPA frameworks to be ready
            const checkFrameworks = () => {
              const reactReady = !window.React || (window.React && document.querySelector('[data-reactroot], [id^="root"], [id^="app"]'));
              const vueReady = !window.Vue || (window.Vue && document.querySelector('[data-v-app]'));
              const angularReady = !window.ng || (window.ng && document.querySelector('[ng-app], [ng-version]'));
              
              if (reactReady && vueReady && angularReady) {
                resolve();
              } else {
                setTimeout(checkFrameworks, 100);
              }
            };
            
            // Start checking after a short delay
            setTimeout(checkFrameworks, 500);
            
            // Fallback timeout
            setTimeout(resolve, 5000);
          });
        }).catch(() => {});
        
        // Wait for meaningful content to appear (better SPA detection)
        await page.waitForFunction(
          () => {
            const body = document.body;
            if (!body) return false;
            
            // Check for loading indicators
            const loadingIndicators = body.querySelectorAll('[class*="loading"], [class*="spinner"], [id*="loading"], [class*="skeleton"], [class*="loader"]');
            const hasLoading = Array.from(loadingIndicators).some(el => {
              const style = window.getComputedStyle(el);
              return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
            });
            
            // Check for meaningful content
            const text = body.innerText || body.textContent || '';
            const hasContent = body.querySelector('main, article, [role="main"], .content, .app-content, [id*="app"], [id*="root"]') ||
                              text.length > 50 ||
                              body.querySelectorAll('a[href]').length > 0 ||
                              body.querySelectorAll('nav a, .nav a, [role="navigation"] a, header a, footer a').length > 0 ||
                              body.querySelectorAll('button, [role="button"]').length > 0;
            
            return !hasLoading && hasContent && document.readyState === 'complete';
          },
          { timeout: 10000 }
        ).catch(() => {}); // Continue if timeout
        
        // Track network requests to wait for API calls to complete (SPA-specific)
        let pendingRequests = 0;
        const requestHandler = (request) => {
          const resourceType = request.resourceType();
          if (resourceType === 'xhr' || resourceType === 'fetch') {
            pendingRequests++;
          }
        };
        const responseHandler = (response) => {
          const resourceType = response.request().resourceType();
          if (resourceType === 'xhr' || resourceType === 'fetch') {
            pendingRequests = Math.max(0, pendingRequests - 1);
          }
        };
        
        page.on('request', requestHandler);
        page.on('response', responseHandler);
        
        // Wait for network requests to complete
        if (pendingRequests > 0) {
          await new Promise((resolve) => {
            const checkInterval = setInterval(() => {
              if (pendingRequests === 0) {
                clearInterval(checkInterval);
                resolve();
              }
            }, 500);
            // Timeout after 10 seconds
            setTimeout(() => {
              clearInterval(checkInterval);
              resolve();
            }, 10000);
          });
        }
        
        // Wait for any lazy-loaded content or dynamic rendering
        // Check if content is being loaded dynamically
        let previousLinkCount = 0;
        let previousContentHash = '';
        let stableCount = 0;
        
        // Poll for dynamically loaded links and content changes (SPA specific)
        for (let i = 0; i < 8; i++) {
          await delay(1500); // Wait 1.5 seconds between checks
          
          const pageState = await page.evaluate(() => {
            return {
              linkCount: Array.from(document.querySelectorAll('a[href]')).length,
              contentHash: document.body ? document.body.innerHTML.length : 0,
              hasLoading: document.querySelector('[class*="loading"], [class*="spinner"], [id*="loading"]') !== null,
            };
          });
          
          // Check if content is stable
          if (pageState.linkCount === previousLinkCount && 
              pageState.contentHash === previousContentHash &&
              !pageState.hasLoading) {
            stableCount++;
            if (stableCount >= 3) break; // Content stable for 3 checks
          } else {
            stableCount = 0;
            previousLinkCount = pageState.linkCount;
            previousContentHash = pageState.contentHash;
          }
        }
        
        // Remove network handlers
        page.off('request', requestHandler);
        page.off('response', responseHandler);
        
        // Additional wait for any remaining async operations (with random variation)
        const randomDelay = Math.floor(Math.random() * 2000) + 2000; // 2-4 seconds
        await delay(randomDelay);
        
        // Simulate human-like mouse movement before scrolling
        try {
          await page.mouse.move(Math.random() * 100, Math.random() * 100);
          await delay(500 + Math.random() * 500);
        } catch (e) {
          // Ignore mouse movement errors
        }
        
        // Scroll to trigger lazy loading (common in SPAs) - smooth scroll like human
        await page.evaluate(() => {
          const scrollHeight = document.body.scrollHeight;
          const scrollStep = scrollHeight / 10;
          let currentPosition = 0;
          const scrollInterval = setInterval(() => {
            currentPosition += scrollStep;
            window.scrollTo(0, currentPosition);
            if (currentPosition >= scrollHeight) {
              clearInterval(scrollInterval);
            }
          }, 100);
        });
        await delay(2000 + Math.random() * 1000);
        
        // Scroll back to top with smooth animation
        await page.evaluate(() => {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
        await delay(1000 + Math.random() * 500);
        
        // Get page title with fallback to h1 (matching revize-ai approach)
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
          // Fallback if evaluation fails
          try {
            title = await page.title() || "Untitled";
          } catch (e) {
            title = "Untitled";
          }
        }
        
        // Clean up title - remove "ERROR: Error" patterns
        if (title && (title.includes("ERROR:") || title === "Error" || title === "ERROR")) {
          // Try to get a better title from the URL or h1
          try {
            const betterTitle = await page.evaluate(() => {
              const h1 = document.querySelector("h1")?.textContent?.trim();
              const h2 = document.querySelector("h2")?.textContent?.trim();
              const metaTitle = document.querySelector('meta[property="og:title"]')?.getAttribute("content");
              return h1 || h2 || metaTitle || null;
            });
            if (betterTitle) {
              title = betterTitle;
            } else {
              // Use URL path as fallback
              const urlObj = new URL(finalUrl);
              const pathParts = urlObj.pathname.split('/').filter(p => p);
              title = pathParts.length > 0 ? pathParts[pathParts.length - 1].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : "Home";
            }
          } catch (e) {
            // Final fallback
            const urlObj = new URL(finalUrl);
            const pathParts = urlObj.pathname.split('/').filter(p => p);
            title = pathParts.length > 0 ? pathParts[pathParts.length - 1].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : "Home";
          }
        }
        
        // Extract routes from JavaScript routers - convert hash URLs to crawlable paths
        const { links, routes } = await page.evaluate((baseUrl) => {
          const linksSet = new Set();
          const routesSet = new Set();
          const base = new URL(baseUrl);
          
          // Helper to convert hash to path
          function hashToPath(hash, baseOrigin, basePathname) {
            if (!hash || hash === '#') return null;
            const hashValue = hash.startsWith('#') ? hash.substring(1) : hash;
            // Fix double slash issue: if hashValue already starts with /, don't add another /
            let newPath;
            if (basePathname === '/') {
              newPath = hashValue.startsWith('/') ? hashValue : `/${hashValue}`;
            } else {
              newPath = hashValue.startsWith('/') ? `${basePathname}${hashValue}` : `${basePathname}/${hashValue}`;
            }
            return baseOrigin + newPath;
          }
          
          // Try to extract routes from React Router
          try {
            // React Router v6 (most common)
            if (window.__REACT_ROUTER__) {
              const router = window.__REACT_ROUTER__;
              if (router.routes || router._internalSetRoutes) {
                const routes = router.routes || router._internalSetRoutes || [];
                routes.forEach(route => {
                  if (route.path) {
                    const fullPath = base.origin + route.path;
                    linksSet.add(fullPath);
                    routesSet.add(fullPath);
                  }
                  if (route.children) {
                    route.children.forEach(child => {
                      if (child.path) {
                        const fullPath = base.origin + (route.path === '/' ? '' : route.path) + child.path;
                        linksSet.add(fullPath);
                        routesSet.add(fullPath);
                      }
                    });
                  }
                });
              }
            }
            
            // React Router v5
            if (window.ReactRouter && window.ReactRouter.__router) {
              const router = window.ReactRouter.__router;
              if (router.match && router.match.routes) {
                router.match.routes.forEach(route => {
                  if (route.path) {
                    const fullPath = base.origin + route.path;
                    linksSet.add(fullPath);
                    routesSet.add(fullPath);
                  }
                });
              }
            }
            
            // Try to access React Router through React DevTools
            if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
              const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
              if (hook.renderers && hook.renderers.size > 0) {
                hook.renderers.forEach(renderer => {
                  try {
                    const fiber = renderer.findFiberByHostInstance(document.body);
                    if (fiber) {
                      let current = fiber;
                      while (current) {
                        if (current.memoizedProps && current.memoizedProps.location) {
                          const location = current.memoizedProps.location;
                          if (location.pathname) {
                            linksSet.add(base.origin + location.pathname);
                            routesSet.add(base.origin + location.pathname);
                          }
                        }
                        current = current.return;
                      }
                    }
                  } catch (e) {}
                });
              }
            }
          } catch (e) {}
          
          // Try to extract routes from Vue Router
          try {
            if (window.$router || window.__VUE_ROUTER__) {
              const router = window.$router || window.__VUE_ROUTER__;
              if (router.options && router.options.routes) {
                const extractRoutes = (routes, parentPath = '') => {
                  routes.forEach(route => {
                    if (route.path) {
                      const fullPath = base.origin + parentPath + route.path;
                      linksSet.add(fullPath);
                      routesSet.add(fullPath);
                    }
                    if (route.children) {
                      extractRoutes(route.children, route.path || '');
                    }
                  });
                };
                extractRoutes(router.options.routes);
              }
            }
          } catch (e) {}
          
          // Try to extract routes from Angular Router
          try {
            if (window.ng && window.ng.probe) {
              const rootComponent = window.ng.probe(document.body);
              if (rootComponent && rootComponent.injector) {
                const router = rootComponent.injector.get(window.ng.router.Router);
                if (router && router.config) {
                  router.config.forEach(route => {
                    if (route.path) {
                      const fullPath = base.origin + route.path;
                      linksSet.add(fullPath);
                      routesSet.add(fullPath);
                    }
                    if (route.children) {
                      route.children.forEach(child => {
                        if (child.path) {
                          const fullPath = base.origin + route.path + '/' + child.path;
                          linksSet.add(fullPath);
                          routesSet.add(fullPath);
                        }
                      });
                    }
                  });
                }
              }
            }
          } catch (e) {}
          
          // Extract standard anchor links
          const anchors = Array.from(document.querySelectorAll('a[href]'));
          anchors.forEach(a => {
            const href = a.getAttribute('href');
            if (href) {
              const trimmed = href.trim();
              // Allow hash-based routes (#/path) but skip simple anchors (#section)
              const isHashRoute = trimmed.startsWith('#/');
              const isSimpleAnchor = trimmed.startsWith('#') && !trimmed.startsWith('#/');
              
              if (trimmed && !isSimpleAnchor && 
                  !trimmed.startsWith('javascript:') && 
                  !trimmed.startsWith('mailto:') && 
                  !trimmed.startsWith('tel:') &&
                  !trimmed.startsWith('data:') &&
                  !trimmed.startsWith('file:')) {
                // Handle hash-based routes - convert to crawlable paths
                if (isHashRoute) {
                  // Create hash URL - preserve hash route
                  const fullHashUrl = window.location.origin + window.location.pathname + trimmed;
                  linksSet.add(fullHashUrl);
                  routesSet.add(fullHashUrl);
                  
                  // Convert hash to crawlable path and add it too
                  const crawlablePath = hashToPath(trimmed, window.location.origin, window.location.pathname);
                  if (crawlablePath) {
                    linksSet.add(crawlablePath);
                    routesSet.add(crawlablePath);
                  }
                } else if (!trimmed.startsWith('#')) {
                  // Handle relative URLs (not hash routes)
                  try {
                    const fullUrl = new URL(trimmed, window.location.href);
                    // Preserve hash routes in resolved URLs
                    if (fullUrl.hash && fullUrl.hash.startsWith('#/')) {
                      linksSet.add(fullUrl.href);
                    } else if (!fullUrl.hash) {
                      linksSet.add(fullUrl.href);
                    }
                  } catch (e) {
                    if (trimmed.startsWith('/')) {
                      linksSet.add(window.location.origin + trimmed);
                    } else if (trimmed.startsWith('./')) {
                      linksSet.add(new URL(trimmed, window.location.href).href);
                    }
                  }
                }
              }
            }
          });
          
          // Also check for router links that might use data attributes or classes
          // Some SPAs use data-href, data-route, or router-link attributes
          const routerLinks = document.querySelectorAll('[data-href], [data-route], [router-link], [ng-href], [to]');
          routerLinks.forEach((element) => {
            const href = element.getAttribute('data-href') || 
                         element.getAttribute('data-route') ||
                         element.getAttribute('router-link') ||
                         element.getAttribute('ng-href') ||
                         element.getAttribute('to');
            if (href) {
              const trimmed = href.trim();
              const isHashRoute = trimmed.startsWith('#/');
              if (trimmed && isHashRoute) {
                try {
                  const baseUrl = new URL(window.location.href);
                  baseUrl.hash = trimmed;
                  linksSet.add(baseUrl.href);
                } catch {
                  // Invalid URL, skip
                }
              } else if (trimmed && !trimmed.startsWith('http') && !trimmed.startsWith('/') && !trimmed.includes(':')) {
                // Relative route path (like "products" or "/products") - convert to hash route
                try {
                  const routePath = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
                  const baseUrl = new URL(window.location.href);
                  baseUrl.hash = `#${routePath}`;
                  linksSet.add(baseUrl.href);
                } catch {
                  // Invalid URL, skip
                }
              }
            }
          });
          
          // Extract routes from React Router
          try {
            // React Router v5/v6
            if (window.__REACT_ROUTER__ || window.ReactRouter) {
              const router = window.__REACT_ROUTER__ || window.ReactRouter;
              if (router.routes) {
                router.routes.forEach(route => {
                  if (route.path) {
                    // Check if it's a hash route
                    if (route.path.startsWith('#')) {
                      const fullHashUrl = base.origin + base.pathname + route.path;
                      linksSet.add(fullHashUrl);
                      routesSet.add(fullHashUrl);
                      // Convert to crawlable path
                      const hashValue = route.path.substring(1);
                      const newPath = base.pathname === '/' 
                        ? (hashValue.startsWith('/') ? hashValue : `/${hashValue}`)
                        : (hashValue.startsWith('/') ? `${base.pathname}${hashValue}` : `${base.pathname}/${hashValue}`);
                      const crawlablePath = base.origin + newPath;
                      linksSet.add(crawlablePath);
                      routesSet.add(crawlablePath);
                    } else {
                      const fullPath = base.origin + route.path;
                      linksSet.add(fullPath);
                      routesSet.add(fullPath);
                    }
                  }
                });
              }
            }
            
            // React Router DOM (check for route definitions)
            const reactRouterElements = document.querySelectorAll('[data-react-router], [data-route-path]');
            reactRouterElements.forEach(el => {
              const path = el.getAttribute('data-route-path') || el.getAttribute('data-react-router');
              if (path) {
                if (path.startsWith('#')) {
                  const fullHashUrl = base.origin + base.pathname + path;
                  linksSet.add(fullHashUrl);
                  routesSet.add(fullHashUrl);
                  // Convert to crawlable path
                  const hashValue = path.substring(1);
                  const newPath = base.pathname === '/' 
                    ? (hashValue.startsWith('/') ? hashValue : `/${hashValue}`)
                    : (hashValue.startsWith('/') ? `${base.pathname}${hashValue}` : `${base.pathname}/${hashValue}`);
                  const crawlablePath = base.origin + newPath;
                  linksSet.add(crawlablePath);
                  routesSet.add(crawlablePath);
                } else {
                  const fullPath = base.origin + path;
                  linksSet.add(fullPath);
                  routesSet.add(fullPath);
                }
              }
            });
          } catch (e) {}
          
          // Extract routes from Vue Router
          try {
            if (window.__VUE_ROUTER__ || window.$router) {
              const router = window.__VUE_ROUTER__ || window.$router;
              if (router.options && router.options.routes) {
                router.options.routes.forEach(route => {
                  if (route.path) {
                    // Check if it's a hash route
                    if (route.path.startsWith('#')) {
                      const fullHashUrl = base.origin + base.pathname + route.path;
                      linksSet.add(fullHashUrl);
                      routesSet.add(fullHashUrl);
                      // Convert to crawlable path
                      const hashValue = route.path.substring(1);
                      const newPath = base.pathname === '/' 
                        ? (hashValue.startsWith('/') ? hashValue : `/${hashValue}`)
                        : (hashValue.startsWith('/') ? `${base.pathname}${hashValue}` : `${base.pathname}/${hashValue}`);
                      const crawlablePath = base.origin + newPath;
                      linksSet.add(crawlablePath);
                      routesSet.add(crawlablePath);
                    } else {
                      const fullPath = base.origin + route.path;
                      linksSet.add(fullPath);
                      routesSet.add(fullPath);
                    }
                  }
                });
              }
            }
          } catch (e) {}
          
          // Extract routes from Angular Router
          try {
            if (window.ng && window.ng.probe) {
              const rootComponent = window.ng.probe(document.body);
              if (rootComponent && rootComponent.injector) {
                const router = rootComponent.injector.get(window.ng.router.Router);
                if (router && router.config) {
                  router.config.forEach(route => {
                    if (route.path) {
                      // Check if it's a hash route
                      if (route.path.startsWith('#')) {
                        const fullHashUrl = base.origin + base.pathname + route.path;
                        linksSet.add(fullHashUrl);
                        routesSet.add(fullHashUrl);
                        // Convert to crawlable path
                        const hashValue = route.path.substring(1);
                        const newPath = base.pathname === '/' 
                          ? (hashValue.startsWith('/') ? hashValue : `/${hashValue}`)
                          : (hashValue.startsWith('/') ? `${base.pathname}${hashValue}` : `${base.pathname}/${hashValue}`);
                        const crawlablePath = base.origin + newPath;
                        linksSet.add(crawlablePath);
                        routesSet.add(crawlablePath);
                      } else {
                        const fullPath = base.origin + route.path;
                        linksSet.add(fullPath);
                        routesSet.add(fullPath);
                      }
                    }
                  });
                }
              }
            }
          } catch (e) {}
          
          // Extract from router-based navigation elements
          // Note: v-bind:href is not a valid CSS selector (colon needs escaping)
          // Vue uses :href which compiles to href attribute, so we don't need to select it separately
          const routerElements = Array.from(document.querySelectorAll(
            '[data-link], [data-route], [data-navigate], [router-link], [ng-href]'
          ));
          routerElements.forEach(el => {
            const link = el.getAttribute('data-link') || 
                        el.getAttribute('data-route') || 
                        el.getAttribute('data-navigate') ||
                        el.getAttribute('router-link') ||
                        el.getAttribute('ng-href') ||
                        el.getAttribute('href') ||
                        el.getAttribute('to'); // Vue Router 'to' attribute
            
            if (link) {
              // Convert hash routes to crawlable paths
              if (link.startsWith('#')) {
                const fullHashUrl = window.location.origin + window.location.pathname + link;
                linksSet.add(fullHashUrl);
                routesSet.add(fullHashUrl);
                // Convert to crawlable path
                const hashValue = link.substring(1);
                const newPath = window.location.pathname === '/' 
                  ? (hashValue.startsWith('/') ? hashValue : `/${hashValue}`)
                  : (hashValue.startsWith('/') ? `${window.location.pathname}${hashValue}` : `${window.location.pathname}/${hashValue}`);
                const crawlablePath = window.location.origin + newPath;
                linksSet.add(crawlablePath);
                routesSet.add(crawlablePath);
              } else if (!link.startsWith('#')) {
                try {
                  const fullUrl = new URL(link, window.location.href);
                  linksSet.add(fullUrl.href);
                } catch (e) {
                  if (link.startsWith('/')) {
                    linksSet.add(window.location.origin + link);
                  }
                }
              }
            }
          });
          
          // Extract hash routes from current URL and convert to crawlable paths
          if (window.location.hash && window.location.hash !== '#') {
            const fullHashUrl = window.location.origin + window.location.pathname + window.location.hash;
            linksSet.add(fullHashUrl);
            routesSet.add(fullHashUrl);
            // Convert to crawlable path
            const hashValue = window.location.hash.substring(1);
            const newPath = window.location.pathname === '/' 
              ? (hashValue.startsWith('/') ? hashValue : `/${hashValue}`)
              : (hashValue.startsWith('/') ? `${window.location.pathname}${hashValue}` : `${window.location.pathname}/${hashValue}`);
            const crawlablePath = window.location.origin + newPath;
            linksSet.add(crawlablePath);
            routesSet.add(crawlablePath);
          }
          
          // Try to extract routes from window.history or router state
          try {
            // Check for route definitions in global state
            if (window.__ROUTES__) {
              window.__ROUTES__.forEach(route => {
                const fullPath = base.origin + route;
                linksSet.add(fullPath);
                routesSet.add(fullPath);
              });
            }
          } catch (e) {}
          
          return {
            links: Array.from(linksSet),
            routes: Array.from(routesSet)
          };
        }, baseUrl);
        
        // Also try to discover routes by navigating through hash changes
        const hashRoutes = await discoverHashRoutes(page, baseUrl);
        links.push(...hashRoutes);
        
        // For hash-based SPAs, actually navigate to hash routes to extract content
        if (url.includes('#') || hashRoutes.length > 0) {
          const hashRoutesToVisit = hashRoutes.filter(r => r.includes('#')).slice(0, 5); // Limit to 5 to avoid too many navigations
          for (const hashRoute of hashRoutesToVisit) {
            try {
              // Navigate to hash route
              await page.goto(hashRoute, { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
              
              // Wait for SPA to update content
              await page.waitForFunction(
                () => document.readyState === 'complete',
                { timeout: 5000 }
              ).catch(() => {});
              
              await delay(2000); // Wait for route change
              
              // Extract links from this hash route
              const hashLinks = await page.evaluate((baseUrl) => {
                const linksSet = new Set();
                const base = new URL(baseUrl);
                
                // Get all links on this route
                document.querySelectorAll('a[href]').forEach(a => {
                  const href = a.getAttribute('href');
                  if (href) {
                    try {
                      const fullUrl = new URL(href, window.location.href);
                      if (fullUrl.origin === base.origin) {
                        linksSet.add(fullUrl.href);
                      }
                    } catch (e) {
                      if (href.startsWith('/') || href.startsWith('#')) {
                        linksSet.add(base.origin + href);
                      }
                    }
                  }
                });
                
                return Array.from(linksSet);
              }, baseUrl);
              
              links.push(...hashLinks);
            } catch (e) {
              // Continue if hash navigation fails
            }
          }
        }
        
        // Programmatically discover routes by clicking navigation elements
        const discoveredRoutes = await discoverRoutesByNavigation(page, baseUrl);
        links.push(...discoveredRoutes);
        
        // Remove duplicates
        const uniqueLinks = [...new Set(links)];
        
        await page.close();
        
        // Store page in database
        const pageResult = await pool.query(
          'INSERT INTO pages (job_id, url, depth, parent_url, title, status_code) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
          [jobId, normalizedUrl, depth, parentUrl, title, 200]
        );
        
        pages.push({
          id: pageResult.rows[0].id,
          url: normalizedUrl,
          depth,
          parentUrl,
          title,
        });
        
        // Add new links to queue (same domain only)
        for (const link of uniqueLinks) {
          try {
            const linkUrl = new URL(link, baseUrl);
            const linkDomain = linkUrl.hostname;
            
            // Only crawl same domain
            if (linkDomain === baseDomain || linkDomain === `www.${baseDomain}` || `www.${linkDomain}` === baseDomain) {
              const normalizedLink = normalizeUrl(linkUrl.href);
              if (!visited.has(normalizedLink) && depth < maxDepth) {
                queue.push({
                  url: normalizedLink,
                  depth: depth + 1,
                  parentUrl: normalizedUrl,
                });
              }
            }
          } catch (e) {
            // Invalid URL, skip
          }
        }
        
        // Report progress
        if (onProgress && pages.length % 10 === 0) {
          await onProgress({ pagesCrawled: pages.length });
        }
        
        // Add human-like delay between page requests to avoid being too aggressive
        // Random delay between 1-3 seconds to appear more natural
        const requestDelay = Math.floor(Math.random() * 2000) + 1000;
        await new Promise(resolve => setTimeout(resolve, requestDelay));
      } catch (error) {
        // Enhanced error logging
        const errorType = error.name || 'UnknownError';
        const errorMessage = error.message || 'Unknown error';
        const isTimeout = errorMessage.includes('timeout') || errorMessage.includes('Timeout');
        const isBlocked = errorMessage.includes('blocked') || errorMessage.includes('Blocked') || 
                         errorMessage.includes('Access Denied') || errorMessage.includes('Cloudflare');
        const isNavigation = errorMessage.includes('Navigation') || errorMessage.includes('net::');
        
        console.warn(`Error crawling ${url}:`, {
          type: errorType,
          message: errorMessage,
          isTimeout,
          isBlocked,
          isNavigation,
        });
        
        // Store failed page with error details
        try {
          await pool.query(
            'INSERT INTO pages (job_id, url, depth, parent_url, title, status_code) VALUES ($1, $2, $3, $4, $5, $6)',
            [jobId, normalizedUrl, depth, parentUrl, `ERROR: ${errorType}`, isBlocked ? 403 : isTimeout ? 408 : 0]
          );
        } catch (e) {
          // Ignore DB errors for failed pages
          console.warn(`Failed to store error page in DB:`, e.message);
        }
        
        // Close page if it exists to prevent resource leaks
        try {
          const pages = await browser.pages();
          const currentPage = pages.find(p => p.url() === url || p.url().includes(new URL(url).hostname));
          if (currentPage && !currentPage.isClosed()) {
            await currentPage.close();
          }
        } catch (e) {
          // Ignore errors closing page
        }
      }
    }
    
    // Final progress update
    if (onProgress) {
      await onProgress({ pagesCrawled: pages.length });
    }
    
    return pages;
  } catch (error) {
    console.error('Crawler error:', error);
    throw error;
  }
}

/**
 * Discover hash-based routes by detecting navigation - preserve hash URLs as-is
 */
async function discoverHashRoutes(page, baseUrl) {
  const discoveredRoutes = new Set();
  const base = new URL(baseUrl);
  
  try {
    // Get all elements that might trigger hash navigation
    const hashNavElements = await page.evaluate(() => {
      const elements = [];
      
      // Find all clickable elements with hash hrefs
      document.querySelectorAll('a[href^="#"], [onclick*="hash"], [data-hash], [router-link], [data-link]').forEach(el => {
        const href = el.getAttribute('href');
        const hash = el.getAttribute('data-hash');
        const onclick = el.getAttribute('onclick');
        const routerLink = el.getAttribute('router-link') || el.getAttribute('data-link') || el.getAttribute('to');
        
        if (href && href.startsWith('#')) {
          elements.push(href);
        }
        if (hash) {
          elements.push('#' + hash);
        }
        if (routerLink && routerLink.startsWith('#')) {
          elements.push(routerLink);
        }
        if (onclick && onclick.includes('hash')) {
          const hashMatch = onclick.match(/['"]#([^'"]+)['"]/);
          if (hashMatch) {
            elements.push('#' + hashMatch[1]);
          }
        }
      });
      
      // Also check for hash routes in router configs
      try {
        // React Router
        if (window.__REACT_ROUTER__ && window.__REACT_ROUTER__.routes) {
          window.__REACT_ROUTER__.routes.forEach(route => {
            if (route.path && route.path.startsWith('#')) {
              elements.push(route.path);
            }
          });
        }
        
        // Vue Router
        if (window.$router && window.$router.options && window.$router.options.routes) {
          window.$router.options.routes.forEach(route => {
            if (route.path && route.path.startsWith('#')) {
              elements.push(route.path);
            }
          });
        }
      } catch (e) {}
      
      return [...new Set(elements)];
    });
    
    // Convert hash routes to crawlable paths
    for (const hashRoute of hashNavElements) {
      if (hashRoute && hashRoute !== '#') {
        // Keep hash URL as-is: baseUrl + hashRoute
        const hashUrl = base.origin + base.pathname + hashRoute;
        discoveredRoutes.add(hashUrl);
        
        // Convert to crawlable path
        const hashValue = hashRoute.substring(1);
        const newPath = base.pathname === '/' 
          ? (hashValue.startsWith('/') ? hashValue : `/${hashValue}`)
          : (hashValue.startsWith('/') ? `${base.pathname}${hashValue}` : `${base.pathname}/${hashValue}`);
        const crawlablePath = base.origin + newPath;
        discoveredRoutes.add(crawlablePath);
      }
    }
    
    // Try to get current hash from page
    const currentHash = await page.evaluate(() => window.location.hash);
    if (currentHash && currentHash !== '#') {
      const hashUrl = base.origin + base.pathname + currentHash;
      discoveredRoutes.add(hashUrl);
      
      // Convert to crawlable path
      const hashValue = currentHash.substring(1);
      const newPath = base.pathname === '/' 
        ? (hashValue.startsWith('/') ? hashValue : `/${hashValue}`)
        : (hashValue.startsWith('/') ? `${base.pathname}${hashValue}` : `${base.pathname}/${hashValue}`);
      const crawlablePath = base.origin + newPath;
      discoveredRoutes.add(crawlablePath);
    }
    
  } catch (error) {
    console.warn('Error discovering hash routes:', error.message);
  }
  
  return Array.from(discoveredRoutes);
}

/**
 * Discover routes by programmatically navigating through the SPA
 */
async function discoverRoutesByNavigation(page, baseUrl) {
  const discoveredRoutes = new Set();
  const base = new URL(baseUrl);
  
  try {
    // Get all navigation links and try to extract their target routes
    const navInfo = await page.evaluate((baseOrigin) => {
      const routes = new Set();
      const base = baseOrigin;
      
      // Find all navigation elements
      const navElements = document.querySelectorAll(
        'a[href], [router-link], [ng-href], [data-link], [data-route], nav a, [role="navigation"] a, [class*="nav"] a, [class*="menu"] a'
      );
      
      navElements.forEach(el => {
        let route = null;
        
        // Get route from various attributes
        route = el.getAttribute('href') || 
                el.getAttribute('router-link') ||
                el.getAttribute('ng-href') ||
                el.getAttribute('data-link') ||
                el.getAttribute('data-route') ||
                el.getAttribute('to'); // Vue Router
        
        if (route) {
          // Convert hash routes to crawlable paths
          if (route.startsWith('#')) {
            // Keep hash URL: base + current pathname + hash
            const currentPath = window.location.pathname;
            routes.add(base + currentPath + route);
            // Convert to crawlable path
            const hashValue = route.substring(1);
            const newPath = currentPath === '/' 
              ? (hashValue.startsWith('/') ? hashValue : `/${hashValue}`)
              : (hashValue.startsWith('/') ? `${currentPath}${hashValue}` : `${currentPath}/${hashValue}`);
            routes.add(base + newPath);
          } else if (route.startsWith('/')) {
            routes.add(base + route);
          } else if (!route.startsWith('http') && !route.startsWith('mailto:') && !route.startsWith('tel:')) {
            // Relative route
            routes.add(base + '/' + route);
          }
        }
      });
      
      // Also check for route definitions in JavaScript
      try {
        // React Router
        if (window.__REACT_ROUTER_CONFIG__) {
          window.__REACT_ROUTER_CONFIG__.forEach(route => {
            if (route.path) {
              routes.add(base + route.path);
            }
          });
        }
        
        // Vue Router
        if (window.__VUE_ROUTER_CONFIG__) {
          window.__VUE_ROUTER_CONFIG__.forEach(route => {
            if (route.path) {
              routes.add(base + route.path);
            }
          });
        }
        
        // Check for route arrays in window
        if (window.routes && Array.isArray(window.routes)) {
          window.routes.forEach(route => {
            if (typeof route === 'string') {
              routes.add(base + route);
            } else if (route.path) {
              routes.add(base + route.path);
            }
          });
        }
      } catch (e) {}
      
      return Array.from(routes);
    }, base.origin);
    
    navInfo.forEach(route => {
      if (route && route.startsWith(base.origin)) {
        discoveredRoutes.add(route);
      }
    });
    
    // Try clicking navigation elements to discover routes (limited to avoid infinite loops)
    try {
      const clickableNavs = await page.$$('nav a[href^="#"], [router-link], [data-link], a[href^="#"]');
      const clickedRoutes = new Set();
      
      for (let i = 0; i < Math.min(clickableNavs.length, 15); i++) {
        try {
          const href = await page.evaluate(el => {
            return el.getAttribute('href') || 
                   el.getAttribute('router-link') ||
                   el.getAttribute('data-link') ||
                   el.getAttribute('to');
          }, clickableNavs[i]);
          
          if (href && href.startsWith('#') && !clickedRoutes.has(href)) {
            clickedRoutes.add(href);
            
            // Keep hash URL as-is
            const hashUrl = base.origin + base.pathname + href;
            discoveredRoutes.add(hashUrl);
            
            // Convert to crawlable path
            const hashValue = href.substring(1);
            const newPath = base.pathname === '/' 
              ? (hashValue.startsWith('/') ? hashValue : `/${hashValue}`)
              : (hashValue.startsWith('/') ? `${base.pathname}${hashValue}` : `${base.pathname}/${hashValue}`);
            const crawlablePath = base.origin + newPath;
            discoveredRoutes.add(crawlablePath);
            
            // Actually click the link to trigger SPA navigation and discover more routes
            try {
              const currentUrl = page.url();
              await clickableNavs[i].click();
              
              // Wait for route change
              await page.waitForFunction(
                (oldUrl) => window.location.href !== oldUrl,
                { timeout: 3000 },
                currentUrl
              ).catch(() => {});
              
              await delay(2000); // Wait for content to load
              
              // Extract new routes from the navigated page
              const newRoutes = await page.evaluate((baseOrigin) => {
                const routes = new Set();
                document.querySelectorAll('a[href^="#"], [router-link], [data-link]').forEach(el => {
                  const link = el.getAttribute('href') || 
                             el.getAttribute('router-link') ||
                             el.getAttribute('data-link') ||
                             el.getAttribute('to');
                  if (link && link.startsWith('#')) {
                    routes.add(baseOrigin + window.location.pathname + link);
                  }
                });
                return Array.from(routes);
              }, base.origin);
              
              newRoutes.forEach(route => discoveredRoutes.add(route));
              
              // Navigate back if possible
              await page.goBack().catch(() => {});
              await delay(1000);
            } catch (e) {
              // Continue if clicking fails
            }
          }
        } catch (e) {
          // Skip if element is not clickable
        }
      }
    } catch (error) {
      // Ignore navigation errors
    }
    
  } catch (error) {
    console.warn('Error discovering routes by navigation:', error.message);
  }
  
  return Array.from(discoveredRoutes);
}

/**
 * Normalize URL by removing query parameters but PRESERVING hash fragments
 * Hash URLs like https://example.com/#/route are kept with their hash intact
 * This ensures SPA hash-based routing URLs are preserved in the sitemap
 */
function normalizeUrl(url) {
  try {
    const urlObj = new URL(url);
    
    // IMPORTANT: Preserve hash fragments - NEVER remove hash from URL
    // Only remove query params, keep hash intact for SPA routing
    urlObj.search = '';
    // Keep hash: urlObj.hash stays as-is - DO NOT modify urlObj.hash
    
    return urlObj.href;
  } catch (e) {
    // If URL parsing fails, preserve hash manually
    if (url.includes('#')) {
      const parts = url.split('#');
      const base = parts[0].split('?')[0];
      const hash = parts[1] ? '#' + parts[1] : '';
      return base + hash; // Preserve hash fragment
    }
    return url.split('?')[0];
  }
}

// Cleanup browser on shutdown
process.on('SIGTERM', async () => {
  if (browserInstance) {
    await browserInstance.close();
  }
});

module.exports = { crawlWebsite };

