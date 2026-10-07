import { cn } from "@/lib/utils";

export interface SparklineProps {
  /**
   * 7–30 numeric points (design §4.2). Values are normalised to the drawing
   * area, so absolute magnitudes do not matter.
   */
  data: number[];
  /** Rendered height in px — 48px per the design. */
  height?: number;
  className?: string;
}

/**
 * Sparkline — decorative area chart (no axes) drawn as a small inline SVG.
 * Line: primary-500, stroke width 2. Area: primary-500 at 8% opacity.
 */
export function Sparkline({ data, height = 48, className }: SparklineProps) {
  if (data.length < 2) return null;

  const width = 300;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padding = 2;

  const points = data.map((value, index) => {
    const x = (index / (data.length - 1)) * width;
    const y =
      height -
      padding -
      ((value - min) / range) * (height - padding * 2);
    return { x, y };
  });

  const line = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      className={cn("block w-full", className)}
    >
      <path d={area} fill="var(--color-primary-500)" fillOpacity={0.08} />
      <path
        d={line}
        fill="none"
        stroke="var(--color-primary-500)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
