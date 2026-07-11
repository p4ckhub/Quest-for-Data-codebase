// Generic end-to-end driver: plays the real Electron app with Playwright.
// Creates a character, then walks every zone up to --max-zone, completing
// each lesson with its reference solution (via Monaco + CAST) and fighting
// each zone boss to victory. Exits 0 only if everything actually happened.
//
// Usage: xvfb-run -a npx ts-node scripts/e2e-drive.ts [--max-zone N] [--class warrior]

import { _electron as electron, ElectronApplication, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

const PROJECT_ROOT = path.join(__dirname, '..');

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const MAX_ZONE = parseInt(arg('max-zone', '2'), 10);
const PLAYER_CLASS = arg('class', 'warrior');
const PLAYER_NAME = 'AcceptBot';

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function setMonaco(page: Page, code: string) {
  await page.waitForFunction(() => (window as any).monaco?.editor?.getModels()?.length > 0, undefined, { timeout: 15000 });
  await page.evaluate((value) => {
    const models = (window as any).monaco.editor.getModels();
    models[models.length - 1].setValue(value);
  }, code);
}

async function completeLesson(page: Page, zoneId: string, lessonId: string): Promise<boolean> {
  // Fetch the substituted reference solution through the app's own IPC
  const solution: string | null = await page.evaluate(async ({ lessonId, cls }) => {
    const r = await (window as any).gameapi.lessons.load(lessonId, cls);
    return r?.success ? (r.lesson.solution ?? null) : null;
  }, { lessonId, cls: PLAYER_CLASS });

  if (!solution) {
    check(`lesson ${lessonId}: has solution field`, false, 'no solution in YAML');
    return false;
  }

  await setMonaco(page, solution);
  await page.getByRole('button', { name: 'CAST', exact: true }).click();

  try {
    await page.getByText('Objective complete', { exact: false }).waitFor({ timeout: 30000 });
    return true;
  } catch {
    const consoleText = await page.locator('.console-output').textContent().catch(() => '');
    check(`lesson ${lessonId}: passes with reference solution`, false, (consoleText ?? '').slice(0, 300));
    return false;
  }
}

async function main() {
  const env = { ...process.env } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;

  // Fresh save sandbox so slot 1 is always empty and real saves are untouched
  const userDataDir = fs.mkdtempSync('/tmp/quest-e2e-');
  env.QUEST_USER_DATA = userDataDir;

  const app: ElectronApplication = await electron.launch({
    args: ['--no-sandbox', path.join(PROJECT_ROOT, 'dist/app/main.js')],
    env,
  });
  const page: Page = await app.firstWindow();
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('  [renderer error]', msg.text().slice(0, 200));
  });

  try {
    // --- Title → character creation → the sandpit (PHASE1.5 §2: the world
    // map must be out of reach until the mandatory sandpit lessons are done)
    await page.getByRole('button', { name: 'New Game' }).click({ timeout: 15000 });
    await page.getByPlaceholder('Enter your name').fill(PLAYER_NAME);
    await page.locator('.class-card', { hasText: new RegExp(PLAYER_CLASS, 'i') }).first().click();
    await page.getByRole('button', { name: 'Create Character' }).click();
    await page.locator('.sandpit-screen').waitFor({ timeout: 15000 });
    check('character created, wakes in the sandpit', true);

    const preSave = await page.evaluate(async () => {
      const r = await (window as any).gameapi.saves.load(1);
      return r?.success ? r.data : null;
    });
    check('fresh champion starts at level 0', preSave?.player?.level === 0, `level=${preSave?.player?.level}`);
    check('world map gated before mandatory lessons',
      !(await page.getByText('World Map').first().isVisible().catch(() => false)));

    // --- Drive the mandatory sandpit lessons in order
    const sandpit: any = await page.evaluate(async () => {
      const r = await (window as any).gameapi.content.get('sandpit');
      return r?.sandpit ?? null;
    });
    check('sandpit manifest loaded', !!sandpit && sandpit.lessons.length > 0, `lessons=${sandpit?.lessons?.length}`);
    const mandatory = (sandpit?.lessons ?? []).filter((l: any) => l.mandatory);
    check('sandpit has mandatory lessons', mandatory.length >= 2, `mandatory=${mandatory.length}`);

    for (const lesson of mandatory) {
      await page.getByRole('button', { name: new RegExp(lesson.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).click();
      const ok = await completeLesson(page, 'sandpit', lesson.id);
      check(`sandpit: mandatory lesson ${lesson.id} passed`, ok);
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await page.locator('.sandpit-screen').waitFor({ timeout: 10000 });
    }

    // --- The ceremony of the stone: level up TO 1 + the rock, really saved
    await page.locator('.sandpit-ceremony').waitFor({ timeout: 10000 });
    const postSave = await page.evaluate(async () => {
      const r = await (window as any).gameapi.saves.load(1);
      return r?.success ? r.data : null;
    });
    check('mandatory completion levels player up TO 1', postSave?.player?.level === 1, `level=${postSave?.player?.level}`);
    check('smooth river stone granted and saved',
      (postSave?.inventory ?? []).some((i: any) => i.item_id === 'smooth_river_stone'),
      JSON.stringify(postSave?.inventory));

    // --- Optional sandpit lessons are zero-stakes: completing one changes nothing
    const optional = (sandpit?.lessons ?? []).filter((l: any) => !l.mandatory);
    if (optional.length > 0) {
      const lesson = optional[0];
      await page.getByRole('button', { name: new RegExp(lesson.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).click();
      const ok = await completeLesson(page, 'sandpit', lesson.id);
      check(`sandpit: optional lesson ${lesson.id} passes`, ok);
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await page.locator('.sandpit-screen').waitFor({ timeout: 10000 });
      const zeroStakes = await page.evaluate(async () => {
        const r = await (window as any).gameapi.saves.load(1);
        return r?.success ? r.data : null;
      });
      const untouched =
        JSON.stringify(zeroStakes?.zones?.sandpit?.lessons?.[lesson.id] ?? null) === 'null' &&
        zeroStakes?.player?.xp === postSave?.player?.xp &&
        (zeroStakes?.inventory ?? []).length === (postSave?.inventory ?? []).length;
      check('optional sandpit lesson is zero-stakes (save untouched)', untouched);
    }

    // --- Depart for the realm
    await page.getByRole('button', { name: /Depart for the realm/ }).click();
    await page.getByText('World Map').first().waitFor({ timeout: 15000 });
    check('world map reached after the sandpit', true);

    // --- Read the zone graph through the app itself
    const zones: any[] = await page.evaluate(async () => {
      const r = await (window as any).gameapi.content.get('zoneGraph');
      return r?.graph?.act1?.zones ?? [];
    });
    check('zone graph loaded', zones.length > 0, `zones=${zones.length}`);

    for (const zone of zones) {
      if (zone.number > MAX_ZONE) break;
      if (zone.lessons.length === 0) {
        check(`zone ${zone.number} (${zone.id}): has lessons`, false, 'zone empty');
        continue;
      }

      // The accordion remembers the current zone across lesson visits
      // (WorldMapScreen seeds openZone from currentZoneId), so it may already
      // be open when we return — only click the zone header if the target
      // inside it is not visible, otherwise the click would close it.
      const zoneToggle = page.getByRole('button', { name: new RegExp(`Zone ${zone.number}:`, 'i') });
      const ensureZoneOpen = async (target: ReturnType<typeof page.locator>) => {
        await page.locator('.world-map-screen').waitFor({ timeout: 15000 });
        if (!(await target.isVisible().catch(() => false))) await zoneToggle.click();
      };

      for (const lesson of zone.lessons) {
        const lessonButton = page.getByRole('button', { name: new RegExp(lesson.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') });
        await ensureZoneOpen(lessonButton);
        await lessonButton.click();
        const ok = await completeLesson(page, zone.id, lesson.id);
        if (ok) check(`zone ${zone.number}: lesson ${lesson.id} passed`, true);
        await page.getByRole('button', { name: 'Back', exact: true }).click();
      }

      // Boss fight, if the zone has one
      if (zone.boss) {
        const bossButton = page.locator('.boss-entry');
        await ensureZoneOpen(bossButton);
        await bossButton.waitFor({ timeout: 5000 });
        const disabled = await bossButton.isDisabled();
        check(`zone ${zone.number}: boss unlocked after lessons`, !disabled);
        if (!disabled) {
          await bossButton.click();
          // Fight: CAST until a winner
          for (let turn = 0; turn < 30; turn++) {
            const claim = page.getByRole('button', { name: 'Claim Victory' });
            if (await claim.isVisible().catch(() => false)) break;
            const retreat = page.getByRole('button', { name: 'Retreat and Recover' });
            if (await retreat.isVisible().catch(() => false)) break;
            const cast = page.locator('button.cast-btn').first();
            await cast.click({ timeout: 10000 }).catch(() => null);
            await page.waitForTimeout(1500);
          }
          const won = await page.getByRole('button', { name: 'Claim Victory' }).isVisible().catch(() => false);
          if (!won) {
            const err = await page.locator('.combat-error').textContent().catch(() => null);
            const logText = await page.locator('.combat-log').textContent().catch(() => null);
            const body = await page.locator('body').innerText().catch(() => null);
            console.log('  [boss debug] error:', err, '| log:', (logText ?? '').slice(0, 300), '| body:', (body ?? '').slice(0, 400));
          }
          check(`zone ${zone.number}: boss defeated`, won);
          if (won) await page.getByRole('button', { name: 'Claim Victory' }).click();
          else await page.getByRole('button', { name: /Retreat|Flee/ }).click().catch(() => null);
        }
      }
    }

    // --- Save persistence: reload through the app's IPC and verify structure
    const save = await page.evaluate(async () => {
      const r = await (window as any).gameapi.saves.load(1);
      return r?.success ? r.data : null;
    });
    check('save exists in slot 1', !!save);
    if (save) {
      check('save has XP > 0', save.player.xp > 0, `xp=${save.player.xp}`);
      const passedCount = Object.values(save.zones as Record<string, any>).reduce(
        (n: number, z: any) => n + Object.values(z.lessons ?? {}).filter((l: any) => l.status === 'passed').length, 0);
      check('save records passed lessons', passedCount > 0, `passed=${passedCount}`);
      if (MAX_ZONE >= 2) {
        check('spellbook has forged spell with source', (save.spellbook ?? []).some((s: any) => s.source?.length > 0));
      }
    }
  } finally {
    await app.close().catch(() => null);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }

  console.log(failures === 0 ? '\nE2E DRIVE: ALL CHECKS PASSED' : `\nE2E DRIVE: ${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('E2E driver crashed:', e);
  process.exit(1);
});
