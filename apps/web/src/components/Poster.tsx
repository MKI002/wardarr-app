// A poster with a calm fallback when there is no image or it fails to load.
import { useState } from 'react';
import { posterUrl } from '../lib/media';
import { Guardian } from './ui';

export function Poster({
  path,
  title,
  size = 'w342',
  className = '',
}: {
  path: string | null;
  title: string;
  size?: 'w185' | 'w342' | 'w500';
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const src = posterUrl(path, size);
  return (
    <div className={`relative aspect-[2/3] overflow-hidden rounded-xl bg-surface-2 ${className}`}>
      {src && !failed ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-2 bg-gradient-to-b from-surface-2 to-border p-3 text-center">
          <Guardian size={32} className="opacity-60" />
          <span className="line-clamp-3 text-xs font-medium text-muted">{title}</span>
        </div>
      )}
    </div>
  );
}
