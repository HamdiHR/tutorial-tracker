const { chromium, ok, U, done } = require('./helpers.cjs');
(async()=>{const b=await chromium.launch();const errs=[];
const p=await (await b.newContext({viewport:{width:1300,height:900}})).newPage();p.on('pageerror',e=>errs.push(String(e)));
await p.goto(U+'#/timeline');await p.waitForSelector('.rm-tk');
const ids=await p.locator('.rm-tk .tid').allTextContents();
await p.locator('.rm-tk .rm-label').nth(1).click();await p.waitForSelector('aside.drawer h2');
const sel=p.locator('select[aria-label="Add a dependency"]');await sel.waitFor();
const opts=await sel.locator('option').allTextContents();ok('options listed',opts.length>2,opts[1]);
await sel.selectOption({index:1});await p.waitForSelector('.dep-list li');ok('dependency added',true,(await p.locator('.dep-list li').innerText()).replace(/\s+/g,' '));
await p.keyboard.press('Escape');await p.waitForTimeout(500);
ok('arrow path drawn',await p.locator('svg.rm-deps path.rm-dep').count()>=1);

await p.reload();await p.waitForSelector('.rm-tk');ok('persisted',await p.locator('svg.rm-deps path.rm-dep').count()>=1);
done(errs);await b.close();})().catch(e=>{console.log('FAIL',e.message.slice(0,300));process.exit(1)});
