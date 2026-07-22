import { useUI } from '../ui';

export default function Toaster() {
  const toasts = useUI((s) => s.toasts);
  const dismiss = useUI((s) => s.dismiss);
  return (
    <div className="toast-wrap">
      {toasts.map((t) => (
        <div className="toast" key={t.id} onClick={() => dismiss(t.id)}>
          <div className="ico">{t.ico}</div>
          <div>
            <div className="ttl">{t.title}</div>
            {t.body && <div className="body">{t.body}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
