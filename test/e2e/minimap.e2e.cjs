const { chromium, ok, U, done } = require('./helpers.cjs');
(async()=>{const b=await chromium.launch();const errs=[];
const p=await (await b.newContext({viewport:{width:1300,height:900}})).newPage();p.on('pageerror',e=>errs.push(String(e)));
await p.goto(U+'#/timeline');await p.waitForSelector('.rm-mini');
ok('minimap visible',await p.locator('.rm-mini').isVisible());
const w=await p.locator('.rm-mini-view').evaluate(e=>e.style.width);ok('frame width set',parseFloat(w)>0&&parseFloat(w)<100,w);
const before=await p.locator('.rm-scroll').evaluate(e=>e.scrollLeft);
const box=await p.locator('.rm-mini').boundingBox();await p.mouse.click(box.x+box.width*0.9,box.y+10);await p.waitForTimeout(300);
const after=await p.locator('.rm-scroll').evaluate(e=>e.scrollLeft);ok('click scrolls',after>before+100,before+' -> '+after);
const left=parseFloat(await p.locator('.rm-mini-view').evaluate(e=>e.style.left));ok('frame follows',left>50,String(left));
await p.locator('.seg button',{hasText:'Month'}).first().click().catch(()=>{});await p.waitForTimeout(300);
ok('survives zoom',await p.locator('.rm-mini .mm-sp').count()>=1);

done(errs);await b.close();})().catch(e=>{console.log('FAIL',e.message.slice(0,300));process.exit(1)});
