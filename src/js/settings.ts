import { isMobile } from './utils';

const deviceMemory = (navigator as any).deviceMemory || 4; // GB

export const settings = {
  /** Main settings */
  
  // tracks if the person has visited the site before
  visited: false,
  // toggle game sounds
  soundToggle: true,
  // toggle for auto-promote to queen
  autoPromoteToggle: false,
  // toggle for showing Computer opponents in the lobby
  lobbyShowComputersToggle: false,
  // toggle for showing Rated games in the lobby
  lobbyShowUnratedToggle: true,
  // toggle for automatically showing new slide-down notifications or notifications in chat channels
  notificationsToggle: true,
  // toggle for showing highlights/graphics on the board
  highlightsToggle: true,
  // toggle for showing highlights/graphics on the board
  wakelockToggle: true,
  // toggle for multi-board mode / single-board mode
  multiboardToggle: true,
  // toggle for enabling multiple premoves
  multiplePremovesToggle: false,
  // toggle for enabling smart move
  smartmoveToggle: false,
  // toggle for remembering user's login and password between sessions
  rememberMeToggle: false,
  
  /** Engine settings */ 

  // toggle for showing the eval bar when the engine is running
  evalBarToggle: true,
  // toggle for showing the best move arrow when the engine is running
  bestMoveArrowToggle: true,
  // name of the chess engine to use
  analyzeEngineName: isMobile() && deviceMemory < 4 ? 'Stockfish MV 2019' : 'Stockfish 17.1 Lite',
  playEngineName: isMobile() && deviceMemory < 4 ? 'Stockfish MV 2019' : 'Stockfish 17.1 Lite',
  variantsEngineName: 'Stockfish MV 2019',
  // engine options
  engineLines: 1,
  engineMaxTime: 5000, // ms
  engineThreads: isMobile() ? 1 : Math.min(navigator.hardwareConcurrency - 1, 5),
  engineMemory: 16, // MB

  /** Chat settings */

  // toggle for displaying timestamps on messages
  timestampToggle: true,
  // toggle for creating separate chat tabs instead of displaying messages in the console
  chattabsToggle: true,

  /** History settings */

  pieceGlyphsToggle: true,
}

