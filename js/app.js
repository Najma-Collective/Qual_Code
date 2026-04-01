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

      var docUrlInput = document.getElementById('doc-url-input');
      var docUrl = docUrlInput ? docUrlInput.value.trim() : '';
      if (!docUrl) {
        self.showSnackbar('Please paste a Google Doc URL.');
        return;
      }

      var docId = self.parseGoogleDocId(docUrl);
      if (!docId) {
        self.showSnackbar('Could not recognise that URL. Please paste a Google Docs sharing link.');
        return;
      }

      // Save API keys if provided
      var geminiKey = document.getElementById('gemini-key-input');
      var driveKey = document.getElementById('drive-key-input');
      AI.saveApiKeys(
        geminiKey ? geminiKey.value.trim() : '',
        driveKey ? driveKey.value.trim() : ''
      );

      self.state.studentId = studentId;
      self.state.documentUrl = docUrl;
      self.state.documentId = docId;
      Storage.save(self.state);
      self.startSession(false);
    };
  },

  /**
   * Parse a Google Doc ID from various URL formats
   */
  parseGoogleDocId(url) {
    // Match: https://docs.google.com/document/d/{ID}/...
    var match = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
    if (match) return match[1];

    // Match: https://drive.google.com/file/d/{ID}/...
    match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (match) return match[1];

    // Match: https://drive.google.com/open?id={ID}
    match = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (match) return match[1];

    return null;
  },

  /**
   * Start or resume the main session.
   */
  startSession(isResume) {
    // 1. Show main app immediately
    document.getElementById('setup-screen').classList.remove('active');
    document.getElementById('main-app').classList.add('active');

    // 2. Show placeholder content immediately
    this.loadFallbackDocument();

    // 3. Set up all UI handlers
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
      if (!this.state.selectedFilter) {
        var filterBar = document.getElementById('filter-selection-bar');
        if (filterBar) filterBar.style.display = 'flex';
      }
    }

    // 6. Background: try to load the Google Doc content
    this.tryLoadDocument();

    // 7. Background: initialise AI model selection and greet student
    AI.listAndSelectModel();
    if (!isResume) {
      this.greetStudent();
    }

    // 8. Start AI heartbeat
    AI.startHeartbeat();
  },

  /**
   * Try to fetch the Google Doc content as HTML via Google Drive API.
   */
  tryLoadDocument() {
    var self = this;
    var docId = this.state.documentId;
    if (!docId) return;

    var driveKey = AI.getDriveApiKey();
    if (!driveKey) {
      console.log('No API key available for Google Drive export. Check config.js.');
      return;
    }

    var endpoint = 'https://www.googleapis.com/drive/v3/files/' + docId + '/export?mimeType=text/html&key=' + driveKey;

    fetch(endpoint)
      .then(function(response) {
        if (!response.ok) {
          return response.text().then(function(errBody) {
            throw new Error('Drive API error (HTTP ' + response.status + '): ' + errBody);
          });
        }
        return response.text();
      })
      .then(function(html) {
        var threadContent = document.getElementById('thread-content');
        if (!threadContent) return;

        // Extract just the body content from the full HTML document
        var parser = new DOMParser();
        var doc = parser.parseFromString(html, 'text/html');

        // Copy over any inline styles from the Google Doc <head>
        var styles = doc.querySelectorAll('style');
        var styleText = '';
        styles.forEach(function(s) { styleText += s.textContent; });

        // Build the rendered content
        var bodyHtml = doc.body ? doc.body.innerHTML : html;

        // Wrap with a scoped style block
        threadContent.innerHTML = '<style>' + styleText + '</style>' +
          '<div class="gdoc-content">' + bodyHtml + '</div>';

        // Try to extract a title from the document
        var firstHeading = doc.querySelector('h1, h2, h3, p');
        if (firstHeading && !self.state.documentTitle) {
          var titleText = firstHeading.textContent.trim();
          if (titleText.length > 0 && titleText.length < 200) {
            self.state.documentTitle = titleText;
            Storage.save(self.state);
          }
        }
      })
      .catch(function(err) {
        console.error('Failed to load Google Doc:', err.message);
        var threadContent = document.getElementById('thread-content');
        if (threadContent) {
          threadContent.innerHTML =
            '<div style="color: var(--outline); text-align: center; padding: 32px;">' +
              '<p style="font-size: 16px; margin-bottom: 12px;">Could not load the Google Doc.</p>' +
              '<p style="font-size: 13px; margin-bottom: 8px;">Make sure:</p>' +
              '<ul style="text-align: left; max-width: 400px; margin: 0 auto; font-size: 13px; line-height: 1.8;">' +
                '<li>The document is shared as "Anyone with the link can view"</li>' +
                '<li>The Google Drive API is enabled in your Google Cloud project</li>' +
                '<li>Your API key has access to the Drive API</li>' +
              '</ul>' +
              '<p style="font-size: 12px; color: var(--error); margin-top: 16px;">' + App.escapeHtml(err.message) + '</p>' +
            '</div>';
        }
      });
  },

  /**
   * Load fallback placeholder content
   */
  loadFallbackDocument() {
    var threadContent = document.getElementById('thread-content');
    if (!threadContent) return;
    threadContent.innerHTML = '<p style="color: var(--outline); text-align: center; padding: 32px;">Loading document...</p>';
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
    var docInfo = this.state.documentTitle ? ' The document is titled "' + this.state.documentTitle + '".' : '';
    var rqInfo = this.state.researchQuestion ? ' The research question is: "' + this.state.researchQuestion + '".' : '';

    AI.sendMessage(
      '[SYSTEM: The session has just started. The student\'s ID is "' + this.state.studentId + '".' + docInfo + rqInfo + ' The student has uploaded a personal reflection or field notes document for qualitative coding. Please greet the student warmly, briefly explain the task (they will read their document and begin coding using their chosen filter), and then ask them which coding filter they would like to use for this session and why. List the available filters: In Vivo, Descriptive, Process, Initial, Emotion, Values, Evaluation, Versus, Structural, Holistic, Provisional. The student will select their filter from a dropdown that will appear below this chat.]'
    ).then(function(greeting) {
      self.addChatMessage('model', greeting);
      if (!self.state.selectedFilter) {
        var filterBar = document.getElementById('filter-selection-bar');
        if (filterBar) filterBar.style.display = 'flex';
      }
    }).catch(function(err) {
      console.error('AI greeting failed:', err);
      self.addChatMessage('model', 'Welcome! Today you will read your document and practise qualitative coding. First, please choose a coding filter from the dropdown below. Then take a few minutes to read the document and start creating codes by selecting text.');
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
