/**
 * The TipCrew mark: three bars in the brand's teal, green and gold.
 *
 * Drawn inline rather than loaded as an image so it stays crisp at any size and
 * costs no request. The full illustrated logo (the tip jar) lives in
 * src/assets/brand/tipcrew-logo.svg and is the source for app icons.
 */
export function BrandMark({ height = 34 }: { height?: number }) {
  const unit = height / 34;
  const bar = (h: number, color: string) => (
    <span
      style={{
        width: 9 * unit,
        height: h * unit,
        borderRadius: 4 * unit,
        background: color,
        display: 'block',
      }}
    />
  );
  return (
    <span
      role="img"
      aria-label="TipCrew"
      style={{ display: 'flex', gap: 4 * unit, alignItems: 'flex-end', height }}
    >
      {bar(34, 'var(--color-area-service)')}
      {bar(24, 'var(--color-area-bar)')}
      {bar(15, 'var(--color-area-kitchen)')}
    </span>
  );
}
