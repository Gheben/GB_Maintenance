import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

const args = new Set(process.argv.slice(2));
const shouldCapture = args.has('--capture') || args.has('--all') || (!args.has('--build') && !args.has('--capture'));
const shouldBuild = args.has('--build') || args.has('--all') || (!args.has('--build') && !args.has('--capture'));

const scriptDir = path.dirname(new URL(import.meta.url).pathname);
const frontendRoot = path.resolve(scriptDir, '..', '..');
const repoRoot = path.resolve(frontendRoot, '..');

const scenariosFile = path.join(scriptDir, 'scenarios.json');
const docsRoot = path.join(repoRoot, 'docs', 'manual');
const screenshotsDir = path.join(docsRoot, 'screenshots');
const manifestFile = path.join(docsRoot, 'manifest.json');
const markdownFile = path.join(docsRoot, 'README.md');

const baseUrl = process.env.MANUAL_BASE_URL || 'http://localhost:5173';
const username = process.env.MANUAL_USERNAME || 'sysadmin';
const password = process.env.MANUAL_PASSWORD || 'sysadmin';
const browserHeadless = process.env.MANUAL_HEADLESS !== 'false';

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

  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.locator("button[type='submit']").click();

  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 });
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
}

async function runActions(page, actions = []) {
  for (const action of actions) {
    const type = String(action?.type || '').toLowerCase();
    if (!type) continue;

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
