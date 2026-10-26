/** Inline stroke icons (24×24 grid). Decorative: always paired with visible text or an aria-label. */
import type { ReactNode } from 'react';

interface IconProps {
  size?: number;
  className?: string;
}

function Svg({ size = 20, className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const PauseIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="6" y="5" width="4" height="14" rx="0.5" fill="currentColor" stroke="none" />
    <rect x="14" y="5" width="4" height="14" rx="0.5" fill="currentColor" stroke="none" />
  </Svg>
);

export const RestartIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 12a8 8 0 1 0 2.4-5.7" />
    <path d="M4 4v5h5" />
  </Svg>
);

export const PlayIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 5l12 7-12 7z" fill="currentColor" stroke="none" />
  </Svg>
);

export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12.5l2.8 2.8L16.5 9.5" />
  </Svg>
);

export const LockIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="11" width="14" height="10" rx="1" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Svg>
);

export const UnlockIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="11" width="14" height="10" rx="1" />
    <path d="M8 11V8a4 4 0 0 1 7.6-1.7" />
  </Svg>
);

export const WarningIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3l10 18H2z" />
    <path d="M12 10v5" />
    <path d="M12 18h.01" />
  </Svg>
);

export const StarIcon = (p: IconProps) => (
  <Svg {...p}>
    <path
      d="M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8 6.6 19.7l1.1-6.1L3.2 9.4l6.1-.8z"
      fill="currentColor"
      stroke="none"
    />
  </Svg>
);

export const RockIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 19l3-8 5-4 6 2 4 10z" />
    <path d="M11 7l1 5 5-3" />
  </Svg>
);

export const WaterfallIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 6h9v14" />
    <path d="M8 9v9M15 12c0 3 1 5 3 7M19 13c0 2 1 4 2 5" />
  </Svg>
);

export const WaveIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 10c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2" />
    <path d="M2 16c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2" />
  </Svg>
);

export const ArrowLeftIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M19 12H5" />
    <path d="M11 6l-6 6 6 6" />
  </Svg>
);

export const MenuIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Svg>
);

export const GridIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="4" width="7" height="7" />
    <rect x="13" y="4" width="7" height="7" />
    <rect x="4" y="13" width="7" height="7" />
    <rect x="13" y="13" width="7" height="7" />
  </Svg>
);

export const NextIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12h14" />
    <path d="M13 6l6 6-6 6" />
  </Svg>
);

export const GearIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1" />
  </Svg>
);

export const BookIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 5h6a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H4z" />
    <path d="M20 5h-6a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h6z" />
  </Svg>
);

export const ExitIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 4h5v16h-5" />
    <path d="M10 8l-4 4 4 4M6 12h10" />
  </Svg>
);

export const EyeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);

/** Results list (back to the LEVEL COMPLETE panel). */
export const ListIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <path d="M4 6h.01M4 12h.01M4 18h.01" />
  </Svg>
);

/** Fit-to-frame corners (river view: back to the whole river). */
export const FrameIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
    <path d="M8 15l3-4 2 2 3-4" />
  </Svg>
);

export const SpeedIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 17a8 8 0 1 1 16 0" />
    <path d="M12 17l4-5" />
  </Svg>
);

/** Low-poly iceberg emblem in game colours (not currentColor). */
export function IcebergMark({ size = 56, className }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
    >
      <polygon points="8,40 20,22 30,30" fill="#1C8FD6" />
      <polygon points="20,22 34,10 30,30" fill="#7FFFF4" />
      <polygon points="34,10 46,24 30,30" fill="#5FF3FF" />
      <polygon points="46,24 58,40 30,30" fill="#1C8FD6" />
      <polygon points="8,40 30,30 58,40" fill="#3FB8E8" />
      <polygon points="8,40 58,40 46,52 18,52" fill="#1450E6" />
      <polygon points="18,52 46,52 36,58 26,58" fill="#0B3A8C" />
    </svg>
  );
}
