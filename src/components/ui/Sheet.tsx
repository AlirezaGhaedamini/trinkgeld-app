import { useEffect, useRef, type ReactNode } from 'react';
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
 */
export function Sheet({ open, title, onClose, children }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <button type="button" className={styles.scrim} aria-label="Close" onClick={onClose} />
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
