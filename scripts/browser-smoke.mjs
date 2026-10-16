// Install playwright-core in a writable temporary prefix; set PLAYWRIGHT_MODULE.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server/app.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const dir = await mkdtemp(path.join(tmpdir(), 'team-browser-'));
const previewPassword = process.env.SMOKE_PREVIEW === 'true' ? randomBytes(32).toString('base64url') : undefined;
const server = createApp({ previewPassword, dbPath: path.join(dir, 'test.sqlite'), webRoot: path.resolve('web/dist') });
let browser;
try {
 server.listen(0, '127.0.0.1'); await once(server, 'listening');
 const base = `http://127.0.0.1:${server.address().port}`;
 browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless:true, args:['--no-sandbox']});
 if (previewPassword) assert.equal((await fetch(base)).status, 401);
 const page = await browser.newPage(previewPassword ? { httpCredentials: { username: 'preview', password: previewPassword } } : {});
 const errors=[]; page.on('pageerror', e=>errors.push(e.message));
 await page.goto(base);
 await page.getByText('مساحة لإنجازك القادم', {exact:true}).waitFor();
 assert.equal(await page.locator('html').getAttribute('dir'), 'rtl');
 await page.getByLabel('ما المهمة التالية؟').fill('اختبار المتصفح الحقيقي');
 await page.getByRole('button', {name:'+ إضافة مهمة',exact:true}).click();
 await page.getByText('اختبار المتصفح الحقيقي',{exact:true}).waitFor();
 // Controlled checkbox updates after the real PATCH completes.
 await page.getByRole('checkbox').click();
 await page.waitForFunction(()=>document.querySelector('li.done'));
 await page.reload();
 await page.getByRole('checkbox').waitFor();
 assert.equal(await page.getByRole('checkbox').isChecked(),true);
 await page.setViewportSize({width:390,height:844});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile horizontal overflow');
 await page.getByRole('button',{name:'حذف المهمة: اختبار المتصفح الحقيقي',exact:true}).click();
 await page.getByText('مساحة لإنجازك القادم',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);
 console.log(`PASS Chromium${previewPassword ? ' authenticated preview' : ''}: Arabic RTL, create, complete, reload persistence, delete, mobile overflow, zero page errors`);
} finally {
 await browser?.close();
 if(server.listening) await new Promise(resolve=>server.close(resolve));
 await rm(dir,{recursive:true,force:true});
}
