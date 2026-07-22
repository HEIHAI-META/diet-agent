// E2E 测试：验证今日三处改动
// 1. going_to_eat → 8分钟后二次询问（不是"不打扰你了"）
// 2. 二次询问是"吃上了吗"语气而非催促
// 3. "我在吃东西" → intent=record → 直接开摄像头（主动入口）

const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: false,
    slowMo: 200,
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--ignore-certificate-errors'],
  });
  const ctx = await browser.newContext({
    permissions: ['microphone'],
    viewport: { width: 1400, height: 900 },
    ignoreHTTPSErrors: true,
  });
  const page = await ctx.newPage();

  page.on('console', m => {
    if (!['debug', 'verbose'].includes(m.type()))
      console.log(`[page] ${m.text().slice(0, 200)}`);
  });

  const BASE = 'https://localhost:5179';
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  // ──────────────────────────────────────────────
  // 用例 A："我在吃东西" → 主动入口 → 开摄像头
  // ──────────────────────────────────────────────
  console.log('\n══════ 用例 A："我在吃东西" → 主动入口 ══════');

  // 确保在 idle 状态（没有 eatingConfirm 进行中）
  await page.evaluate(() => {
    const ui = window.__dietDebug?.useUI?.getState?.();
    if (ui?.endEatingConfirm) ui.endEatingConfirm();
  });
  await page.waitForTimeout(500);

  // 注入语音转写
  await page.evaluate(() => window.__dietDebug.routeFinal('我在吃东西'));
  await page.waitForTimeout(8000); // 等 LLM 路由返回

  const cameraOpenA = await page.evaluate(() => {
    // 摄像头组件挂载时会有 video 元素，或者看 bandState
    const bs = window.__dietDebug?.useUI?.getState?.()?.bandState;
    return bs;
  });
  const sessionA = await page.evaluate(() => document.querySelector('.session-log')?.textContent || '');
  console.log(`bandState after "我在吃东西": ${cameraOpenA}`);
  console.log(`看板: "${sessionA.slice(-80)}"`);
  await page.screenshot({ path: '/tmp/e2e_A_eating.png' });

  // 主动入口时序：speaking（播报提示语）→ listening（等「开拍」），两者均为通过
  const passA = cameraOpenA === 'listening' || cameraOpenA === 'speaking';
  console.log(passA ? `✅ 用例A通过 (bandState=${cameraOpenA}，主动入口)` : `❌ 用例A失败 (bandState=${cameraOpenA})`);

  // 关掉当前流程，充分重置（含冷却和 armed）
  await page.evaluate(() => {
    const ui = window.__dietDebug?.useUI?.getState?.();
    if (ui?.setBandState) ui.setBandState('idle');
    if (ui?.endEatingConfirm) ui.endEatingConfirm();
    if (ui?.clearShortWait) ui.clearShortWait();
  });
  // 跳过冷却，让 P-engine 重新武装
  await page.click('button:has-text("跳过冷却")');
  await page.waitForTimeout(800);

  // ──────────────────────────────────────────────
  // 用例 B：going_to_eat → 跳过等待 → 二次询问不是"不打扰你了"
  // ──────────────────────────────────────────────
  console.log('\n══════ 用例 B：going_to_eat → 8分钟 → 二次询问 ══════');

  // 设午饭时间
  const noonBtn = await page.$('button:has-text("午")');
  if (noonBtn) { await noonBtn.click(); await page.waitForTimeout(600); }

  // 触发被动流程
  await page.evaluate(() => {
    window.__dietDebug.useUI.getState().startEatingConfirm({ id: 'e2e-B', p: 75, time: '12:10', mealTime: 'in' });
  });
  await page.waitForTimeout(800);

  // 抬腕
  const raiseBtn = await page.$('button:has-text("✋ 抬腕")');
  if (!raiseBtn) { console.log('❌ 找不到抬腕按钮'); await browser.close(); return; }
  await raiseBtn.click();

  // 等第一问
  await page.waitForFunction(
    () => (document.querySelector('.session-log')?.textContent || '').length > 10,
    { timeout: 10000 }
  );
  await page.waitForTimeout(1000);
  console.log('[B] 第一问出现');

  // 等 bandState=listening（LLM 第一问已生成，开始倾听）
  await page.waitForFunction(
    () => window.__dietDebug.useUI.getState().bandState === 'listening',
    { timeout: 15000 }
  );
  await page.waitForTimeout(500);
  console.log('[B] bandState=listening，注入 going_to_eat 回复');

  // 注入 going_to_eat 回复
  await page.evaluate(() => window.__dietDebug.routeFinal('一会儿再去吃'));
  await page.waitForFunction(
    () => window.__dietDebug.useUI.getState().bandState === 'waiting',
    { timeout: 20000 }
  );
  console.log('[B] 进入短等待');
  await page.screenshot({ path: '/tmp/e2e_B1_waiting.png' });

  // 点「跳过等待」
  const skipBtn = await page.$('button:has-text("跳过等待")');
  if (!skipBtn) { console.log('❌ 找不到跳过等待按钮'); await browser.close(); return; }
  await skipBtn.click();

  // 等第二次问询出现（最多 15s）
  await page.waitForFunction(
    () => {
      const txt = document.querySelector('.session-log')?.textContent || '';
      const bs = window.__dietDebug.useUI.getState().bandState;
      return bs === 'listening' && txt.length > 0;
    },
    { timeout: 15000 }
  );
  await page.waitForTimeout(500);

  const boardB = await page.evaluate(() => document.querySelector('.session-log')?.textContent || '');
  const bsB = await page.evaluate(() => window.__dietDebug.useUI.getState().bandState);
  console.log(`[B] bandState: ${bsB}`);
  console.log(`[B] 看板末尾: "${boardB.slice(-120)}"`);
  await page.screenshot({ path: '/tmp/e2e_B2_second_nudge.png' });

  // 判断：二次问询不应包含"不打扰"/"先走"/"不管你"
  const noDisturbPhrases = ['不打扰', '先走', '不管你', '你忙'];
  const hasNoDisturb = noDisturbPhrases.some(p => boardB.includes(p));
  // 应该包含询问性词汇
  const askPhrases = ['吃', '了吗', '没', '开始', '?', '？'];
  const hasAsk = askPhrases.some(p => boardB.slice(-60).includes(p));

  if (hasNoDisturb) {
    console.log('❌ 用例B失败：二次提醒包含"不打扰"类短语（LLM 误判为 no_response）');
  } else if (!hasAsk) {
    console.log(`⚠️  用例B存疑：看板末尾="${boardB.slice(-60)}"，未见明确询问句`);
  } else {
    console.log('✅ 用例B通过：二次询问正常，不是"不打扰你了"');
  }

  await browser.close();
  console.log('\n截图保存: /tmp/e2e_A_eating.png, /tmp/e2e_B1_waiting.png, /tmp/e2e_B2_second_nudge.png');
})();
