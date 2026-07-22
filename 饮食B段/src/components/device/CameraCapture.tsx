import { useCallback, useEffect, useRef, useState } from 'react';
import { speak } from '../../lib/feedback';

interface Props {
  onCapture: (dataUrl: string) => void;
  onClose: () => void;
  onPickFile: () => void;
  // auto=true:AI 引导摆盘 + 倒数 3-2-1 + 自动拍摄(无孩子点按钮);false:保留手动快门。
  auto?: boolean;
  // waitForKaipai=true:主动入口模式，摄像头就绪后停住等「开拍」指令，不自动倒数。
  // 外部通过 triggerShootRef.current() 触发倒数+拍照。
  waitForKaipai?: boolean;
  triggerShootRef?: React.MutableRefObject<(() => void) | null>;
}

// 拍照执行链路(PRD 模块二·衔接 + §二):AI 语音引导摆盘 → 屏幕倒数 3-2-1 → 程序化自动拍摄。
// 摄像头不可用时回退手动快门 + 相册。质量判定与补拍在 InfoPanel.handlePhoto 驱动。
export default function CameraCapture({ onCapture, onClose, onPickFile, auto, waitForKaipai, triggerShootRef }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
        setReady(true);
      } catch (e: any) {
        setError(e?.name === 'NotAllowedError' ? '未授权使用摄像头' : e?.message || '无法访问摄像头');
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const shoot = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const max = 720;
    const scale = Math.min(1, max / Math.max(v.videoWidth, v.videoHeight));
    const cw = Math.round(v.videoWidth * scale);
    const ch = Math.round(v.videoHeight * scale);
    const c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(v, 0, 0, cw, ch);
    onCapture(c.toDataURL('image/jpeg', 0.8));
  }, [onCapture]);

  const shootRef = useRef(shoot);
  useEffect(() => { shootRef.current = shoot; }, [shoot]);

  const countdown = useCallback(() => {
    setCount(3); speak('三');
    const t1 = setTimeout(() => { setCount(2); speak('二'); }, 1000);
    const t2 = setTimeout(() => { setCount(1); speak('一'); }, 2000);
    const t3 = setTimeout(() => { setCount(null); speak('咔嚓'); shootRef.current(); }, 3000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  // auto 模式:摄像头就绪后语音倒数 3-2-1 + 咔嚓 自动拍。
  // waitForKaipai 模式:就绪后停住，等外部调用 triggerShootRef.current() 再倒数。
  useEffect(() => {
    if (!ready) return;
    if (waitForKaipai) {
      if (triggerShootRef) triggerShootRef.current = countdown;
      return () => { if (triggerShootRef) triggerShootRef.current = null; };
    }
    if (!auto) return;
    return countdown();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, waitForKaipai, ready]);

  return (
    <div className="camera-pop">
      <video ref={videoRef} autoPlay playsInline muted className="camera-video" />
      {count !== null && <div className="camera-countdown">{count}</div>}
      {!ready && !error && <div className="camera-hint">正在打开摄像头…</div>}
      {error && (
        <div className="camera-hint">
          <div>📷 摄像头不可用</div>
          <div className="tiny" style={{ opacity: 0.7 }}>{error}</div>
          <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={onPickFile}>从相册选择</button>
        </div>
      )}
      <div className="camera-top">
        <span className="tiny" style={{ color: '#fff', opacity: 0.9 }}>
          {waitForKaipai ? '摄像头已打开 · 说「开拍」拍照' : auto ? '俯拍全盘 · 自动拍摄' : '俯拍全盘,识别更准'}
        </span>
      </div>
      <div className="camera-bar">
        <button className="btn ghost sm" onClick={onClose}>取消</button>
        {(count === null || !auto) && <button className="camera-shutter" onClick={shoot} disabled={!ready} aria-label="拍照" />}
        <button className="btn ghost sm" onClick={onPickFile}>相册</button>
      </div>
    </div>
  );
}
