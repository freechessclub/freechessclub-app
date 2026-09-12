/** A theme effect owns its temporary visuals until completion or cancellation. */
export interface ThemeEffectHandle {
  finished: Promise<unknown>;
  cancel(): void;
}

export type ThemeEffect = (target: HTMLElement) => ThemeEffectHandle;
export interface ThemeEffects {
  playerTurn?: ThemeEffect;
  playerWin?: ThemeEffect;
}

let currentEffects: ThemeEffects = {};
const activeEffects = new Map<HTMLElement, ThemeEffectHandle>();

function stopEffects() {
  for(const effect of activeEffects.values())
    effect.cancel();
  activeEffects.clear();
}

document.addEventListener('visibilitychange', () => {
  if(document.hidden)
    stopEffects();
});

/** Replace the active theme's hooks, cancelling the previous theme's visuals. */
export function setThemeEffects(effects: ThemeEffects = {}) {
  stopEffects();
  currentEffects = effects;
}

/** Game code reports semantic events without knowing the selected theme. */
export function runThemeEffect(event: keyof ThemeEffects, target: HTMLElement) {
  const effect = currentEffects[event];
  if(!effect || !target?.isConnected || document.hidden)
    return;

  activeEffects.get(target)?.cancel();
  const handle = effect(target);
  activeEffects.set(target, handle);
  const cleanup = () => {
    // Completion of an interrupted effect must not remove its replacement.
    if(activeEffects.get(target) === handle) {
      activeEffects.delete(target);
      handle.cancel();
    }
  };
  handle.finished.then(cleanup, cleanup);
}
