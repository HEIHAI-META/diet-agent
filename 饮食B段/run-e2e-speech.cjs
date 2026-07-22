// E2E：检测是否存在硬编码 + LLM 双重输出
// 路径一：被动流程 eating → 拍照 → applyResult（recordDone 硬编码 + scienceTip LLM）
// 路径二：被动流程 eating → secondYesNo 拒绝 → startVoice → voiceDone（recordVoiceLow 硬编码）

const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 150, args: ['--ignore-certificate-errors'] });
  const ctx = await browser.newContext({ permissions: ['microphone'], viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();

  const speechLog = []; // 记录所有 speak() 调用
  const pushLog = [];   // 记录所有 push('bot',...) 调用

  page.on('console', m => {
    const t = m.text();
    if (!['debug','verbose'].includes(m.type())) console.log(`[page] ${t.slice(0,180)}`);
  });

  await page.goto('https://localhost:5179');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  // 注入语音拦截器，记录所有 speak 调用
  await page.evaluate(() => {
    window.__speechLog = [];
    window.__pushLog = [];
  });

  // 设午饭时间
  const noonBtn = await page.$('button:has-text("午")');
  if (noonBtn) { await noonBtn.click(); await page.waitForTimeout(400); }

  // ══════ 路径一：被动流程 → eating → 拍照 → 高置信正餐 ══════
  console.log('\n══════ 路径一：eating → 拍照 → 高置信正餐记录 ══════');

  await page.evaluate(() => {
    window.__dietDebug.useUI.getState().startEatingConfirm({ id: 'sp-1', p: 75, time: '12:10', mealTime: 'in' });
  });
  await page.waitForTimeout(600);
  await page.click('button:has-text("✋ 抬腕")');

  // 等第一问
  await page.waitForFunction(
    () => window.__dietDebug.useUI.getState().bandState === 'listening',
    { timeout: 12000 }
  );
  await page.waitForTimeout(300);

  // 注入"我在吃饭" → eating
  await page.evaluate(() => window.__dietDebug.routeFinal('我在吃饭'));
  // 等进入 secondYesNo listening
  await page.waitForFunction(
    () => {
      const bs = window.__dietDebug.useUI.getState().bandState;
      const txt = document.querySelector('.session-log')?.textContent || '';
      return bs === 'listening' && txt.includes('拍');
    },
    { timeout: 12000 }
  );
  await page.waitForTimeout(300);
  console.log('[1] 进入 secondYesNo，注入同意拍照');

  // 同意拍照
  await page.evaluate(() => window.__dietDebug.routeFinal('好啊'));
  await page.waitForFunction(
    () => window.__dietDebug.useUI.getState().bandState === 'speaking' ||
          document.querySelector('.session-log')?.textContent?.includes('摄像头'),
    { timeout: 12000 }
  );
  await page.waitForTimeout(500);

  // 截看板快照（拍照引导语出现前）
  const boardBeforePhoto = await page.evaluate(() => document.querySelector('.session-log')?.textContent || '');
  console.log('[1] 拍照前看板:', boardBeforePhoto.slice(-80));
  await page.screenshot({ path: '/tmp/sp1_before_photo.png' });

  // 用文件选择器上传测试图（用 triggerFilePick + 文件输入）
  // 直接注入一张 base64 小图模拟拍照回调
  await page.evaluate(() => {
    // 1x1 红色像素 PNG base64
    const img = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI6QAAAABJRU5ErkJggg==';
    // 直接触发 handlePhoto（通过 __dietDebug 暴露的接口不存在，改用文件选择）
    window.__testPhoto = img;
  });

  // 等 LLM 识别完成（bandState 回到 idle 或 speaking）
  // 用看板变化判断：出现"记下了"或"置信度"说明 applyResult 已执行
  const t0 = Date.now();
  let boardAfter = '';
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(1000);
    boardAfter = await page.evaluate(() => document.querySelector('.session-log')?.textContent || '');
    const bs = await page.evaluate(() => window.__dietDebug.useUI.getState().bandState);
    if (boardAfter !== boardBeforePhoto) {
      console.log(`[1] ${i+1}s 看板变化: "${boardAfter.slice(-100)}" bandState=${bs}`);
      break;
    }
  }

  // 注：路径一需要真实拍照，无法完全自动化。改为直接测路径二。
  console.log('\n[1] 路径一需要真实摄像头，跳过拍照部分，直接重置测路径二\n');

  // 重置
  await page.evaluate(() => {
    const ui = window.__dietDebug.useUI.getState();
    ui.setBandState('idle'); ui.endEatingConfirm();
  });
  await page.click('button:has-text("跳过冷却")');
  await page.waitForTimeout(600);

  // ══════ 路径二：eating → secondYesNo 拒绝 → startVoice → voiceDone ══════
  console.log('══════ 路径二：eating → 拒绝拍照 → 语音补录 ══════');

  await page.evaluate(() => {
    window.__dietDebug.useUI.getState().startEatingConfirm({ id: 'sp-2', p: 75, time: '12:10', mealTime: 'in' });
  });
  await page.waitForTimeout(600);
  await page.click('button:has-text("✋ 抬腕")');

  await page.waitForFunction(
    () => window.__dietDebug.useUI.getState().bandState === 'listening',
    { timeout: 12000 }
  );
  await page.waitForTimeout(300);

  await page.evaluate(() => window.__dietDebug.routeFinal('我在吃饭'));
  await page.waitForFunction(
    () => {
      const bs = window.__dietDebug.useUI.getState().bandState;
      const txt = document.querySelector('.session-log')?.textContent || '';
      return bs === 'listening' && txt.includes('拍');
    },
    { timeout: 12000 }
  );
  await page.waitForTimeout(300);
  console.log('[2] secondYesNo，注入拒绝拍照');

  const boardBefore2 = await page.evaluate(() => document.querySelector('.session-log')?.textContent || '');

  // 拒绝拍照
  await page.evaluate(() => window.__dietDebug.routeFinal('不想拍'));
  // 等进入 listening（语音补录阶段）
  await page.waitForFunction(
    () => {
      const bs = window.__dietDebug.useUI.getState().bandState;
      const txt = document.querySelector('.session-log')?.textContent || '';
      // 看板有新内容且在 listening
      return bs === 'listening';
    },
    { timeout: 12000 }
  );
  await page.waitForTimeout(1000);

  const boardAfter2 = await page.evaluate(() => document.querySelector('.session-log')?.textContent || '');
  const bs2 = await page.evaluate(() => window.__dietDebug.useUI.getState().bandState);
  const newContent2 = boardAfter2.replace(boardBefore2, '').trim();
  console.log(`[2] 拒绝后看板新增: "${newContent2}"`);
  console.log(`[2] bandState: ${bs2}`);
  await page.screenshot({ path: '/tmp/sp2_after_refuse.png' });

  // 检查：拒绝后应该只有一条 LLM 回复（"那说说吃了啥？"类），不应该再有硬编码文案
  const hasDouble = (newContent2.match(/🤖/g) || []).length > 1;
  console.log(hasDouble ? '⚠️  拒绝后出现多条机器人气泡' : '✅ 拒绝后只有一条机器人回复');

  // 注入语音补录
  await page.evaluate(() => window.__dietDebug.routeFinal('我吃了米饭和青菜'));
  // 等识别完成
  await page.waitForFunction(
    () => {
      const txt = document.querySelector('.session-log')?.textContent || '';
      return txt.includes('午餐') || txt.includes('置信度') || txt.includes('记下') || txt.includes('补录');
    },
    { timeout: 20000 }
  );
  await page.waitForTimeout(1500); // 等 LLM 劝导/科普也可能出现

  const boardFinal = await page.evaluate(() => document.querySelector('.session-log')?.textContent || '');
  const bsFinal = await page.evaluate(() => window.__dietDebug.useUI.getState().bandState);
  const newAfterVoice = boardFinal.replace(boardAfter2, '').trim();
  console.log(`\n[2] 语音补录后看板新增:\n${newAfterVoice}`);
  console.log(`[2] 最终 bandState: ${bsFinal}`);
  await page.screenshot({ path: '/tmp/sp2_final.png' });

  // 检查：语音补录结果气泡 + 低置信提示（recordVoiceLow），应该只有这两条，不应该再有 LLM 生成的接话
  const botBubbles = (newAfterVoice.match(/🤖/g) || []).length;
  console.log(`[2] 语音补录后机器人气泡数: ${botBubbles}`);
  if (botBubbles > 2) {
    console.log('❌ 气泡数超出预期（结果卡+低置信提示=2），可能存在多余输出');
  } else {
    console.log('✅ 气泡数正常');
  }

  await browser.close();
  console.log('\n截图: /tmp/sp1_before_photo.png, /tmp/sp2_after_refuse.png, /tmp/sp2_final.png');
})();
