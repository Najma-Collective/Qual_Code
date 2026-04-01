/**
 * app.js — Main application logic
 */

const App = {
  state: null,
  snackbarTimeout: null,
  snapshotMap: {
    bwia: 'What are your guys thoughts on BWIA West Indies Airways when it was in service_ _ r_AskTheCaribbean.html',
    'us-influence': 'How do you feel about the theories regarding US influence in the Caribbean_ _ r_AskTheCaribbean.html'
  },

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

    // 2. Assign a random thread if not already set
    if (!this.state.threadId) {
      var threads = ['thread-01', 'thread-02'];
      this.state.threadId = threads[Math.floor(Math.random() * threads.length)];
      Storage.save(this.state);
    }

    // 3. Load fallback thread content immediately (synchronous, always works)
    this.loadFallbackThread();

    // 4. Set up all UI handlers (synchronous — must never be blocked by network)
    Coding.init();
    this.setupChatInput();
    this.setupDrawer();
    this.setupToolbarActions();
    this.setupThreadViewControls();

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
      // Show filter bar if no filter selected yet
      if (!this.state.selectedFilter) {
        var filterBar = document.getElementById('filter-selection-bar');
        if (filterBar) filterBar.style.display = 'flex';
      }
    }

    // 6. Background: try to load the real thread (replaces fallback if successful)
    this.tryLoadThread();

    // 7. Background: initialise AI model selection and greet student
    AI.listAndSelectModel();
    if (!isResume) {
      this.greetStudent();
    }

    // 8. Start AI heartbeat for agentic check-ins during pre-coding/coding
    AI.startHeartbeat();
  },

  setupThreadViewControls() {
    var modeSelect = document.getElementById('thread-view-mode');
    var snapshotSelect = document.getElementById('snapshot-select');
    var savedMode = this.state.threadViewMode || 'snapshot';
    var savedSnapshot = this.state.snapshotSource || (this.state.threadId === 'thread-02' ? 'bwia' : 'us-influence');
    this.state.threadViewMode = savedMode;
    this.state.snapshotSource = savedSnapshot;

    if (modeSelect) {
      modeSelect.value = savedMode;
      modeSelect.onchange = () => {
        this.state.threadViewMode = modeSelect.value;
        Storage.save(this.state);
        this.updateThreadViewMode();
      };
    }

    if (snapshotSelect) {
      snapshotSelect.value = savedSnapshot;
      snapshotSelect.onchange = () => {
        this.state.snapshotSource = snapshotSelect.value;
        Storage.save(this.state);
        this.loadSnapshotFrame();
      };
    }

    this.updateThreadViewMode();
  },

  updateThreadViewMode() {
    var structured = document.getElementById('thread-content');
    var snapshot = document.getElementById('snapshot-browser');
    var mode = this.state.threadViewMode || 'structured';

    if (structured) structured.style.display = mode === 'snapshot' ? 'none' : 'block';
    if (snapshot) snapshot.style.display = mode === 'snapshot' ? 'block' : 'none';

    if (mode === 'snapshot') {
      this.loadSnapshotFrame();
    }
  },

  loadSnapshotFrame() {
    var frame = document.getElementById('snapshot-frame');
    if (!frame) return;
    var source = this.state.snapshotSource || 'bwia';
    var path = this.snapshotMap[source];
    if (!path) return;

    if (frame.getAttribute('src') !== path) {
      frame.setAttribute('src', path);
    }
  },

  /**
   * Try to fetch the real thread from the server.
   * This runs in the background — if it fails, the fallback is already loaded.
   */
  tryLoadThread() {
    var self = this;
    var threadId = this.state.threadId;

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
          var threadBase = 'threads/' + threadId + '/';
          var detached = document.createElement('div');
          detached.innerHTML = html;

          var isAbsoluteUrl = function(url) {
            return /^(?:https?:|data:|blob:|\/|#|\/\/)/i.test(url || '');
          };

          detached.querySelectorAll('img[src], a[href]').forEach(function(el) {
            var attrName = el.tagName === 'A' ? 'href' : 'src';
            var attrValue = el.getAttribute(attrName);
            if (!attrValue || isAbsoluteUrl(attrValue)) return;
            el.setAttribute(attrName, threadBase + attrValue);
          });

          detached.querySelectorAll('source[srcset]').forEach(function(sourceEl) {
            var srcset = sourceEl.getAttribute('srcset');
            if (!srcset) return;

            var normalizedSrcset = srcset
              .split(',')
              .map(function(entry) {
                var candidate = entry.trim();
                if (!candidate) return candidate;

                var firstSpaceIndex = candidate.search(/\s/);
                var candidateUrl = firstSpaceIndex === -1 ? candidate : candidate.slice(0, firstSpaceIndex);
                var candidateDescriptor = firstSpaceIndex === -1 ? '' : candidate.slice(firstSpaceIndex);

                if (isAbsoluteUrl(candidateUrl)) return candidate;
                return threadBase + candidateUrl + candidateDescriptor;
              })
              .join(', ');

            sourceEl.setAttribute('srcset', normalizedSrcset);
          });

          threadContent.innerHTML = detached.innerHTML;
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

    // Set default metadata based on which thread is selected
    if (!this.state.threadTitle) {
      if (this.state.threadId === 'thread-02') {
        this.state.threadTitle = 'What are your guys thoughts on BWIA West Indies Airways when it was in service?';
        this.state.subreddit = 'r/AskTheCaribbean';
        this.state.researchQuestion = 'How do Caribbean nationals construct collective memory and cultural identity through shared experiences of regional institutions, and what role does nostalgia play in evaluating post-independence Caribbean enterprises?';
        this.state.aiGuidance = 'Focus assessment on whether the student identifies: (1) how shared memories of BWIA function as markers of Caribbean cultural identity and regional belonging; (2) the significance of the airline\'s name (BRITISH West Indian Airways) and what the naming reveals about colonial legacies in post-independence institutions; (3) humour and wordplay (acronym jokes like \"But Will It Arrive?\", \"Better Walk If Able\") as a communal semiotic practice that builds in-group solidarity; (4) how sensory memories (food, drinks, livery) encode cultural meaning and national pride; (5) the transition from BWIA to Caribbean Airlines as a site of identity negotiation between colonial heritage and regional self-determination; (6) how profile pictures, flair, and engagement patterns reveal community dynamics in Caribbean digital spaces.';
      } else {
        this.state.threadTitle = 'How do you feel about the theories regarding US influence in the Caribbean?';
        this.state.subreddit = 'r/AskTheCaribbean';
        this.state.researchQuestion = 'How do Caribbean Reddit users perceive and resist narratives of US influence in the region?';
        this.state.aiGuidance = 'Focus assessment on whether the student identifies: (1) the distinction between \'influence\' and \'control/colonialism\' in Caribbean perspectives; (2) how Puerto Rico functions as a reference point for challenging statehood narratives; (3) the role of sovereignty and self-determination as core Caribbean values; (4) how historical knowledge (Monroe Doctrine, colonial history) shapes contemporary attitudes; (5) the intersection of race, immigration policy, and geopolitical power in Caribbean discourse.';
      }
      Storage.save(this.state);
    }

    threadContent.innerHTML = '<p style="color: var(--outline); text-align: center; padding: 32px;">Loading thread...</p>';
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
      '[SYSTEM: The session has just started. The student\'s ID is "' + this.state.studentId + '". The research question is: "' + this.state.researchQuestion + '". The thread being analysed is titled "' + this.state.threadTitle + '" from ' + this.state.subreddit + '. Please greet the student warmly, briefly explain the task, and then ask them which coding filter they would like to use for this session and why. List the available filters: In Vivo, Descriptive, Process, Initial, Emotion, Values, Evaluation, Versus, Structural, Holistic, Provisional. The student will select their filter from a dropdown that will appear below this chat.]'
    ).then(function(greeting) {
      self.addChatMessage('model', greeting);
      // Show the filter selection bar after greeting
      if (!self.state.selectedFilter) {
        var filterBar = document.getElementById('filter-selection-bar');
        if (filterBar) filterBar.style.display = 'flex';
      }
    }).catch(function(err) {
      console.error('AI greeting failed:', err);
      self.addChatMessage('model', 'Welcome! Today you will read a Reddit thread and practise qualitative coding. First, please choose a coding filter from the dropdown below. Then take a few minutes to read the thread and start creating codes by selecting text.');
      if (!self.state.selectedFilter) {
        var filterBar = document.getElementById('filter-selection-bar');
        if (filterBar) filterBar.style.display = 'flex';
      }
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
  addChatMessage(role, text, timestamp) {
    var container = document.getElementById('chat-messages');
    if (!container) return;

    var msg = document.createElement('div');
    msg.className = 'chat-message chat-message--' + role;

    var bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.textContent = text;

    msg.appendChild(bubble);

    // Add timestamp
    var ts = timestamp || new Date().toISOString();
    var timeEl = document.createElement('span');
    timeEl.className = 'chat-timestamp';
    var d = new Date(ts);
    timeEl.textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    timeEl.title = d.toLocaleString();
    msg.appendChild(timeEl);

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
      var text = msg.parts[0].text;
      if (text.indexOf('[SYSTEM') === 0 || text.indexOf('[SILENT]') !== -1) return;
      self.addChatMessage(msg.role === 'model' ? 'model' : 'user', msg.parts[0].text, msg.timestamp);
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
    AI.stopHeartbeat();
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
