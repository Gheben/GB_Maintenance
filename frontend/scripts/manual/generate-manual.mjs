import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';
import { chromium } from 'playwright';

const args = new Set(process.argv.slice(2));
const shouldCapture = args.has('--capture') || args.has('--all') || (!args.has('--build') && !args.has('--capture'));
const shouldBuild = args.has('--build') || args.has('--all') || (!args.has('--build') && !args.has('--capture'));

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(scriptDir, '..', '..');
const repoRoot = path.resolve(frontendRoot, '..');

const scenariosFile = path.join(scriptDir, 'scenarios.json');
const docsRoot = path.join(repoRoot, 'docs', 'manual');
const screenshotsDir = path.join(docsRoot, 'screenshots');
const manifestFile = path.join(docsRoot, 'manifest.json');
const markdownFile = path.join(docsRoot, 'README.md');

const baseUrl = process.env.MANUAL_BASE_URL || 'http://localhost:5173';
const browserHeadless = process.env.MANUAL_HEADLESS !== 'false';
let runtimeUsername = process.env.MANUAL_USERNAME || '';
let runtimePassword = process.env.MANUAL_PASSWORD || '';

const DEFAULT_SENSITIVE_TEXT_PATTERNS = [
  // emails
  '[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}',
  // jwt-ish/token-ish strings
  '(?:eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9._-]{8,}\\.[A-Za-z0-9._-]{8,})',
  // UUIDs
  '\\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\b',
  // long numeric ids/secrets
  '\\b\\d{8,}\\b',
  // phone-ish values
  '(?:\\+?\\d[\\d .()-]{7,}\\d)'
];

function nowIso() {
  return new Date().toISOString();
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

async function ensureDirs() {
  await fs.mkdir(docsRoot, { recursive: true });
  await fs.mkdir(screenshotsDir, { recursive: true });
}

async function readScenariosConfig() {
  const raw = await fs.readFile(scenariosFile, 'utf8');
  const config = JSON.parse(raw);

  if (!Array.isArray(config.scenarios) || config.scenarios.length === 0) {
    throw new Error('scenarios.json has no scenarios.');
  }
  if (!Array.isArray(config.viewports) || config.viewports.length === 0) {
    throw new Error('scenarios.json has no viewports.');
  }

  return config;
}

async function askQuestion(promptText, { secret = false } = {}) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  if (secret) {
    // Hide password input while still allowing interactive entry.
    rl.stdoutMuted = true;
    const originalWrite = rl._writeToOutput.bind(rl);
    rl._writeToOutput = (stringToWrite) => {
      if (rl.stdoutMuted) {
        if (stringToWrite.includes('\n')) {
          originalWrite('\n');
          return;
        }
        originalWrite('*');
        return;
      }
      originalWrite(stringToWrite);
    };
  }

  try {
    const answer = await rl.question(promptText);
    return String(answer || '').trim();
  } finally {
    rl.close();
  }
}

async function ensureCredentials() {
  if (!runtimeUsername) {
    runtimeUsername = await askQuestion('[manual] Username: ');
  }
  if (!runtimePassword) {
    runtimePassword = await askQuestion('[manual] Password: ', { secret: true });
  }

  if (!runtimeUsername || !runtimePassword) {
    throw new Error('Missing credentials. Provide MANUAL_USERNAME/MANUAL_PASSWORD or enter them at prompt.');
  }
}

async function tryClick(page, selector, timeout = 1500) {
  try {
    const locator = page.locator(selector).first();
    if (await locator.isVisible({ timeout })) {
      await locator.click({ timeout });
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

async function login(page) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });

  // If an existing session is active, app may redirect away from /login immediately.
  if (!page.url().includes('/login')) {
    await page.waitForLoadState('networkidle');
    return;
  }

  const userInput = page.locator("input[autocomplete='username'], input[name='username'], input[type='text']").first();
  const passInput = page.locator("input[autocomplete='current-password'], input[name='password'], input[type='password']").first();

  await userInput.waitFor({ state: 'visible', timeout: 15000 });
  await passInput.waitFor({ state: 'visible', timeout: 15000 });

  await userInput.fill(runtimeUsername);
  await passInput.fill(runtimePassword);
  await page.locator("button[type='submit']").first().click();

  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 20000 });
  await page.waitForLoadState('networkidle');
}

async function applyMasks(page, selectors) {
  for (const selector of selectors || []) {
    try {
      const nodes = page.locator(selector);
      const count = await nodes.count();
      for (let i = 0; i < count; i += 1) {
        const item = nodes.nth(i);
        await item.evaluate((el) => {
          el.style.filter = 'blur(8px)';
          el.style.pointerEvents = 'none';
        });
      }
    } catch {
      // Ignore selectors that do not exist.
    }
  }

  // Redact sensitive text patterns even when selectors are unknown.
  await page.evaluate((patternSources) => {
    const regexes = patternSources
      .map((src) => {
        try {
          return new RegExp(src, 'ig');
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    if (!regexes.length) return;

    const sensitiveElements = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = String(node.nodeValue || '').trim();
      if (!text) continue;
      if (regexes.some((rx) => rx.test(text))) {
        if (node.parentElement) sensitiveElements.add(node.parentElement);
      }
    }

    document.querySelectorAll('input, textarea').forEach((el) => {
      const v = String(el.value || '').trim();
      if (!v) return;
      if (regexes.some((rx) => rx.test(v))) {
        sensitiveElements.add(el);
      }
    });

    sensitiveElements.forEach((el) => {
      el.style.filter = 'blur(10px)';
      el.style.borderRadius = '6px';
      el.style.pointerEvents = 'none';
    });
  }, DEFAULT_SENSITIVE_TEXT_PATTERNS);
}

async function applyMarketingPolish(page, scenario) {
  await page.addStyleTag({
    content: `
      .react-hot-toast, [data-sonner-toaster], [data-radix-toast-viewport], .toast, [role="alert"] {
        display: none !important;
      }
      [data-manual-hide="true"] { display: none !important; }
      body { text-rendering: optimizeLegibility; }
    `,
  });

  if (scenario.focusSelector) {
    await page.locator(scenario.focusSelector).first().evaluate((el) => {
      el.style.boxShadow = '0 0 0 3px rgba(37,99,235,0.25), 0 12px 32px rgba(15,23,42,0.18)';
      el.style.borderRadius = el.style.borderRadius || '12px';
    });
  }
}

async function runActions(page, actions = []) {
  for (const action of actions) {
    const type = String(action?.type || '').toLowerCase();
    if (!type) continue;

    try {
      if (type === 'wait') {
        if (action.selector) {
          await page.locator(action.selector).first().waitFor({ state: 'visible', timeout: action.timeout || 10000 });
        } else {
          await page.waitForTimeout(action.ms || 500);
        }
        continue;
      }

      if (type === 'click' && action.selector) {
        await page.locator(action.selector).first().click({ timeout: action.timeout || 8000 });
        continue;
      }

      if (type === 'fill' && action.selector) {
        await page.locator(action.selector).first().fill(String(action.value || ''), { timeout: action.timeout || 8000 });
        continue;
      }

      if (type === 'select' && action.selector) {
        await page.locator(action.selector).first().selectOption(String(action.value || ''), { timeout: action.timeout || 8000 });
        continue;
      }
    } catch (err) {
      if (action.optional) continue;
      throw new Error(`Action failed (${type} ${action.selector || ''}): ${err.message}`);
    }
  }
}

async function captureManual(config) {
  const browser = await chromium.launch({ headless: browserHeadless });
  const output = {
    generated_at: nowIso(),
    base_url: baseUrl,
    title: config.title || 'Product Manual',
    subtitle: config.subtitle || '',
    scenarios: [],
  };

  try {
    for (const viewport of config.viewports) {
      const context = await browser.newContext({
        viewport: { width: Number(viewport.width), height: Number(viewport.height) },
        locale: 'en-US',
      });

      const page = await context.newPage();
      await login(page);

      for (const scenario of config.scenarios) {
        const scenarioId = slugify(scenario.id || scenario.title);
        const viewportId = slugify(viewport.id || `${viewport.width}x${viewport.height}`);

        await page.goto(`${baseUrl}${scenario.path}`, { waitUntil: 'networkidle' });

        if (scenario.waitFor) {
          await page.locator(scenario.waitFor).first().waitFor({ state: 'visible', timeout: 12000 });
        }

        await runActions(page, scenario.actions || []);
        await applyMarketingPolish(page, scenario);
        await page.waitForTimeout(350);

        const dismissedCookie = await tryClick(page, "button:has-text('Accept')");
        if (dismissedCookie) {
          await page.waitForTimeout(250);
        }

        await applyMasks(page, config.maskSelectors || []);

        const shotName = `${scenarioId}-${viewportId}.png`;
        const shotAbsPath = path.join(screenshotsDir, shotName);

        if (scenario.targetSelector) {
          await page.locator(scenario.targetSelector).first().screenshot({ path: shotAbsPath });
        } else {
          await page.screenshot({ path: shotAbsPath, fullPage: true });
        }

        let entry = output.scenarios.find((s) => s.id === scenarioId);
        if (!entry) {
          entry = {
            id: scenarioId,
            title: scenario.title || scenario.id,
            description: scenario.description || '',
            path: scenario.path,
            shots: [],
          };
          output.scenarios.push(entry);
        }

        entry.shots.push({
          viewport_id: viewportId,
          viewport_label: viewport.label || viewportId,
          file: `screenshots/${shotName}`,
          captured_at: nowIso(),
        });
      }

      await context.close();
    }
  } finally {
    await browser.close();
  }

  await fs.writeFile(manifestFile, JSON.stringify(output, null, 2), 'utf8');
  return output;
}

async function readManifest() {
  const raw = await fs.readFile(manifestFile, 'utf8');
  return JSON.parse(raw);
}

function buildMarkdown(manifest) {
  const lines = [];
  lines.push(`# ${manifest.title || 'Product Manual'}`);
  lines.push('');

  if (manifest.subtitle) {
    lines.push(`> ${manifest.subtitle}`);
    lines.push('');
  }

  lines.push(`Generated at: ${manifest.generated_at}`);
  lines.push(`Base URL: ${manifest.base_url}`);
  lines.push('');
  lines.push('## Feature Walkthrough');
  lines.push('');

  for (const scenario of manifest.scenarios || []) {
    lines.push(`### ${scenario.title}`);
    lines.push('');
    if (scenario.description) {
      lines.push(scenario.description);
      lines.push('');
    }
    lines.push(`Path: ${scenario.path}`);
    lines.push('');

    for (const shot of scenario.shots || []) {
      lines.push(`**${shot.viewport_label}**`);
      lines.push('');
      lines.push(`![${scenario.title} - ${shot.viewport_label}](./${shot.file})`);
      lines.push('');
    }
  }

  return `${lines.join('\n')}\n`;
}

async function main() {
  await ensureDirs();
  const config = await readScenariosConfig();
  await ensureCredentials();

  if (shouldCapture) {
    console.log('[manual] Capturing screenshots...');
    await captureManual(config);
    console.log(`[manual] Manifest written: ${manifestFile}`);
  }

  if (shouldBuild) {
    console.log('[manual] Building markdown manual...');
    const manifest = await readManifest();
    const markdown = buildMarkdown(manifest);
    await fs.writeFile(markdownFile, markdown, 'utf8');
    console.log(`[manual] Markdown written: ${markdownFile}`);
  }

  console.log('[manual] Done.');
}

main().catch((err) => {
  console.error(`[manual] Failed: ${err.message}`);
  process.exit(1);
});
