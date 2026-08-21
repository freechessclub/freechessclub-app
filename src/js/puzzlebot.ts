// Copyright 2026 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import { TrainingBotState } from './trainingbot';

const WRONG_MOVE_MESSAGE = /There is a better move\./i;
const SOLVED_MESSAGE = /You solved problem number/i;
const STATS_MESSAGE = /You made \d+ wrong moves?|needed \d+ hints?/i;
const COMMAND_PROMPT = /\btype\s+"tell puzzlebot\b/i;

export class PuzzleBotState extends TrainingBotState {
  readonly kind = 'puzzle' as const;

  constructor(command = 'getmate', objectiveMessages: string[] = []) {
    super(command, objectiveMessages.filter(message => !COMMAND_PROMPT.test(message)));
  }

  requestSolution() {
    this.requestFeedback();
    this.finish();
  }

  submitMove() {
    this.interactionStarted = true;
    this.feedbackMessages = this.feedbackMessages.filter(message => !WRONG_MOVE_MESSAGE.test(message));
    this.wrongMove = false;
  }

  recordMessage(message: string) {
    const normalized = message?.trim();
    if(!normalized || COMMAND_PROMPT.test(normalized))
      return;

    const solved = SOLVED_MESSAGE.test(normalized);
    if(solved || this.feedbackPending)
      this.feedbackMessages = [];

    const feedback = this.feedbackPending || WRONG_MOVE_MESSAGE.test(normalized)
        || solved || STATS_MESSAGE.test(normalized);
    const messages = feedback || this.interactionStarted
      ? this.feedbackMessages
      : this.objectiveMessages;
    if(messages[messages.length - 1] !== normalized)
      messages.push(normalized);

    if(this.feedbackPending)
      this.feedbackPending = false;
    if(WRONG_MOVE_MESSAGE.test(normalized))
      this.wrongMove = true;
    if(solved)
      this.finish();
  }

  protected fallbackObjective() {
    if(this.loadCommand.startsWith('gettactics'))
      return 'Tactics Puzzle';
    if(this.loadCommand.startsWith('getstudy'))
      return 'Chess Study';
    return 'Mate Puzzle';
  }
}
