import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { apiPlugin } from './server/plugin';

// .env 覆盖 process.env:本机 shell 残留旧 TAL_MLOPS_* 曾致网关 401,这里让 .env 永远优先。
function loadEnvFiles(dir: string, mode: string): Record<string, string> {
  const files = ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`];
  const merged: Record<string, string> = {};
  for (const f of files) {
    let txt: string;
    try { txt = readFileSync(join(dir, f), 'utf-8'); } catch { continue; }
    for (const raw of txt.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      const last = val[val.length - 1];
      if ((val[0] === '"' && last === '"') || (val[0] === "'" && last === "'")) val = val.slice(1, -1);
      if (key) merged[key] = val;
    }
  }
  return merged;
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...loadEnvFiles(process.cwd(), mode) };
  return {
    plugins: [react(), apiPlugin(env)],
    server: {
      host: true,
      port: 5173,
      https: {
        key: readFileSync(join(process.cwd(), 'key.pem')),
        cert: readFileSync(join(process.cwd(), 'cert.pem')),
      },
    },
  };
});
