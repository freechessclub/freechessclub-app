// Copyright 2023 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

export class Clock {
  private game: any;
  private timer: any;
  private wtime: number; // initial time for white clock (set after call to setClock() or stopClocks())
  private btime: number; // initial time for black clock (set after call to setClock() or stopClocks())
  private timestamp: number;
  private runningClock: string; // 'w' if white clock running, 'b' for black, or '' if no clock running
  private flagFallCallback: () => void;

  constructor(game: any, flagFallCallback?: () => void) {
    this.game = game;    
    this.runningClock = '';
    this.wtime = 0; 
    this.btime = 0;
    this.flagFallCallback = flagFallCallback;
  }

  /**
   * Convert milliseconds to HH:MM:SS.
   */
  public static MSToHHMMSS(milliseconds: number) {
    const sec = Math.abs(Math.floor(Math.abs(milliseconds) / 1000));
    const h = Math.abs(Math.floor(Math.abs(sec) / 3600));
    const m = Math.abs(Math.floor(Math.abs(sec) % 3600 / 60));
    const s = Math.abs(Math.floor(Math.abs(sec) % 3600 % 60));
    return ((milliseconds < 0 ? '-' : '')
    + (h > 0 ? (h >= 0 && h < 10 ? '0' : '') + h + ':' : '')
    + (m >= 0 && m < 10 ? '0' : '') + m + ':'
    + (s >= 0 && s < 10 ? '0' : '') + s);
  }

  /* When starting a clock, get the millisecond part of the time, and wait that long before
    decrementing the clock the first time. 
    e.g. Let's say wtime is 60533 (00:60.533), so wait 534 milliseconds until wtime is 59999 (00:59.999)
    then set the clock to 00:59 and decrement it every 1000ms after that */
  private static msTilNextInterval(time: number): number {
    const millisecondPart = Math.abs(time) - (Math.floor(Math.abs(time) / 1000) * 1000);
    if(time >= 0) 
      return millisecondPart + 1;
    else
      return 1000 - millisecondPart + 1;
  }

  public setWhiteClock(time?: number) {
    this.setClock('w', time);
  }

  public setBlackClock(time?: number) {
    this.setClock('b', time);
  }

  public setClock(color: string, time?: number) {
    if(time === undefined || time === null)
      time = (color === 'w' ? this.game.wtime : this.game.btime);

    if(this.getRunningClock() === color)
      this.stopClocks();

    this.updateClockElement(color, time);

    if(color === 'w') 
      this.wtime = time;
    else
      this.btime = time;
  }

  private updateClockElement(color: string, time: number) {
    const clockElement = this.game.color === color ? $('#player-time') : $('#opponent-time');
    //var sec = Math.abs(time < 0 ? Math.ceil(time / 1000) : Math.floor(time / 1000));
    //clockElement.text((time < 0 ? '-' : '') + Clock.SToHHMMSS(sec)); // Add the - sign on separately to allow for -00:00
    clockElement.text(Clock.MSToHHMMSS(time));

    if(time >= 20000)
      clockElement.removeClass('low-time');
  }

  public startBlackClock() {
    this.startClock('b');
  }

  public startWhiteClock() {
    this.startClock('w');
  }

  public startClock(color: string) {
    this.stopClocks();
    var initialTime = (color === 'w' ? this.wtime : this.btime);
    this.runningClock = color;

    // The timer waits a fractional amount until the next second ticks over
    // e.g. if btime is 60.533 it waits until 59.999 
    // After that the clock will be updated once a second.
    var waitTime = Clock.msTilNextInterval(initialTime);
    this.timestamp = performance.now();
    var expectedTimeDiff = 0;

    var timerFunc = () => { 
      this.timer = null;

      // Use timestamp to account for timing drift
      expectedTimeDiff += waitTime;
      var timeDiff = performance.now() - this.timestamp;
      var timeAdjustment = expectedTimeDiff - timeDiff;

      var time = initialTime - timeDiff;

      if(time < 20000) {
        const clockElement = this.game.color === color ? $('#player-time') : $('#opponent-time');
        clockElement.addClass('low-time');
      }

      this.updateClockElement(color, time);

      waitTime = 1000;
      var adjustedWaitTime = Math.max(0, waitTime + timeAdjustment);
      this.timer = setTimeout(timerFunc, adjustedWaitTime);

      if(time < 0 && this.flagFallCallback)
        this.flagFallCallback();
    };
    this.timer = setTimeout(timerFunc, waitTime);
  }

  public stopClocks() {
    if(this.getRunningClock() === 'w')
      this.wtime -= (performance.now() - this.timestamp);
    else if(this.getRunningClock() === 'b')
      this.btime -= (performance.now() - this.timestamp);
    
    clearTimeout(this.timer);
    this.runningClock = '';  
  }

  public getWhiteTime(): number {
    if(this.getRunningClock() === 'w')
      return this.wtime - (performance.now() - this.timestamp);
    else
      return this.wtime;
  }

  public getBlackTime(): number {
    if(this.getRunningClock() === 'b')
      return this.btime - (performance.now() - this.timestamp);
    else
      return this.btime;
  }

  public getRunningClock(): string {
    return this.runningClock;
  }
}

