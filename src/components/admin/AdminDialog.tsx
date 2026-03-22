import { ReactNode } from 'react';
import { X } from 'lucide-react';

interface AdminDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Footer buttons area */
  footer?: ReactNode;
}

export default function AdminDialog({ open, onClose, title, children, footer }: AdminDialogProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        <div className="fixed inset-0 bg-zinc-500/75 transition-opacity" onClick={onClose} />
        <div className="inline-block align-bottom bg-white dark:bg-zinc-900 rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full relative z-10">
          {/* Header */}
          <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-zinc-200 dark:border-zinc-700">
            <h3 className="text-lg font-medium text-zinc-900 dark:text-white">{title}</h3>
            <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200">
              <X className="h-5 w-5" />
            </button>
          </div>
          {/* Body */}
          <div className="px-6 py-5 space-y-4">{children}</div>
          {/* Footer */}
          {footer && (
            <div className="px-6 py-4 bg-zinc-50 dark:bg-zinc-800 flex justify-end gap-3 border-t border-zinc-200 dark:border-zinc-700">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
