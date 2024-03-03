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
  private interval: number; // milliseconds between clock updates
  private lowTimeThreshold: number // mark clock as low-time when it goes below this value

  constructor(game: any, flagFallCallback?: () => void) {
    this.game = game;    
    this.runningClock = '';
    this.wtime = 0; 
    this.btime = 0;
    this.flagFallCallback = flagFallCallback;
    this.interval = 1000; // update clock once a second
    this.lowTimeThreshold = 20000;

    this.setWhiteClock(0);
    this.setBlackClock(0);
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
  private msTilNextInterval(time: number): number {
    const millisecondPart = Math.abs(time) - (Math.floor(Math.abs(time) / this.interval) * this.interval);
    if(time >= 0) 
      return millisecondPart + 1;
    else
      return this.interval - millisecondPart + 1;
  }

  public setWhiteClock(time?: number) {
    this.setClock('w', time);
  }

  public setBlackClock(time?: number) {
    this.setClock('b', time);
  }

  public setClock(color: string, time?: number) {
    if(time === undefined)
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
    if(time === null)
      time = 0;
    
    const clockElement = this.game.color === color ? $('#player-clock') : $('#opponent-clock');  
    const clockTimeElement = clockElement.find('.clock-time'); 
    const fractionalTimeElement = clockElement.find('.fractional-clock-time');    

    clockTimeElement.text(Clock.MSToHHMMSS(time));

    if(time >= this.lowTimeThreshold)
      clockElement.removeClass('low-time');
    else if(this.getRunningClock()) 
      clockElement.addClass('low-time');

    if(time >= this.lowTimeThreshold || time === 0) 
      fractionalTimeElement.hide();
    else {
      var msPart = Math.abs(time) - (Math.floor(Math.abs(time) / 1000) * 1000); // Get fractional part of time remaining
      fractionalTimeElement.text('.' + (Math.floor(msPart / 100))); // Get 10ths of a second digit
      fractionalTimeElement.show();
    }
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
    if(initialTime === null) // player is untimed
      return;

    if(initialTime < this.lowTimeThreshold)
      this.interval = 100;
    else
      this.interval = 1000;

    this.runningClock = color;

    // The timer waits a fractional amount until the next second ticks over
    // e.g. if btime is 60.533 it waits until 59.999 
    // After that the clock will be updated once a second.
    var waitTime = this.msTilNextInterval(initialTime);
    this.timestamp = performance.now();
    var expectedTimeDiff = 0;

    var timerFunc = () => { 
      this.timer = null;

      // Use timestamp to account for timing drift
      expectedTimeDiff += waitTime;
      var timeDiff = performance.now() - this.timestamp;
      var timeAdjustment = expectedTimeDiff - timeDiff;

      var time = initialTime - timeDiff;

      if(time < this.lowTimeThreshold) 
        this.interval = 100;    

      this.updateClockElement(color, time);

      waitTime = this.interval;
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
    this.interval = 1000;
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

