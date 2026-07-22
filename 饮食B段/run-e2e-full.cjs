const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const ctx = await browser.newContext({ permissions: ['microphone'], viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();

  page.on('console', m => {
    if (!['debug','verbose'].includes(m.type())) console.log(`[page/${m.type()}] ${m.text().slice(0,150)}`);
  });

  await page.goto('http://localhost:5173');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  // 设午饭时间
  await page.click('button:has-text("午 12:10")');
  await page.waitForTimeout(600);

  // 触发 startEatingConfirm
  await page.evaluate(() => {
    window.__dietDebug.useUI.getState().startEatingConfirm({ id: 'e2e-8min', p: 75, time: '12:10', mealTime: 'in' });
    console.log('[e2e] startEatingConfirm fired');
  });
  await page.waitForTimeout(800);

  // 抬腕
  await page.click('button:has-text("✋ 抬腕")');

  // 等第一问
  await page.waitForFunction(() =>
    document.querySelector('.session-log')?.textContent?.includes('在吃东西吗'),
    { timeout: 8000 }
  );
  console.log('[e2e] 第一问出现');
  await page.screenshot({ path: '/tmp/e2e_1_first_q.png' });

  // 孩子回复 going_to_eat
  await page.evaluate(() => window.__dietDebug.routeFinal('一会儿再去吃'));

  // 等 LLM 回复 + bandState=waiting
  await page.waitForFunction(() =>
    window.__dietDebug.useUI.getState().bandState === 'waiting',
    { timeout: 20000 }
  );
  const t0 = Date.now();
  console.log('[e2e] 进入短等待 (bandState=waiting)，8 分钟计时开始');
  await page.screenshot({ path: '/tmp/e2e_2_shortwait.png' });

  const boardAtStart = await page.evaluate(() => document.querySelector('.session-log')?.textContent || '');
  console.log('[e2e] 短等待开始时看板:', boardAtStart);

  // 每隔 30s 检查一次，确认短等待期间看板无变化、bandState 仍是 waiting
  // 同时注入噪音模拟 ASR 乱转写
  const noiseTexts = ['嗯嗯', '啊', '今天天气真好', '妈妈', ''];
  let noiseIdx = 0;
  let earlyChange = false;
  const WAIT_MS = 8 * 60 * 1000; // 8 分钟
  const CHECK_INTERVAL = 30 * 1000; // 每 30s 检查

  for (let elapsed = 0; elapsed < WAIT_MS - CHECK_INTERVAL; elapsed += CHECK_INTERVAL) {
    await page.waitForTimeout(CHECK_INTERVAL);
    const elapsedSec = Math.round((Date.now() - t0) / 1000);

    // 注入噪音
    const noise = noiseTexts[noiseIdx % noiseTexts.length];
    noiseIdx++;
    if (noise) await page.evaluate((t) => window.__dietDebug.routeFinal(t), noise);

    const board = await page.evaluate(() => document.querySelector('.session-log')?.textContent || '');
    const bs = await page.evaluate(() => window.__dietDebug.useUI.getState().bandState);
    console.log(`[e2e] ${elapsedSec}s: bandState=${bs}, 看板末尾="${board.slice(-40)}"`);

    if (board !== boardAtStart) {
      earlyChange = true;
      console.log(`❌ 短等待期间看板变化！新增: "${board.replace(boardAtStart,'').trim()}"`);
      break;
    }
    if (bs !== 'waiting') {
      earlyChange = true;
      console.log(`❌ bandState 意外变为 ${bs}，不再是 waiting`);
      break;
    }
  }

  if (earlyChange) {
    await page.screenshot({ path: '/tmp/e2e_FAIL.png' });
    await browser.close();
    return;
  }

  // 等最后一段到 8 分钟，然后等第二次提醒出现
  const remaining = WAIT_MS - (Date.now() - t0);
  if (remaining > 0) {
    console.log(`[e2e] 等最后 ${Math.round(remaining/1000)}s...`);
    await page.waitForTimeout(remaining + 5000); // 多等 5s buffer
  }

  // 等第二次提醒
  await page.waitForFunction(() => {
    const txt = document.querySelector('.session-log')?.textContent || '';
    return txt.includes('开始吃了吗') || txt.includes('拍一下') || txt.includes('开始吃');
  }, { timeout: 30000 });

  const elapsed8 = Math.round((Date.now() - t0) / 1000);
  const boardAfter = await page.evaluate(() => document.querySelector('.session-log')?.textContent || '');
  const bs8 = await page.evaluate(() => window.__dietDebug.useUI.getState().bandState);

  console.log(`\n✅ 第二次提醒在 ${elapsed8}s (${Math.round(elapsed8/60)}分${elapsed8%60}秒) 后出现`);
  console.log(`bandState: ${bs8}`);
  console.log(`看板末尾: "${boardAfter.slice(-80)}"`);
  await page.screenshot({ path: '/tmp/e2e_3_second_nudge.png' });

  await browser.close();
})();
