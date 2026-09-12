import type { ThemeEffects } from './theme-effects';
import { clockGlow, victoryConfetti } from './theme-animations';

// Themes opt into individual hooks. Unlisted themes have no effects.
// A hook can reuse an animation factory or provide its own ThemeEffect handler.
export const themeEffectsRegistry: Readonly<Record<string, ThemeEffects>> = {
  clubhouse: {
    playerTurn: clockGlow('#c8f36a'),
    playerWin: victoryConfetti({
      colors: ['#c8f36a', '#f5ffe5', '#72dcff', '#ffd166', '#ff83b5'],
      count: 72,
      waves: 3,
      duration: 1900
    })
  }
};
