// Copyright 2019 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

// An online chess game
export const game = {
  playerCaptured: {},
  oppCaptured: {},
  chess: null,
  color: '',
  history: null,
  premove: null,
  bclock: null,
  btime: 0,
  wclock: null,
  wtime: 0,
  obs: false,
  examine: false,
};

export default game;
