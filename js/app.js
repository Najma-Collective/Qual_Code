/**
 * app.js — Main application logic
 */

const App = {
  state: null,
  snackbarTimeout: null,

  /**
   * Initialise the application
   */
  init() {
    // Check for existing session
    const saved = Storage.load();
    if (saved && saved.studentId) {
      this.showResumeDialog(saved);
    } else {
      this.state = Storage.createEmptyState();
      this.showSetupScreen();
    }
  },

  /**
   * Show the resume/new session dialog
   */
  showResumeDialog(savedState) {
    const overlay = document.getElementById('resume-dialog');
    if (!overlay) {
      this.state = Storage.createEmptyState();
      this.showSetupScreen();
      return;
    }

    document.getElementById('resume-student-id').textContent = savedState.studentId;
    var elapsedMins = Math.floor(savedState.elapsedSeconds / 60);
    document.getElementById('resume-elapsed').textContent = elapsedMins + ' minute(s) elapsed';
    overlay.classList.add('open');

    document.getElementById('btn-resume').onclick = () => {
      overlay.classList.remove('open');
      this.state = savedState;
      this.state.codes.forEach(function(code, i) {
        Coding.codeColourMap[code.id] = Coding.colours[i % Coding.colours.length];
      });
      Coding.colourIndex = this.state.codes.length;
      this.startSession(true);
    };

    document.getElementById('btn-new-session').onclick = () => {
      overlay.classList.remove('open');
      Storage.clear();
      this.state = Storage.createEmptyState();
      this.showSetupScreen();
    };
  },

  /**
   * Show the setup/login screen
   */
  showSetupScreen() {
    document.getElementById('setup-screen').classList.add('active');
    document.getElementById('main-app').classList.remove('active');

    var self = this;
    document.getElementById('btn-start').onclick = function() {
      var studentId = document.getElementById('student-id-input').value.trim();
      if (!studentId) {
        self.showSnackbar('Please enter your Student ID.');
        return;
      }
      // Save API key if provided
      var apiKeyInput = document.getElementById('api-key-input');
      if (apiKeyInput && apiKeyInput.value.trim()) {
        AI.saveApiKey(apiKeyInput.value.trim());
      }
      self.state.studentId = studentId;
      Storage.save(self.state);
      self.startSession(false);
    };
  },

  /**
   * Start or resume the main session.
   * This is deliberately synchronous for all UI setup.
   * Network calls happen in the background.
   */
  startSession(isResume) {
    // 1. Show main app immediately
    document.getElementById('setup-screen').classList.remove('active');
    document.getElementById('main-app').classList.add('active');

    // 2. Load fallback thread content immediately (synchronous, always works)
    this.loadFallbackThread();

    // 3. Set up all UI handlers (synchronous — must never be blocked by network)
    Coding.init();
    this.setupChatInput();
    this.setupDrawer();
    this.setupToolbarActions();

    // 4. Set up timer
    if (!isResume) {
      this.state.sessionStartTime = new Date().toISOString();
      this.state.phase = 'precoding';
      Storage.save(this.state);
    }

    Timer.callbacks.onFiveMinutes = () => {
      if (this.state.phase === 'precoding' || this.state.phase === 'coding') {
        this.state.phase = 'coding';
        Storage.save(this.state);
        this.updatePhaseDisplay();
      }
    };

    Timer.callbacks.onFollowUp = () => {
      if (this.state.phase !== 'followup' && this.state.phase !== 'debrief' && this.state.phase !== 'complete') {
        this.state.phase = 'followup';
        Storage.save(this.state);
        this.updatePhaseDisplay();
        AI.startFollowUp();
      }
    };

    Timer.callbacks.onEnd = () => {
      this.state.phase = 'complete';
      Storage.save(this.state);
      this.endSession();
    };

    Timer.start(this.state.elapsedSeconds);
    this.updatePhaseDisplay();
    this.updateResearchQuestionDisplay();

    // 5. If resuming, restore codes and chat
    if (isResume) {
      Coding.renderCodesList();
      this.restoreChat();
    }

    // 6. Background: try to load the real thread (replaces fallback if successful)
    this.tryLoadThread();

    // 7. Background: initialise AI model selection and greet student
    AI.listAndSelectModel();
    if (!isResume) {
      this.greetStudent();
    }
  },

  /**
   * Try to fetch the real thread from the server.
   * This runs in the background — if it fails, the fallback is already loaded.
   */
  tryLoadThread() {
    var self = this;
    var threadId = this.state.threadId || 'thread-01';
    this.state.threadId = threadId;

    fetch('threads/' + threadId + '/metadata.json')
      .then(function(response) {
        if (!response.ok) throw new Error('Metadata fetch failed: ' + response.status);
        return response.json();
      })
      .then(function(metadata) {
        self.state.researchQuestion = metadata.researchQuestion;
        self.state.threadTitle = metadata.threadTitle;
        self.state.subreddit = metadata.subreddit;
        self.state.aiGuidance = metadata.aiGuidance;
        Storage.save(self.state);
        self.updateResearchQuestionDisplay();

        // Now try to load the thread HTML
        return fetch('threads/' + threadId + '/index.html');
      })
      .then(function(response) {
        if (!response.ok) throw new Error('Thread HTML fetch failed: ' + response.status);
        return response.text();
      })
      .then(function(html) {
        // Only replace if the HTML looks like clean content (not a full page with <html> tags)
        var threadContent = document.getElementById('thread-content');
        if (threadContent && html.length < 500000) {
          threadContent.innerHTML = html;
        }
      })
      .catch(function(err) {
        console.log('Using fallback thread (fetch failed):', err.message);
        // Fallback is already loaded, nothing to do
      });
  },

  /**
   * Load fallback thread content synchronously into the DOM
   */
  loadFallbackThread() {
    var threadContent = document.getElementById('thread-content');
    if (!threadContent) return;

    // Set default metadata if not already set
    if (!this.state.threadTitle) {
      this.state.threadTitle = 'What are your guys thoughts on BWIA West Indies Airways when it was in service?';
      this.state.subreddit = 'r/AskTheCaribbean';
      this.state.researchQuestion = 'How do Reddit members signal Caribbean identity?';
      this.state.aiGuidance = 'Focus assessment on whether the student identifies: (1) nostalgia as a vehicle for collective Caribbean identity construction; (2) the tension between colonial naming and post-independence identity; (3) how humour and affectionate nicknames function as in-group markers; (4) sensory memory as anchors for cultural belonging; (5) the distinction between institutional critique and personal affection.';
      Storage.save(this.state);
    }

    threadContent.innerHTML =
      '<div class="reddit-thread">' +
        '<div class="reddit-header">' +
          '<span class="reddit-sub">r/AskTheCaribbean</span>' +
          '<h2 class="reddit-title">What are your guys thoughts on BWIA West Indies Airways when it was in service?</h2>' +
          '<span class="reddit-meta">Posted by u/Pretty_Aside_7674 &middot; 15 days ago</span>' +
        '</div>' +
        '<div class="reddit-post">' +
          '<p>What are your guys thoughts on BWIA West Indies Airways when it was in service?</p>' +
        '</div>' +
        '<div class="reddit-comments">' +
          '<div class="reddit-comment">' +
            '<span class="reddit-author">u/ma70_</span>' +
            '<p>I loved their last livery. And the nickname Bwee</p>' +
          '</div>' +
          '<div class="reddit-comment">' +
            '<span class="reddit-author">u/Infamous_Copy_3659</span>' +
            '<p>I always knew that I was on the way home when I boarded and ordered a Solo Apple J. They also had red Solo if I recall correctly. And they made good spicy bloody marys.</p>' +
          '</div>' +
          '<div class="reddit-comment reply">' +
            '<span class="reddit-author">u/Carribeantimberwolf</span>' +
            '<p>The brown stew chicken sandwich was clutch</p>' +
          '</div>' +
          '<div class="reddit-comment">' +
            '<span class="reddit-author">u/Kelvin62</span>' +
            '<p>But Will It Arrive?</p>' +
          '</div>' +
          '<div class="reddit-comment reply">' +
            '<span class="reddit-author">u/ProfessionSoft7944</span>' +
            '<p>Better Walk If Able</p>' +
          '</div>' +
          '<div class="reddit-comment reply">' +
            '<span class="reddit-author">u/Infamous_Copy_3659</span>' +
            '<p>I remember this one</p>' +
          '</div>' +
          '<div class="reddit-comment reply">' +
            '<span class="reddit-author">u/disgruntledmarmoset</span>' +
            '<p>Sounds like Bahamasair lol</p>' +
          '</div>' +
          '<div class="reddit-comment reply">' +
            '<span class="reddit-author">u/Lazy-Community-1288</span>' +
            '<p>Bound to wait in airport</p>' +
          '</div>' +
          '<div class="reddit-comment">' +
            '<span class="reddit-author">u/GUYman299</span>' +
            '<p>The service was always fine but I remember that, even at 8, finding it weird that the national airline was called BRITISH West Indian Airways. To be honest I found no significant change in actual service when it became Caribbean Airlines but I thought the name was more appropriate.</p>' +
          '</div>' +
          '<div class="reddit-comment reply">' +
            '<span class="reddit-author">u/StrategyFlashy4526</span>' +
            '<p>It was part of British Overseas Airways Corporation and was probably a well established trade name by the time it was sold to the Trinidad Gov. Changing trade name could lead to loss of business.</p>' +
          '</div>' +
          '<div class="reddit-comment reply">' +
            '<span class="reddit-author">u/Pure_Toe3513</span>' +
            '<p>Exactly, quite appropriate for the time of founding. In fact, the legacy is not completely dead as the codes BW and BWA are still used.</p>' +
          '</div>' +
          '<div class="reddit-comment">' +
            '<span class="reddit-author">u/Knight-Man</span>' +
            '<p>This commercial was the last one I remember before it ceased operations in 2006 and it has lived rent free in my mind for 20 years now. It used to air during the evening news.</p>' +
          '</div>' +
          '<div class="reddit-comment">' +
            '<span class="reddit-author">u/[deleted]</span>' +
            '<p>I loved it, but I knew there was always going to be a delay!</p>' +
          '</div>' +
        '</div>' +
      '</div>';
  },

  /**
   * Escape HTML entities
   */
  escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  },

  /**
   * Update the research question display
   */
  updateResearchQuestionDisplay() {
    var el = document.getElementById('research-question-text');
    if (el && this.state.researchQuestion) {
      el.textContent = this.state.researchQuestion;
    }
  },

  /**
   * Update phase display in the UI
   */
  updatePhaseDisplay() {
    var el = document.getElementById('phase-display');
    if (!el) return;

    var phaseLabels = {
      setup: 'Setup',
      precoding: 'Pre-coding',
      coding: 'Coding',
      followup: 'Follow-up',
      debrief: 'Debrief',
      complete: 'Complete'
    };

    el.textContent = phaseLabels[this.state.phase] || this.state.phase;
  },

  /**
   * Greet the student via AI
   */
  greetStudent() {
    var self = this;
    AI.sendMessage(
      '[SYSTEM: The session has just started. The student\'s ID is "' + this.state.studentId + '". The research question is: "' + this.state.researchQuestion + '". The thread being analysed is titled "' + this.state.threadTitle + '" from ' + this.state.subreddit + '. Please greet the student warmly and briefly explain the task.]'
    ).then(function(greeting) {
      self.addChatMessage('model', greeting);
    }).catch(function(err) {
      console.error('AI greeting failed:', err);
      self.addChatMessage('model', 'Welcome! Today you will read a Reddit thread and practise qualitative coding. Take a few minutes to read the thread first, then start creating codes by selecting text. I\'m here if you need help.');
    });
  },

  /**
   * Set up chat input handling
   */
  setupChatInput() {
    var input = document.getElementById('chat-input');
    var sendBtn = document.getElementById('btn-send');
    var self = this;

    var sendMessage = function() {
      var text = input.value.trim();
      if (!text) return;

      input.value = '';
      self.addChatMessage('user', text);

      // Track follow-up responses
      if (self.state.phase === 'followup') {
        var history = self.state.conversationHistory;
        var lastAiMsg = null;
        for (var i = history.length - 1; i >= 0; i--) {
          if (history[i].role === 'model') {
            lastAiMsg = history[i];
            break;
          }
        }
        if (lastAiMsg) {
          self.state.aiFollowUpResponses.push({
            question: lastAiMsg.parts[0].text,
            answer: text
          });
          Storage.save(self.state);

          if (self.state.aiFollowUpResponses.length >= 4 && self.state.phase !== 'debrief') {
            setTimeout(function() { AI.startDebrief(); }, 500);
            return;
          }
        }
      }

      // Track debrief response
      if (self.state.phase === 'debrief' && !self.state.keyTakeaway) {
        self.state.keyTakeaway = text;
        Storage.save(self.state);
      }

      // Send to AI
      self.showTypingIndicator();
      AI.sendMessage(text).then(function(response) {
        self.hideTypingIndicator();
        self.addChatMessage('model', response);
      }).catch(function(err) {
        self.hideTypingIndicator();
        self.addChatMessage('system', 'Could not reach the AI. Your message has been saved.');
      });
    };

    if (sendBtn) {
      sendBtn.onclick = sendMessage;
    }

    if (input) {
      input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }
      });
    }
  },

  /**
   * Add a message to the chat display
   */
  addChatMessage(role, text) {
    var container = document.getElementById('chat-messages');
    if (!container) return;

    var msg = document.createElement('div');
    msg.className = 'chat-message chat-message--' + role;

    var bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.textContent = text;

    msg.appendChild(bubble);
    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;
  },

  /**
   * Show typing indicator
   */
  showTypingIndicator() {
    var container = document.getElementById('chat-messages');
    if (!container) return;

    var indicator = document.getElementById('typing-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'typing-indicator';
      indicator.className = 'chat-message chat-message--model';
      indicator.innerHTML = '<div class="chat-bubble typing-bubble"><span></span><span></span><span></span></div>';
      container.appendChild(indicator);
    }
    indicator.style.display = 'flex';
    container.scrollTop = container.scrollHeight;
  },

  /**
   * Hide typing indicator
   */
  hideTypingIndicator() {
    var indicator = document.getElementById('typing-indicator');
    if (indicator) indicator.style.display = 'none';
  },

  /**
   * Restore chat from conversation history
   */
  restoreChat() {
    var self = this;
    this.state.conversationHistory.forEach(function(msg) {
      if (msg.parts[0].text.indexOf('[SYSTEM:') === 0) return;
      self.addChatMessage(msg.role === 'model' ? 'model' : 'user', msg.parts[0].text);
    });
  },

  /**
   * Set up hamburger menu / drawer
   */
  setupDrawer() {
    var menuBtn = document.getElementById('btn-menu');
    var drawer = document.getElementById('codes-drawer');
    var scrim = document.getElementById('drawer-scrim');

    if (menuBtn && drawer) {
      menuBtn.onclick = function() {
        drawer.classList.toggle('open');
        if (scrim) scrim.classList.toggle('open');
      };
    }

    if (scrim) {
      scrim.onclick = function() {
        drawer.classList.remove('open');
        scrim.classList.remove('open');
      };
    }
  },

  /**
   * Set up toolbar action buttons
   */
  setupToolbarActions() {
    var createCodeBtn = document.getElementById('btn-create-code');
    if (createCodeBtn) {
      createCodeBtn.onclick = function() {
        var toolbar = document.getElementById('annotation-toolbar');
        var selectedText = toolbar ? toolbar.dataset.selectedText : '';
        if (selectedText) {
          Coding.openCodeModal(selectedText);
          toolbar.classList.remove('visible');
        }
      };
    }

    var boldBtn = document.getElementById('btn-bold');
    if (boldBtn) boldBtn.onclick = function() { Coding.applyAnnotation('bold'); };

    var underlineBtn = document.getElementById('btn-underline');
    if (underlineBtn) underlineBtn.onclick = function() { Coding.applyAnnotation('underline'); };

    var hlYellow = document.getElementById('btn-highlight-yellow');
    if (hlYellow) hlYellow.onclick = function() { Coding.applyAnnotation('highlight', '#FDEAA8'); };

    var hlGreen = document.getElementById('btn-highlight-green');
    if (hlGreen) hlGreen.onclick = function() { Coding.applyAnnotation('highlight', '#A8D8B9'); };

    var hlPink = document.getElementById('btn-highlight-pink');
    if (hlPink) hlPink.onclick = function() { Coding.applyAnnotation('highlight', '#F8B4C8'); };

    var hlBlue = document.getElementById('btn-highlight-blue');
    if (hlBlue) hlBlue.onclick = function() { Coding.applyAnnotation('highlight', '#A8C8F0'); };

    var saveCodeBtn = document.getElementById('btn-save-code');
    if (saveCodeBtn) saveCodeBtn.onclick = function() { Coding.saveCode(); };

    var cancelCodeBtn = document.getElementById('btn-cancel-code');
    if (cancelCodeBtn) cancelCodeBtn.onclick = function() { Coding.closeCodeModal(); };

    var confirmDeleteBtn = document.getElementById('btn-confirm-delete');
    if (confirmDeleteBtn) {
      confirmDeleteBtn.onclick = function() {
        var dialog = document.getElementById('delete-dialog');
        var codeId = dialog.dataset.codeId;
        if (codeId) Coding.deleteCode(codeId);
        dialog.classList.remove('open');
      };
    }

    var cancelDeleteBtn = document.getElementById('btn-cancel-delete');
    if (cancelDeleteBtn) {
      cancelDeleteBtn.onclick = function() {
        document.getElementById('delete-dialog').classList.remove('open');
      };
    }

    var exportBtn = document.getElementById('btn-export');
    if (exportBtn) exportBtn.onclick = function() { Export.generatePDF(); };

    var settingsBtn = document.getElementById('btn-settings');
    var settingsPanel = document.getElementById('settings-panel');
    if (settingsBtn && settingsPanel) {
      settingsBtn.onclick = function() { settingsPanel.classList.toggle('open'); };
    }
  },

  /**
   * End the session
   */
  endSession() {
    Timer.stop();
    this.updatePhaseDisplay();

    var input = document.getElementById('chat-input');
    if (input) {
      input.disabled = true;
      input.placeholder = 'Session complete';
    }

    var exportBtn = document.getElementById('btn-export');
    if (exportBtn) exportBtn.style.display = 'inline-flex';

    this.addChatMessage('system', 'Session complete! You can now export your work as a PDF using the export button.');
    this.showSnackbar('Session complete. You can now export your work.');
  },

  /**
   * Show a snackbar notification
   */
  showSnackbar(message) {
    var snackbar = document.getElementById('snackbar');
    if (!snackbar) return;

    var label = snackbar.querySelector('.mdc-snackbar__label');
    if (label) label.textContent = message;

    snackbar.classList.add('mdc-snackbar--open');

    if (this.snackbarTimeout) clearTimeout(this.snackbarTimeout);
    this.snackbarTimeout = setTimeout(function() {
      snackbar.classList.remove('mdc-snackbar--open');
    }, 4000);
  }
};

// Initialise when DOM is ready
document.addEventListener('DOMContentLoaded', function() { App.init(); });
