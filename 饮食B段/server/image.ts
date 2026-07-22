// 文生图 / 图生图:直接用 fetch 打 TAL gpt-image-1.5 网关(OpenAI 兼容 images 接口)。
// 凭证从 .env 注入,绝不暴露到浏览器。图片以 base64 data URL(或远程 url)形式返回前端。
// 鉴权头与 curl 一致用 api-key: appId:appKey(与 chat 接口的 Authorization: Bearer 不同)。

import type { Env } from './llm';

const GEN_BASE = 'http://ai-service.tal.com/openai-compatible/v1/images/generations';
const EDIT_BASE = 'http://ai-service.tal.com/openai-compatible/v1/images/edits';

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function authHeaders(env: Env): Record<string, string> {
  const appId = env.TAL_MLOPS_APP_ID;
  const appKey = env.TAL_MLOPS_APP_KEY;
  if (!appId || !appKey) throw new Error('后端缺少 TAL_MLOPS_APP_ID / TAL_MLOPS_APP_KEY,请在 .env 配置');
  return { 'api-key': `${appId}:${appKey}` };
}

// data URL(data:image/png;base64,xxxx)或纯 base64 → {mime, buffer}
function parseImage(s: string): { mime: string; buffer: ArrayBuffer } {
  const m = s.trim().match(/^data:([^;]+);base64,(.*)$/s);
  const mime = m ? m[1] : 'image/png';
  const b64 = (m ? m[2] : s).replace(/\s/g, '');
  const bin = atob(b64);
  const buffer = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return { mime, buffer };
}

function pickImage(data: any): string {
  const item = data?.data?.[0];
  if (!item) throw new Error('网关未返回图片数据');
  if (typeof item.b64_json === 'string') return `data:image/png;base64,${item.b64_json}`;
  if (typeof item.url === 'string') return item.url;
  throw new Error('网关返回的图片格式无法识别');
}

export async function generateImage(
  payload: { prompt: string; size?: string; quality?: string },
  env: Env
): Promise<{ image: string }> {
  if (!payload.prompt?.trim()) throw new Error('prompt 不能为空');
  const body: Record<string, unknown> = {
    model: env.TAL_IMAGE_MODEL || 'gpt-image-1.5',
    prompt: payload.prompt,
  };
  if (payload.size) body.size = payload.size;
  if (payload.quality) body.quality = payload.quality;
  const res = await fetch(GEN_BASE, {
    method: 'POST',
    headers: { ...authHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`image-gen ${res.status}: ${t.slice(0, 300)}`);
  }
  return { image: pickImage(await res.json()) };
}

export async function editImage(
  payload: { prompt: string; images: string[]; size?: string },
  env: Env
): Promise<{ image: string }> {
  if (!payload.prompt?.trim()) throw new Error('prompt 不能为空');
  const imgs = (payload.images || []).filter((s) => typeof s === 'string' && s.trim());
  if (!imgs.length) throw new Error('图生图至少需要 1 张图片');
  const form = new FormData();
  form.append('prompt', payload.prompt);
  form.append('model', env.TAL_IMAGE_MODEL || 'gpt-image-1.5');
  if (payload.size) form.append('size', payload.size);
  const multi = imgs.length > 1;
  imgs.forEach((s, i) => {
    const { mime, buffer } = parseImage(s);
    const ext = MIME_EXT[mime] || 'png';
    form.append(multi ? 'image[]' : 'image', new File([buffer], `image-${i}.${ext}`, { type: mime }));
  });
  // 不手动设 Content-Type,让 fetch 自动带 multipart boundary。
  const res = await fetch(EDIT_BASE, {
    method: 'POST',
    headers: authHeaders(env),
    body: form,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`image-edit ${res.status}: ${t.slice(0, 300)}`);
  }
  return { image: pickImage(await res.json()) };
}
