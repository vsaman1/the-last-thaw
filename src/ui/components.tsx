/** Small shared building blocks for menu screens and in-game panels. */
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode, type Ref } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  ref?: Ref<HTMLButtonElement>;
  variant?: 'primary' | 'ghost' | 'danger';
  size?: 'lg' | 'md' | 'sm';
  icon?: ReactNode;
  /** Secondary line under/after the label (e.g. which level Play starts). */
  meta?: ReactNode;
  /** Join the surrounding arrow-key navigation group. Default true. */
  nav?: boolean;
  /** Preferred item for initial focus in its navigation group. */
  preferFocus?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  meta,
  nav = true,
  preferFocus = false,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const cls = `btn btn--${variant} btn--${size}${className ? ` ${className}` : ''}`;
  return (
    <button
      type={type}
      className={cls}
      data-nav={nav ? '' : undefined}
      data-autofocus={preferFocus ? '' : undefined}
      {...rest}
    >
      {icon && <span className="btn__icon">{icon}</span>}
      <span className="btn__text">
        <span className="btn__label">{children}</span>
        {meta && <span className="btn__meta">{meta}</span>}
      </span>
    </button>
  );
}

export interface ScreenHeaderProps {
  eyebrow: string;
  title: string;
  standfirst: string;
  titleId?: string;
  /** Move focus to the heading on mount (long reading pages, so arrow keys scroll). */
  focusTitle?: boolean;
}

export function ScreenHeader({ eyebrow, title, standfirst, titleId, focusTitle }: ScreenHeaderProps) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusTitle) ref.current?.focus({ preventScroll: true });
  }, [focusTitle]);
  return (
    <header className="screen-header">
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="screen-title" id={titleId} ref={ref} tabIndex={focusTitle ? -1 : undefined}>
        {title}
      </h1>
      <p className="standfirst">{standfirst}</p>
    </header>
  );
}

/** Keyboard key cap. `srLabel` replaces glyphs like "←" for screen readers. */
export function Kbd({ children, srLabel }: { children: ReactNode; srLabel?: string }) {
  if (!srLabel) return <kbd className="kbd">{children}</kbd>;
  return (
    <kbd className="kbd">
      <span aria-hidden="true">{children}</span>
      <span className="sr-only">{srLabel}</span>
    </kbd>
  );
}
