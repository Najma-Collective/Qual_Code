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

    document.getElementById('btn-start').onclick = () => {
      var studentId = document.getElementById('student-id-input').value.trim();
      if (!studentId) {
        this.showSnackbar('Please enter your Student ID.');
        return;
      }
      this.state.studentId = studentId;
      Storage.save(this.state);
      this.startSession(false);
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
      this.state.threadTitle = "What's your favourite Caribbean dish?";
      this.state.subreddit = 'r/AskCaribbean';
      this.state.researchQuestion = 'How do participants in r/AskCaribbean construct and negotiate Caribbean culinary identity through food discourse?';
      this.state.aiGuidance = 'Focus assessment on whether the student identifies cultural identity markers in food descriptions, recognises in-group/out-group dynamics in recipe attribution, and connects food practices to broader Caribbean cultural narratives.';
      Storage.save(this.state);
    }

    threadContent.innerHTML =
      '<div class="reddit-thread">' +
        '<div class="reddit-header">' +
          '<span class="reddit-sub">' + this.escapeHtml(this.state.subreddit) + '</span>' +
          '<h2 class="reddit-title">' + this.escapeHtml(this.state.threadTitle) + '</h2>' +
          '<span class="reddit-meta">Posted by u/caribbeanfoodie42 &middot; 3 months ago</span>' +
        '</div>' +
        '<div class="reddit-post">' +
          '<p>Hey everyone! I\'m curious about what dishes make you feel most connected to your Caribbean identity. What\'s the one dish that screams "home" for you?</p>' +
        '</div>' +
        '<div class="reddit-comments">' +
          '<div class="reddit-comment">' +
            '<span class="reddit-author">u/trini_pride</span>' +
            '<p>Pelau, no question. My grandmother used to make it every Sunday. The way the rice gets that brown colour from the caramelised sugar... there\'s nothing like it. I always feel proud when someone mentions our pelau because it\'s uniquely ours.</p>' +
          '</div>' +
          '<div class="reddit-comment">' +
            '<span class="reddit-author">u/jamaicanroots</span>' +
            '<p>For me it\'s ackee and saltfish. My mother learned it from her mother, who learned from her grandmother. My grandmother\'s recipe, passed down from slavery days, uses scotch bonnet in a way that nobody else does. When I cook it abroad, the smell takes me straight back to Kingston.</p>' +
          '</div>' +
          '<div class="reddit-comment">' +
            '<span class="reddit-author">u/haitiankreyol</span>' +
            '<p>Griot with pikliz. Every celebration, every family gathering. You can\'t be Haitian without griot. When I moved to Montreal, the first thing I did was find a Haitian restaurant. The food is how we stay connected. Li nan san nou \u2014 it\'s in our blood.</p>' +
          '</div>' +
          '<div class="reddit-comment">' +
            '<span class="reddit-author">u/bajan_queen</span>' +
            '<p>Cou-cou and flying fish. But honestly? I think the younger generation is losing these recipes. My niece asked me what cou-cou was last week. That hurt. We need to write these things down before they disappear. The tradition vs modernity struggle is real in Barbados right now.</p>' +
          '</div>' +
          '<div class="reddit-comment">' +
            '<span class="reddit-author">u/guyanese_diaspora</span>' +
            '<p>Pepperpot. It\'s the taste of Christmas morning. My father says the pot should never be empty \u2014 you just keep adding to it. There\'s something beautiful about a dish that literally carries the flavours of yesterday into today. It\'s history in a pot.</p>' +
          '</div>' +
          '<div class="reddit-comment">' +
            '<span class="reddit-author">u/cuban_in_miami</span>' +
            '<p>Ropa vieja. The name means "old clothes" but the taste is anything but old. I\'ve been making it differently from my abuela though. She would be horrified that I use a pressure cooker. But I keep her sofrito recipe exactly the same. Some things you don\'t change. That\'s the compromise \u2014 you adapt the method but keep the soul.</p>' +
          '</div>' +
          '<div class="reddit-comment">' +
            '<span class="reddit-author">u/dominican_york</span>' +
            '<p>Mang\u00fa con los tres golpes. Every single morning. People think Dominican food is simple but there\'s so much technique in getting the mang\u00fa right. Too many plantains and it\'s heavy, too few and it\'s just mush. My t\u00eda says cooking is like life \u2014 balance is everything. I miss her kitchen so much sometimes it makes me cry.</p>' +
          '</div>' +
          '<div class="reddit-comment">' +
            '<span class="reddit-author">u/soca_soul</span>' +
            '<p>I notice nobody mentioned how food at Carnival is different. The doubles you eat at 3am after playing mas is NOT the same as doubles from a regular vendor. There\'s magic in that context. The food tastes better because of where you are and who you\'re with. That\'s something outsiders never understand about Caribbean food culture \u2014 it\'s never just about the food.</p>' +
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
