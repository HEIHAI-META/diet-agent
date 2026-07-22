const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 300 });
  const ctx = await browser.newContext({ permissions: ['microphone'], viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();

  const pageLogs = [];
  page.on('console', m => {
    const t = m.text().slice(0, 200);
    pageLogs.push(`[${m.type()}] ${t}`);
    if (!['debug','verbose'].includes(m.type())) console.log(`[${m.type()}] ${t}`);
  });

  await page.goto('http://localhost:5173');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  await page.click('button:has-text("午 12:10")');
  await page.waitForTimeout(600);

  await page.evaluate(() => {
    window.__dietDebug.useUI.getState().startEatingConfirm({ id: 'e2e-002', p: 75, time: '12:10', mealTime: 'in' });
  });
  await page.waitForTimeout(800);

  await page.click('button:has-text("✋ 抬腕")');

  await page.waitForFunction(() =>
    document.querySelector('.session-log')?.textContent?.includes('在吃东西吗'),
    { timeout: 8000 }
  );
  console.log('=== 第一问出现，REPLY_WAIT=10s 开始计时 ===');

  // 注入回复，观察 bandState 和 confirmCtx 变化
  const t0 = Date.now();
  await page.evaluate(() => {
    const orig = window.__dietDebug.routeFinal;
    window.__dietDebug.routeFinalWrapped = async (text) => {
      console.log('[e2e-route] routeFinal called with:', JSON.stringify(text));
      const bs = window.__dietDebug.useUI.getState().bandState;
      const ctx = 'confirmCtx via window unknown'; 
      console.log('[e2e-route] bandState=', bs);
      await orig(text);
      console.log('[e2e-route] routeFinal done for:', JSON.stringify(text));
    };
  });

  await page.evaluate(() => window.__dietDebug.routeFinalWrapped('一会儿再去吃'));
  console.log(`=== 注入回复，耗时 ${Date.now() - t0}ms ===`);

  // 监控 30s 内的对话看板变化
  let lastBoard = '';
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(1000);
    const board = await page.evaluate(() => document.querySelector('.session-log')?.textContent || '');
    const bs = await page.evaluate(() => window.__dietDebug.useUI.getState().bandState);
    if (board !== lastBoard) {
      console.log(`[${i+1}s] 看板变化: "${board.slice(-60)}" | bandState=${bs}`);
      lastBoard = board;
    }
  }

  const finalBoard = await page.evaluate(() => document.querySelector('.session-log')?.textContent || '');
  const finalBs = await page.evaluate(() => window.__dietDebug.useUI.getState().bandState);
  console.log('\n=== 最终状态 ===');
  console.log('看板:', finalBoard);
  console.log('bandState:', finalBs);

  await page.screenshot({ path: '/tmp/s_final.png' });
  await browser.close();
})();
