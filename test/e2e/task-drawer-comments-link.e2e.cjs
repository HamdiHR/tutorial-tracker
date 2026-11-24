const { chromium, ok, U, done } = require('./helpers.cjs');
(async()=>{const b=await chromium.launch();const errs=[];
const p=await (await b.newContext({viewport:{width:1300,height:900}})).newPage();p.on('pageerror',e=>errs.push(String(e)));
await p.goto(U+'#/board');await p.waitForSelector('.bcard');await p.locator('.bcard').first().click();await p.waitForSelector('aside.drawer h2');
const tid=new URL(p.url()).searchParams.get('t');ok('url gets ?t=',!!tid,tid);
await p.fill('textarea[aria-label="New comment"]','first note');await p.click('text=Add comment');await p.waitForSelector('.cm');
await p.selectOption('select[aria-label="Comment as"]','ai');await p.fill('textarea[aria-label="New comment"]','done by claude');await p.click('text=Add comment');await p.waitForFunction(()=>document.querySelectorAll('.cm').length===2);
ok('two comments, ai styled',await p.locator('.cm.ai').count()===1);
// change another field, comments must survive
await p.locator('aside.drawer').getByRole('button',{name:/high|urgent|P1|!/i}).first().click().catch(()=>{});
await p.waitForTimeout(1200);
await p.goto(U+'?t='+encodeURIComponent(tid)+'#/board');await p.waitForSelector('aside.drawer h2');
ok('deep link opens drawer',true);ok('comments persisted',await p.locator('.cm').count()===2);
await p.keyboard.press('Escape');await p.waitForTimeout(400);ok('?t removed on close',!new URL(p.url()).searchParams.get('t'));
await p.locator('.bcard').first().click();await p.waitForSelector('.cm');await p.locator('.cm button[aria-label="Delete comment"]').first().click();await p.waitForFunction(()=>document.querySelectorAll('.cm').length===1);ok('delete comment',true);
done(errs);await b.close();})().catch(e=>{console.log('FAIL',e.message.slice(0,300));process.exit(1)});
