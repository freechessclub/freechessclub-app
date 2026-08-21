// Copyright 2026 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import { TrainingBotState } from './trainingbot';

const COMPLETION_MESSAGE = /Thank you for playing endgamebot\./i;
const COMMAND_PROMPT = /\btype\s+"tell endgamebot\b/i;
const FORCE_INSTRUCTIONS = /\s*You have to find the best moves, disable with "tell endgamebot force"\s*$/i;
const INTRO_INSTRUCTIONS = /^Hello from endgamebot\.\s*"tell endgamebot hint"\s+if you want a hint or\s+"back"\s+if you want to make a different move\s*/i;
const SUBOPTIMAL_MOVE_MESSAGE = /\bYou have a better move\b/i;

function normalizeMessage(message: string) {
  return message?.trim()
    .replace(INTRO_INSTRUCTIONS, '')
    .replace(FORCE_INSTRUCTIONS, '');
}

export class EndgameBotState extends TrainingBotState {
  readonly kind = 'endgame' as const;

  constructor(playCommand = 'play -f kpk', objectiveMessages: string[] = []) {
    super(playCommand, objectiveMessages
      .map(normalizeMessage)
      .filter(message => message && !COMMAND_PROMPT.test(message)));
  }

  finish() {
    super.finish();
    this.feedbackPending = false;
  }

  recordMessage(message: string) {
    const normalized = normalizeMessage(message);
    if(!normalized || COMMAND_PROMPT.test(normalized))
      return;

    const completed = COMPLETION_MESSAGE.test(normalized);
    const suboptimalMove = SUBOPTIMAL_MOVE_MESSAGE.test(normalized);
    if(completed || this.feedbackPending)
      this.feedbackMessages = [];

    if(suboptimalMove)
      this.wrongMove = true;

    const messages = this.feedbackPending || completed || this.interactionStarted
      ? this.feedbackMessages
      : this.objectiveMessages;
    if(messages[messages.length - 1] !== normalized)
      messages.push(normalized);

    if(this.feedbackPending)
      this.feedbackPending = false;
    if(completed)
      this.finish();
  }

  protected fallbackObjective() {
    return 'Endgame Training';
  }
}
