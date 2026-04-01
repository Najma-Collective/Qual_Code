/**
 * timer.js — Session timer logic (20-minute countdown)
 */

const Timer = {
  totalSeconds: 20 * 60, // 20 minutes
  intervalId: null,
  callbacks: {
    onTick: null,
    onFiveMinutes: null,
    onFollowUp: null,
    onEnd: null
  },
  fiveMinuteFired: false,
  followUpFired: false,

  /**
   * Start or resume the timer from the given elapsed seconds
   */
  start(elapsedSeconds) {
    if (this.intervalId) clearInterval(this.intervalId);

    App.state.elapsedSeconds = elapsedSeconds || 0;
    this.checkMilestones(App.state.elapsedSeconds);

    this.intervalId = setInterval(() => {
      App.state.elapsedSeconds++;
      const remaining = this.totalSeconds - App.state.elapsedSeconds;

      this.updateDisplay(remaining);
      Storage.save(App.state);

      this.checkMilestones(App.state.elapsedSeconds);

      if (remaining <= 0) {
        this.stop();
        if (this.callbacks.onEnd) this.callbacks.onEnd();
      }
    }, 1000);

    this.updateDisplay(this.totalSeconds - App.state.elapsedSeconds);
  },

  /**
   * Check timer milestones and trigger phase transitions
   */
  checkMilestones(elapsed) {
    // At 5 minutes: prompt to start coding
    if (elapsed >= 300 && !this.fiveMinuteFired) {
      this.fiveMinuteFired = true;
      if (App.state.phase === 'precoding') {
        App.state.phase = 'coding';
        Storage.save(App.state);
      }
      if (this.callbacks.onFiveMinutes) this.callbacks.onFiveMinutes();
    }

    // At 15 minutes: begin follow-up
    if (elapsed >= 900 && !this.followUpFired) {
      this.followUpFired = true;
      if (App.state.phase === 'coding') {
        App.state.phase = 'followup';
        Storage.save(App.state);
      }
      if (this.callbacks.onFollowUp) this.callbacks.onFollowUp();
    }
  },

  /**
   * Update the timer display element
   */
  updateDisplay(remainingSeconds) {
    const el = document.getElementById('timer-display');
    if (!el) return;

    const mins = Math.max(0, Math.floor(remainingSeconds / 60));
    const secs = Math.max(0, remainingSeconds % 60);
    const display = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    el.textContent = display;

    // Update ARIA live region
    const ariaEl = document.getElementById('timer-aria');
    if (ariaEl && remainingSeconds % 60 === 0 && remainingSeconds > 0) {
      ariaEl.textContent = `${mins} minutes remaining`;
    }

    // Warning colour when under 5 minutes
    if (remainingSeconds <= 300) {
      el.classList.add('timer--warning');
    } else {
      el.classList.remove('timer--warning');
    }
  },

  /**
   * Stop the timer
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  },

  /**
   * Get elapsed minutes (for system prompt)
   */
  getElapsedMinutes() {
    return Math.floor(App.state.elapsedSeconds / 60);
  },

  /**
   * Get remaining seconds
   */
  getRemaining() {
    return Math.max(0, this.totalSeconds - App.state.elapsedSeconds);
  }
};
