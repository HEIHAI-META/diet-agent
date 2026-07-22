// Vite 插件:在 dev server 内挂载 /api/* 中间件,代理到 LLM 网关。
// 单进程,无需额外起 server,API key 留在后端不暴露给浏览器。

import type { Plugin, ViteDevServer, Connect } from 'vite';
import { analyzeIntake, clarifyIntake, reportSuggestion, weeklySuggestion, eatingCheck, conversationTurn, persuadeSnack, voiceRouteCheck, checkChildNote, type Env } from './llm';
import { generateImage, editImage } from './image';

// 跨设备状态中转(内存):手机记录 → POST 快照 → Mac 轮询拉取。
let stateSnapshot: { days: any; config: any } | null = null;
let stateVersion = 0;

function readBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function send(res: any, status: number, obj: any) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}

export function apiPlugin(env: Env): Plugin {
  return {
    name: 'diet-agent-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url || '').split('?')[0];
        if (!url.startsWith('/api/')) return next();

        // 状态中转:GET 拉快照(带 ?full=1 返回完整状态,否则只回版本号),POST 写快照。
        if (url === '/api/state') {
          if (req.method === 'GET') {
            const full = (req.url || '').includes('full=1');
            return send(res, 200, full ? { state: stateSnapshot, version: stateVersion } : { version: stateVersion });
          }
          if (req.method === 'POST') {
            try {
              const raw = await readBody(req);
              const body = raw ? JSON.parse(raw) : {};
              stateSnapshot = body.state;
              stateVersion++;
              return send(res, 200, { version: stateVersion });
            } catch (e: any) {
              return send(res, 400, { error: e?.message || 'bad state' });
            }
          }
        }

        try {
          const raw = await readBody(req);
          const body = raw ? JSON.parse(raw) : {};
          let out: unknown;
          switch (url) {
            case '/api/analyze-intake':
              out = await analyzeIntake(body, env);
              break;
            case '/api/clarify-intake':
              out = await clarifyIntake(body, env);
              break;
            case '/api/report-suggestion':
              out = await reportSuggestion(body, env);
              break;
            case '/api/weekly-suggestion':
              out = await weeklySuggestion(body, env);
              break;
            case '/api/eating-check':
              out = await eatingCheck(body, env);
              break;
            case '/api/voice-route':
              out = await voiceRouteCheck(body, env);
              break;
            case '/api/conversation-turn':
              out = await conversationTurn(body, env);
              break;
            case '/api/persuade-snack':
              out = await persuadeSnack(body, env);
              break;
            case '/api/child-note':
              out = await checkChildNote(body, env);
              break;
            case '/api/image-gen':
              out = await generateImage(body, env);
              break;
            case '/api/image-edit':
              out = await editImage(body, env);
              break;
            default:
              return send(res, 404, { error: 'not found' });
          }
          send(res, 200, out);
        } catch (e: any) {
          console.error('[diet-agent-api] error:', e?.message || e);
          send(res, 500, { error: e?.message || 'internal error' });
        }
      });
    },
  };
}
