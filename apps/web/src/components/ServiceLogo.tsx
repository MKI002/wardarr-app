// Product logos for the services Wardarr connects to. They belong to their
// projects and are used only to show which service an entry stands for;
// sources and licenses are listed in NOTICE.md. Products without a logo file
// get a neutral mark with their initial instead.

const FILES = import.meta.glob<string>('../assets/logos/*.{svg,png}', {
  eager: true,
  query: '?url',
  import: 'default',
});

const LOGOS: Record<string, string> = Object.fromEntries(
  Object.entries(FILES).map(([file, url]) => [file.replace(/^.*\/|\.(svg|png)$/g, ''), url]),
);

/** URL of a product logo, or null when Wardarr has none. */
export function logoUrl(adapter: string | null | undefined): string | null {
  return (adapter && LOGOS[adapter]) || null;
}

/** Logos drawn for a dark background need a dark plate in the light theme. */
export function needsPlate(adapter: string | null | undefined): boolean {
  return !!adapter && DARK_ONLY.has(adapter);
}

// Logos drawn for a dark background (white parts) get a dark plate in the
// light theme so they stay recognisable.
const DARK_ONLY = new Set(['radarr']);

export function ServiceLogo({
  adapter,
  name,
  size = 20,
  className = '',
}: {
  adapter: string;
  name: string;
  size?: number;
  className?: string;
}) {
  const url = LOGOS[adapter];
  const box = { width: size, height: size };
  if (!url) {
    return (
      <span
        aria-hidden
        style={{ ...box, fontSize: Math.round(size * 0.55) }}
        className={`inline-flex shrink-0 items-center justify-center rounded-md bg-surface-2 font-semibold text-muted ring-1 ring-border ${className}`}
      >
        {name.trim().charAt(0).toUpperCase()}
      </span>
    );
  }
  const plate = DARK_ONLY.has(adapter);
  return (
    <span
      aria-hidden
      style={plate ? { ...box, padding: Math.round(size * 0.12) } : box}
      className={`inline-flex shrink-0 items-center justify-center ${
        plate ? 'rounded-md bg-[#24292e] dark:bg-transparent dark:p-0!' : ''
      } ${className}`}
    >
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        draggable={false}
        className="size-full object-contain"
      />
    </span>
  );
}
