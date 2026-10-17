/**
 * In-place Fisher-Yates shuffle algorithm that creates a randomized array copy
 */
export function shuffleArray<T>(array: T[]): T[] {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Returns optimal CSS object-position for sports action shots.
 * Standard portrait/athlete framing benefits from an upper-center bias (30% from top)
 * so heads and upper-body action are never clipped on widescreen or mobile vertical crops.
 */
export function getFocalPointStyle(focalPoint?: string): React.CSSProperties {
  switch (focalPoint?.toLowerCase()) {
    case "top":
      return { objectPosition: "center 15%" };
    case "bottom":
      return { objectPosition: "center 85%" };
    case "left":
      return { objectPosition: "20% center" };
    case "right":
      return { objectPosition: "80% center" };
    case "action-upper":
    default:
      // Default 30% top bias ensures athlete heads/torso stay in frame on mobile & desktop
      return { objectPosition: "center 30%" };
  }
}
