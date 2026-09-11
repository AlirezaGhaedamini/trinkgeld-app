import logoUrl from '@/assets/brand/tipcrew-logo.svg';

/**
 * The TipCrew logo: the tip jar.
 *
 * Until phase 3S-C this drew three coloured bars inline — a placeholder, and its
 * own comment said so, pointing at the illustrated jar as the real thing. The
 * final artwork is now that file, so the placeholder is gone and this renders
 * the logo itself.
 *
 * Loaded through the bundler rather than from an absolute /public URL because
 * vite.config.ts sets `base: './'` to keep the build portable: an absolute path
 * would break the moment the app is served from a sub-path or a Capacitor
 * WebView. Imported as a URL rather than inlined because the artwork is ~78 kB
 * of paths that never needs to be parsed by JavaScript — the browser caches it
 * as a file and it stays vector-crisp at any size.
 *
 * SQUARE, always. The artwork's viewBox is 810×810, and width and height are
 * set from one number so it can never be stretched. The surrounding brand block
 * — the wordmark and tagline beneath it — is untouched: the logo carries no
 * lettering of its own, so nothing is said twice.
 */
export function BrandMark({ height = 64 }: { height?: number }) {
  return (
    <img
      src={logoUrl}
      alt="TipCrew"
      width={height}
      height={height}
      style={{ display: 'block', width: height, height }}
    />
  );
}
