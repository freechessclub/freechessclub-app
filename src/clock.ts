// Copyright 2023 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

/**
 * Convert seconds to HH:MM:SS.
 */
export function SToHHMMSS(sec: number) {
  const h = Math.abs(Math.floor(Math.abs(sec) / 3600));
  const m = Math.abs(Math.floor(Math.abs(sec) % 3600 / 60));
  const s = Math.abs(Math.floor(Math.abs(sec) % 3600 % 60));
  return ((sec < 0 ? '-' : '')
  + (h > 0 ? (h >= 0 && h < 10 ? '0' : '') + h + ':' : '')
  + (m >= 0 && m < 10 ? '0' : '') + m + ':'
  + (s >= 0 && s < 10 ? '0' : '') + s);
}

export function updateWhiteClock(game, wtime?: number) {
  if(wtime === undefined)
    wtime = game.wtime; 

  const clock = game.color === 'w' ? $('#player-time') : $('#opponent-time');
  clock.text(SToHHMMSS(wtime));

  if(game.wtime < 20) 
    clock.addClass('low-time');
  else
    clock.removeClass('low-time');
}

export function updateBlackClock(game, btime?: number) {
  if(btime === undefined)
    btime = game.btime; 

  const clock = game.color === 'b' ? $('#player-time') : $('#opponent-time');
  clock.text(SToHHMMSS(btime));

  if(game.btime < 20) 
    clock.addClass('low-time');
  else
    clock.removeClass('low-time');
}

export function startBlackClock(game) {
  return setInterval(() => {
    if (game.chess.turn() === 'w') {
      return;
    }

    game.btime = game.btime - 1;
    const clock = game.color === 'w' ? $('#opponent-time') : $('#player-time');
    if(game.btime < 20) 
      clock.addClass('low-time');
    else
      clock.removeClass('low-time');
  
    clock.text(SToHHMMSS(game.btime));
  }, 1000);
}

export function startWhiteClock(game) {
  return setInterval(() => {
    if (game.chess.turn() === 'b') {
      return;
    }

    game.wtime = game.wtime - 1;
    const clock = game.color === 'w' ? $('#player-time') : $('#opponent-time');
    if(game.wtime < 20)
      clock.addClass('low-time');
    else
      clock.removeClass('low-time');

    clock.text(SToHHMMSS(game.wtime));
  }, 1000);
}
