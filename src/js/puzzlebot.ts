// Copyright 2026 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

const WRONG_MOVE_MESSAGE = /There is a better move\./i;
const SOLVED_MESSAGE = /You solved problem number/i;
const STATS_MESSAGE = /You made \d+ wrong moves?|needed \d+ hints?/i;
const COMMAND_PROMPT = /\btype\s+"tell puzzlebot\b/i;

export class PuzzleBotState {
  ended = false;
  feedbackPending = false;
  feedbackMessages: string[] = [];
  loadedCommand: string;
  moveAttempted = false;
  nextCommand: string;
  objectiveMessages: string[];
  wrongMove = false;

  constructor(command = 'getmate', objectiveMessages: string[] = []) {
    this.loadedCommand = command;
    this.nextCommand = command;
    this.objectiveMessages = objectiveMessages.filter(message => !COMMAND_PROMPT.test(message));
  }

  get objectiveText() {
    return this.objectiveMessages.join('\n') || this.commandLabel();
  }

  get feedbackText() {
    return this.feedbackMessages.slice(-2).join('\n');
  }

  requestHint() {
    this.feedbackPending = true;
    this.feedbackMessages = [];
    this.wrongMove = false;
  }

  requestSolution() {
    this.feedbackPending = true;
    this.feedbackMessages = [];
    this.finish();
  }

  submitMove() {
    this.moveAttempted = true;
    this.feedbackMessages = this.feedbackMessages.filter(message => !WRONG_MOVE_MESSAGE.test(message));
    this.wrongMove = false;
  }

  finish() {
    this.ended = true;
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
    const messages = feedback || this.moveAttempted
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

  private commandLabel() {
    if(this.loadedCommand.startsWith('gettactics'))
      return 'Tactics Puzzle';
    if(this.loadedCommand.startsWith('getstudy'))
      return 'Chess Study';
    return 'Mate Puzzle';
  }
}
