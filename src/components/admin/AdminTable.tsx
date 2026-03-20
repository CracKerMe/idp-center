import { clsx } from 'clsx';
import { ReactNode } from 'react';

interface AdminTableProps {
  children: ReactNode;
  minWidthClass?: string;
  className?: string;
  tableClassName?: string;
}

export default function AdminTable({
  children,
  minWidthClass = 'md:min-w-225',
  className,
  tableClassName,
}: AdminTableProps) {
  return (
    <div className={clsx('border-t border-zinc-200 dark:border-zinc-700', className)}>
      <div className="overflow-x-auto">
        <table className={clsx('min-w-full divide-y divide-zinc-200 dark:divide-zinc-700', minWidthClass, tableClassName)}>
          {children}
        </table>
      </div>
    </div>
  );
}
