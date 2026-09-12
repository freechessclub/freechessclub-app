import type { ThemeEffect } from './theme-effects';

/** Reusable animations; theme palettes and intensity belong in the registry. */
export function clockGlow(color: string, duration = 850): ThemeEffect {
  return (clock) => {
    const animation = clock.animate([
      { boxShadow: '0 0 0 0 transparent' },
      { boxShadow: `0 0 0 4px color-mix(in srgb, ${color} 33%, transparent), 0 0 18px color-mix(in srgb, ${color} 40%, transparent)`, offset: 0.35 },
      { boxShadow: '0 0 0 8px transparent' }
    ], { duration, easing: 'ease-out' });
    return { finished: animation.finished, cancel: () => animation.cancel() };
  };
}

interface ConfettiOptions {
  colors: readonly string[];
  count: number;
  waves: number;
  duration: number;
}

export function victoryConfetti({ colors, count, waves, duration }: ConfettiOptions): ThemeEffect {
  return (card) => {
    const layer = document.createElement('div');
    layer.className = 'theme-confetti';
    layer.setAttribute('aria-hidden', 'true');
    card.append(layer);

    const { width, height } = card.getBoundingClientRect();
    const animations: Animation[] = [];
    for(let i = 0; i < count; i++) {
      const piece = document.createElement('i');
      piece.className = 'theme-confetti-piece';
      piece.style.backgroundColor = colors[i % colors.length];
      piece.style.left = `${i % 2 ? 96 : 4}%`;
      piece.style.top = `${60 + Math.random() * 20}%`;
      layer.append(piece);
      const x = (i % 2 ? -1 : 1) * width * (0.18 + Math.random() * 0.4);
      const rise = height * (0.25 + Math.random() * 0.35);
      const spin = (i % 2 ? -1 : 1) * (360 + Math.random() * 540);
      animations.push(piece.animate([
        { transform: 'translate(0, 0) rotate(0deg) scale(0.5)', opacity: 0 },
        { opacity: 1, offset: 0.06 },
        { transform: `translate(${x * 0.6}px, -${rise}px) rotate(${spin * 0.4}deg) scale(1)`, opacity: 1, offset: 0.35 },
        { opacity: 1, offset: 0.7 },
        { transform: `translate(${x}px, ${height * 0.45}px) rotate(${spin}deg) scale(0.8)`, opacity: 0 }
      ], { duration: duration + Math.random() * 400, delay: Math.floor(i / Math.ceil(count / waves)) * 180, easing: 'ease-out', fill: 'both' }));
    }

    return {
      finished: Promise.all(animations.map(animation => animation.finished)),
      cancel: () => {
        for(const animation of animations)
          animation.cancel();
        layer.remove();
      }
    };
  };
}
