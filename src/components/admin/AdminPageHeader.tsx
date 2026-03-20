import { ReactNode } from 'react';
import { clsx } from 'clsx';

interface AdminPageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
  titleClassName?: string;
  actionContainerClassName?: string;
  titleAs?: 'h1' | 'h2' | 'h3';
}

export default function AdminPageHeader({
  title,
  description,
  actions,
  className,
  titleClassName,
  actionContainerClassName,
  titleAs = 'h3',
}: AdminPageHeaderProps) {
  const TitleTag = titleAs;

  return (
    <div className={clsx('px-4 py-5 sm:px-6', className)}>
      <div className={clsx('flex flex-col gap-3', (actions || description) && 'sm:flex-row sm:items-center sm:justify-between')}>
        <div className={clsx(description && 'sm:flex-auto')}>
          <TitleTag className={clsx('text-lg leading-6 font-medium text-zinc-900 dark:text-white', titleClassName)}>
            {title}
          </TitleTag>
          {description && (
            <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-400">
              {description}
            </p>
          )}
        </div>

        {actions && (
          <div className={clsx('w-full sm:w-auto', description && 'sm:mt-0 sm:ml-16 sm:flex-none', actionContainerClassName)}>
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
