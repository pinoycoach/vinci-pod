import type { CompetitionLevel } from '@/types/pod';

/**
 * Extracts the primary search term from agent outputs.
 * Prefers niche agent's nicheKeywords or targetBuyer, falls back to Cloud Vision labels.
 */
export function extractSearchTerm(
  nicheAgentOutput: Record<string, unknown>,
  cloudVisionLabels: Array<{ description: string; score: number }>
): string {
  // Try niche agent keywords first (most precise)
  const keywords = nicheAgentOutput?.nicheKeywords as string | undefined;
  if (keywords && keywords.length > 4) {
    return `${keywords.toLowerCase().slice(0, 40)} shirt`;
  }

  // Try target buyer field — strip filler words, take first 3 meaningful words
  const targetBuyer = nicheAgentOutput?.targetBuyer as string | undefined;
  if (targetBuyer && targetBuyer.length > 0) {
    const words = targetBuyer
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(' ')
      .filter(w => !['a', 'an', 'the', 'of', 'who', 'that', 'is', 'are', 'and', 'or', 'with', 'for', 'in', 'on'].includes(w))
      .slice(0, 3)
      .join(' ');
    if (words.length > 3) return `${words} shirt`;
  }

  // Fall back to Cloud Vision top labels
  if (cloudVisionLabels && cloudVisionLabels.length > 0) {
    const top = cloudVisionLabels.slice(0, 2).map(l => l.description.toLowerCase()).join(' ');
    return `${top} shirt`;
  }

  return 'niche shirt design';
}

/**
 * Maps a competition level to a numeric opportunity score (higher = better opportunity).
 */
export function competitionLevelToScore(level: CompetitionLevel): number {
  const map: Record<CompetitionLevel, number> = {
    BLUE_OCEAN:  95,
    MODERATE:    70,
    SATURATED:   35,
    OVERCROWDED: 10,
    UNKNOWN:     55
  };
  return map[level];
}

/**
 * Maps an estimated listing count string to a CompetitionLevel.
 */
export function estimateCompetitionLevel(estimatedCount: string): CompetitionLevel {
  if (estimatedCount.includes('< 500') || estimatedCount.includes('<500'))    return 'BLUE_OCEAN';
  if (estimatedCount.includes('500'))                                          return 'MODERATE';
  if (estimatedCount.includes('2,000') || estimatedCount.includes('2000'))    return 'SATURATED';
  if (estimatedCount.includes('> 10,000') || estimatedCount.includes('>10'))  return 'OVERCROWDED';
  return 'UNKNOWN';
}

/**
 * Human-readable signal line per competition level.
 */
export function competitionSignalLine(level: CompetitionLevel, searchTerm: string): string {
  const lines: Record<CompetitionLevel, string> = {
    BLUE_OCEAN:  `"${searchTerm}" has very few competing listings — early mover advantage.`,
    MODERATE:    `"${searchTerm}" is competitive but not saturated — quality designs win.`,
    SATURATED:   `"${searchTerm}" has heavy competition — only exceptional designs surface.`,
    OVERCROWDED: `"${searchTerm}" is flooded — save this slot for a less-crowded niche.`,
    UNKNOWN:     `Competition data unavailable — proceed based on CRS alone.`
  };
  return lines[level];
}
