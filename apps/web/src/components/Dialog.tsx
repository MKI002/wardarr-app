import * as RadixDialog from '@radix-ui/react-dialog';
import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { spring } from './ui';

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <RadixDialog.Portal forceMount>
            <RadixDialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-40 bg-black/50"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              />
            </RadixDialog.Overlay>
            <RadixDialog.Content asChild forceMount>
              <motion.div
                className={`fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl border border-border bg-surface p-5 shadow-xl sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2 sm:rounded-2xl ${wide ? 'sm:max-w-2xl' : 'sm:max-w-lg'}`}
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 24 }}
                transition={spring}
              >
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div>
                    <RadixDialog.Title className="text-lg font-semibold">{title}</RadixDialog.Title>
                    {description ? (
                      <RadixDialog.Description className="mt-1 text-sm text-muted">
                        {description}
                      </RadixDialog.Description>
                    ) : (
                      <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
                    )}
                  </div>
                  <RadixDialog.Close
                    className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-text"
                    aria-label={t('ui.common.close')}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="size-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      aria-hidden
                    >
                      <path d="M6 6l12 12M18 6 6 18" />
                    </svg>
                  </RadixDialog.Close>
                </div>
                {children}
              </motion.div>
            </RadixDialog.Content>
          </RadixDialog.Portal>
        ) : null}
      </AnimatePresence>
    </RadixDialog.Root>
  );
}

/** Confirmation for actions that change something. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  onConfirm,
  busy,
  danger,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  busy?: boolean;
  danger?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description={body}>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="min-h-9 rounded-lg px-3.5 text-sm text-muted hover:bg-surface-2"
          onClick={() => onOpenChange(false)}
        >
          {t('ui.common.cancel')}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className={`min-h-9 rounded-lg px-3.5 text-sm font-medium ${danger ? 'bg-critical-bg text-critical' : 'bg-accent text-accent-contrast'} disabled:opacity-50`}
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
