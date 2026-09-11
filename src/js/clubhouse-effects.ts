// Clubhouse's decorative effects never change game state or intercept board input.
const activeEffects = new Map<HTMLElement, () => void>();
let enabled = false;

function stopEffects() {
  for(const cleanup of activeEffects.values())
    cleanup();
}

function canAnimate() {
  return enabled && !document.hidden;
}

document.addEventListener('visibilitychange', () => {
  if(document.hidden)
    stopEffects();
});

export function configureClubhouseEffects(theme: string) {
  enabled = theme === 'clubhouse';
  document.documentElement.toggleAttribute('data-clubhouse-effects', enabled);
  if(!enabled)
    stopEffects();
}

/** One brief glow on the player's clock, only when a new turn begins. */
export function glowClubhouseClock(clock: HTMLElement) {
  if(!clock?.isConnected || !canAnimate())
    return;

  activeEffects.get(clock)?.();
  const animation = clock.animate([
    { boxShadow: '0 0 0 0 #c8f36a00' },
    { boxShadow: '0 0 0 4px #c8f36a55, 0 0 18px #c8f36a66', offset: 0.35 },
    { boxShadow: '0 0 0 8px #c8f36a00' }
  ], { duration: 850, easing: 'ease-out' });
  const cleanup = () => {
    animation.cancel();
    activeEffects.delete(clock);
  };
  activeEffects.set(clock, cleanup);
  animation.finished.then(cleanup, () => {});
}

/** A short, board-contained celebration for a win by the local player. */
export function celebrateClubhouseWin(card: HTMLElement) {
  if(!card?.isConnected || !canAnimate())
    return;

  activeEffects.get(card)?.();
  const layer = document.createElement('div');
  layer.className = 'clubhouse-confetti';
  layer.setAttribute('aria-hidden', 'true');
  card.append(layer);

  const colors = ['#c8f36a', '#f5ffe5', '#72dcff', '#ffd166', '#ff83b5'];
  const { width, height } = card.getBoundingClientRect();
  const animations: Animation[] = [];
  for(let i = 0; i < 72; i++) {
    const piece = document.createElement('i');
    piece.className = 'clubhouse-confetti-piece';
    piece.style.backgroundColor = colors[i % colors.length];
    // Three waves launch from both sides and spread across the board.
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
    ], { duration: 1900 + Math.random() * 400, delay: Math.floor(i / 24) * 180, easing: 'ease-out', fill: 'both' }));
  }

  const cleanup = () => {
    for(const animation of animations)
      animation.cancel();
    layer.remove();
    activeEffects.delete(card);
  };
  activeEffects.set(card, cleanup);
  Promise.all(animations.map(animation => animation.finished)).then(cleanup, () => {});
}
