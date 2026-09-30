import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, Info, X, AlertOctagon } from 'lucide-react';
import { c, ui, radius, font } from '../theme.js';

// Inline feedback for the admin panel.
//
// Replaces window.alert / window.confirm, which were the single biggest UX
// problem in the panel: they block the whole page, cannot be styled, lose the
// message on the next render, and make the product feel like a prototype
// dropped into a real app.
//
// This gives every tab the same three things:
//   toast(message)  a transient confirmation that fades on its own
//   notify(message) a persistent inline banner for anything that needs reading
//   confirm({...})  a real modal for destructive actions, so "Delete?" is a
//                    deliberate, readable step rather than a browser popup
//
// Usage:
//   const { toast, notify, confirm, ConfirmDialog } = useFeedback();
//   toast('Saved');
//   if (await confirm({ title: 'Delete member?', body: '...', danger: true })) { ... }

const FeedbackContext = createContext(null);

export function useFeedback() {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error('useFeedback must be used inside <FeedbackProvider>');
  return ctx;
}

let seq = 0;

export function FeedbackProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [banner, setBanner] = useState(null);
  const [confirmState, setConfirmState] = useState(null);
  const timer = useRef(null);

  // A single timer rather than one per toast: three rapid saves should show
  // three stacked toasts, not fight over a shared timeout.
  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((message, opts = {}) => {
    const id = ++seq;
    setToasts((list) => [...list.slice(-2), { id, message, tone: opts.tone || 'ok' }]);
    setTimeout(() => dismiss(id), opts.duration || 3200);
    return id;
  }, [dismiss]);

  // Errors persist until replaced or dismissed — an error that vanishes after
  // three seconds is an error the user will miss.
  const notify = useCallback((message, tone = 'danger') => {
    setBanner({ message, tone, id: ++seq });
  }, []);

  const clearBanner = useCallback(() => setBanner(null), []);

  /**
   * Destructive confirmation. Resolves true/false, so a caller reads as:
   *   if (await confirm({ title, body, confirmLabel })) { ... }
   */
  const confirm = useCallback((opts) => new Promise((resolve) => {
    setConfirmState({ ...opts, resolve });
  }), []);

  const settle = useCallback((value) => {
    setConfirmState((s) => {
      s?.resolve?.(value);
      return null;
    });
  }, []);

  // Escape closes the modal, and restores focus to whatever opened it, so
  // keyboard users are not dropped back at the top of the document.
  const lastFocus = useRef(null);
  useEffect(() => {
    if (!confirmState) return undefined;
    lastFocus.current = document.activeElement;
    const onKey = (e) => { if (e.key === 'Escape') settle(false); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      lastFocus.current?.focus?.();
    };
  }, [confirmState, settle]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const value = useMemo(
    () => ({ toast, notify, clearBanner, confirm, banner, ConfirmDialog: Dialog }),
    [toast, notify, clearBanner, confirm, banner],
  );

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
      {confirmState && <Dialog {...confirmState} onSettle={settle} />}
    </FeedbackContext.Provider>
  );
}

const TONE = {
  ok: { icon: <CheckCircle2 size={15} />, bg: c.okBg, border: c.okBorder, fg: '#065F46' },
  warn: { icon: <AlertTriangle size={15} />, bg: c.warnBg, border: c.warnBorder, fg: c.warnFg },
  info: { icon: <Info size={15} />, bg: c.infoBg, border: c.infoBorder, fg: c.infoFg },
  danger: { icon: <AlertTriangle size={15} />, bg: c.dangerBg, border: c.dangerBorder, fg: c.dangerFg },
};

function ToastStack({ toasts, onDismiss }) {
  if (!toasts.length) return null;
  return (
    // position: fixed so a toast saved at the bottom of a long table is still
    // visible without scrolling back up.
    <div style={stack} role="status" aria-live="polite">
      {toasts.map((t) => {
        const tone = TONE[t.tone] || TONE.ok;
        return (
          <div key={t.id} style={{ ...toast, background: tone.bg, borderColor: tone.border, color: tone.fg }}>
            {tone.icon}
            <span style={{ flex: 1 }}>{t.message}</span>
            <button onClick={() => onDismiss(t.id)} style={toastClose} aria-label="Dismiss">
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function Dialog({
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onSettle,
}) {
  const cancelRef = useRef(null);
  useEffect(() => { cancelRef.current?.focus(); }, []);

  return (
    <div style={scrim} onClick={() => onSettle(false)}>
      <div
        style={dialog}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          {danger && (
            <div style={{
              width: 34, height: 34, borderRadius: 999, flexShrink: 0,
              background: c.dangerBg, color: c.dangerFg,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <AlertOctagon size={17} />
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 650, color: c.text }}>{title}</h3>
            {body && <p style={{ margin: '6px 0 0', fontSize: 13, color: c.body, lineHeight: 1.55 }}>{body}</p>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <button ref={cancelRef} onClick={() => onSettle(false)} style={dialogBtn}>{cancelLabel}</button>
          <button
            onClick={() => onSettle(true)}
            style={{
              ...dialogBtn,
              background: danger ? c.dangerFg : c.accent,
              color: '#fff',
              borderColor: danger ? c.dangerFg : c.accent,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// Exported so a tab can render <Banner/> without re-declaring the styling.
export function Banner({ message, tone = 'danger', onClose }) {
  if (!message) return null;
  const t = TONE[tone] || TONE.danger;
  return (
    <div style={{ ...ui.error, background: t.bg, borderColor: t.border, color: t.fg }} role="alert">
      {t.icon}
      <span style={{ flex: 1 }}>{message}</span>
      {onClose && (
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, display: 'flex' }} aria-label="Dismiss">
          <X size={14} />
        </button>
      )}
    </div>
  );
}

const stack = {
  position: 'fixed',
  bottom: 20,
  right: 20,
  zIndex: 10000,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  maxWidth: 360,
};

const toast = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 12px',
  borderRadius: radius.md,
  border: '1px solid',
  fontSize: 12.5,
  fontWeight: 500,
  fontFamily: font.sans,
  boxShadow: '0 6px 20px rgba(0,0,0,0.10)',
  animation: 'btlToastIn 160ms ease-out',
};

const toastClose = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: 'inherit', opacity: 0.6, display: 'flex', padding: 0,
};

const scrim = {
  position: 'fixed', inset: 0, zIndex: 10001,
  background: 'rgba(22,22,22,0.42)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 20,
};

const dialog = {
  background: c.card,
  borderRadius: radius.xl,
  padding: 22,
  width: 440,
  maxWidth: '100%',
  boxShadow: '0 24px 70px rgba(0,0,0,0.24)',
};

const dialogBtn = {
  padding: '8px 14px',
  borderRadius: radius.sm,
  border: `1px solid ${c.border}`,
  background: c.card,
  color: c.body,
  fontSize: 12.5,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: font.sans,
};
