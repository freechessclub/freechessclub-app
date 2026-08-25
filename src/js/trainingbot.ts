// Copyright 2026 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

export type TrainingBotKind = 'puzzle' | 'endgame';

export abstract class TrainingBotState {
  abstract readonly kind: TrainingBotKind;
  ended = false;
  feedbackPending = false;
  feedbackMessages: string[] = [];
  interactionStarted = false;
  loadCommand: string;
  nextCommand: string;
  objectiveMessages: string[];
  wrongMove = false;

  constructor(command: string, objectiveMessages: string[] = []) {
    this.loadCommand = command;
    this.nextCommand = command;
    this.objectiveMessages = objectiveMessages;
  }

  get objectiveText() {
    return this.objectiveMessages.join('\n') || this.fallbackObjective();
  }

  get feedbackText() {
    return this.feedbackMessages.slice(-2).join('\n');
  }

  requestFeedback() {
    this.feedbackPending = true;
    this.feedbackMessages = [];
    this.interactionStarted = true;
    this.wrongMove = false;
  }

  submitMove() {
    this.interactionStarted = true;
    this.feedbackMessages = [];
    this.wrongMove = false;
  }

  finish() {
    this.ended = true;
    this.wrongMove = false;
  }

  abstract recordMessage(message: string): void;

  protected abstract fallbackObjective(): string;
}
