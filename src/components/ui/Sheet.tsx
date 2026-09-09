import { useEffect, useRef, type ReactNode } from 'react';
import { useI18n } from '@/hooks/useI18n';
import styles from '@/components/ui/ui.module.css';

interface SheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Bottom sheet. Escape closes it, focus moves inside when it opens, and the
 * scrim is a real button so it is reachable without a pointer.
 *
 * Focus moves into the panel exactly once, on the transition to open. The
 * screens pass `onClose` as an inline arrow, so its identity changes on every
 * parent render — including the render caused by each keystroke in a textarea
 * inside the sheet. If the focus effect depended on it, every character typed
 * would re-run the effect and pull focus off the field (the defect this
 * comment records). The latest callback lives in a ref instead, and the
 * Escape listener reads it at the moment the key is pressed.
 */
export function Sheet({ open, title, onClose, children }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const { t } = useI18n();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  return (
    <>
      <button type="button" className={styles.scrim} aria-label={t('close')} onClick={onClose} />
      <div
        ref={panelRef}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <span className={styles.sheetGrip} aria-hidden />
        <h2 className={styles.sheetTitle}>{title}</h2>
        {children}
      </div>
    </>
  );
}
