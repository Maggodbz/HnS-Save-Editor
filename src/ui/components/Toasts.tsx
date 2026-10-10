// Lightweight toast notifications.
import { createContext, type ReactNode, useCallback, useContext, useState } from 'react';

type Kind = 'info' | 'success' | 'error';
interface Toast { id: number; kind: Kind; text: string }

const Ctx = createContext<(kind: Kind, text: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Kind, text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);

/** Runs an edit; shows its error message as a toast instead of throwing. Returns success. */
export function useGuard() {
  const toast = useToast();
  return useCallback((fn: () => void, success?: string) => {
    try {
      fn();
      if (success) toast('success', success);
      return true;
    } catch (e) {
      toast('error', e instanceof Error ? e.message : String(e));
      return false;
    }
  }, [toast]);
}
