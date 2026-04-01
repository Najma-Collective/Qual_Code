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
      // Save session-wide coding filter
      var filterSelect = document.getElementById('session-filter-select');
      if (filterSelect && filterSelect.value) {
        self.state.selectedFilter = filterSelect.value;
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

    // 8. Start AI heartbeat for agentic check-ins during pre-coding/coding
    AI.startHeartbeat();
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
      this.state.threadTitle = 'How do you feel about the theories regarding US influence in the Caribbean?';
      this.state.subreddit = 'r/AskTheCaribbean';
      this.state.researchQuestion = 'How do Caribbean Reddit users perceive and resist narratives of US influence in the region?';
      this.state.aiGuidance = 'Focus assessment on whether the student identifies: (1) the distinction between \'influence\' and \'control/colonialism\' in Caribbean perspectives; (2) how Puerto Rico functions as a reference point for challenging statehood narratives; (3) the role of sovereignty and self-determination as core Caribbean values; (4) how historical knowledge (Monroe Doctrine, colonial history) shapes contemporary attitudes; (5) the intersection of race, immigration policy, and geopolitical power in Caribbean discourse.';
      Storage.save(this.state);
    }

    threadContent.innerHTML =
      '<div class="reddit-thread">' +
        '<div class="reddit-header">' +
          '<span class="reddit-sub">r/AskTheCaribbean</span>' +
          '<span class="reddit-flair">Politics</span>' +
          '<h2 class="reddit-title">How do you feel about the theories regarding US influence in the Caribbean?</h2>' +
          '<span class="reddit-meta">Posted by u/Shonen_Fan &middot; 8 days ago</span>' +
        '</div>' +
        '<div class="reddit-post">' +
          '<p>A common joke/theory is that Puerto Rico, Cuba, Trinidad and Tobago, and Guyana will become US states in the near future. How do you feel about such claims?</p>' +
        '</div>' +
        '<div class="reddit-comments">' +
          '<div class="reddit-comment">' +
            '<span class="reddit-author">u/BrentDavidTT</span>' +
            '<span class="reddit-badge">Top 1% Commenter</span>' +
            '<p>I really think most of you all are young and think relationships of political, economic and military conveniences between the US and the region are new!</p>' +
          '</div>' +
          '<div class="reddit-comment reply">' +
            '<span class="reddit-author">u/Weekly-Cicada-8615</span>' +
            '<p>T&amp;T just sick of the Venezuelan government bs lol</p>' +
          '</div>' +
          '<div class="reddit-comment">' +
            '<span class="reddit-author">u/aguilasolige</span>' +
            '<span class="reddit-badge">Top 1% Commenter</span>' +
            '<p>All throughout history, superpowers always influence their neighbors, that\'s inevitable. The only thing smaller countries can do is try to benefit from it</p>' +
          '</div>' +
          '<div class="reddit-comment">' +
            '<span class="reddit-author">u/NeoPrimitiveOasis</span>' +
            '<p>More like colonies, not states.</p>' +
          '</div>' +
          '<div class="reddit-comment">' +
            '<span class="reddit-author">u/sunlit_elais</span>' +
            '<p>Idiotic. The US is heavily anti-immigrant right now, and they are going to give a few million people at once the option to immigrate there with full vote rights? When Puerto Rico is right there and they still haven\'t allowed them the condition of state?</p>' +
            '<p>Try colony or puppet state.</p>' +
          '</div>' +
          '<div class="reddit-comment">' +
            '<span class="reddit-author">u/happy_bluebird</span>' +
            '<p>I don\'t think you know what &quot;joke&quot; or &quot;theory&quot; mean</p>' +
          '</div>' +
          '<div class="reddit-comment">' +
            '<span class="reddit-author">u/Awkward-Hulk</span>' +
            '<p>History really fucked Cuba. Spain was stupidly repressive there, fueling the eventual wars of independence. Cuba could have easily been an autonomous community of Spain today - much like the Canary Islands*. But alas, that never happened.</p>' +
            '<p>And then we got stuck with a dictator in the 1950s only to replace that dictator with another in 1959. That latest dictator then earned himself an embargo from the world\'s superpower. And the country has essentially regressed back to the 1800s now...</p>' +
            '<p>*It\'s likely that the US would have invaded anyway, but a Spain with the support of the Cuban people wouldn\'t have been as easy of a target.</p>' +
          '</div>' +
          '<div class="reddit-comment">' +
            '<span class="reddit-author">u/frazbox</span>' +
            '<p>Jokes on you; Puerto Rico is already America</p>' +
          '</div>' +
          '<div class="reddit-comment reply">' +
            '<span class="reddit-author">u/QuirkyRefuse5645</span>' +
            '<p>Not a state though, which is what OP said.</p>' +
          '</div>' +
          '<div class="reddit-comment reply">' +
            '<span class="reddit-author">u/elRobRex</span>' +
            '<p>The Supreme Court of the United States disagrees with you.</p>' +
          '</div>' +
          '<div class="reddit-comment reply">' +
            '<span class="reddit-author">u/QuirkyRefuse5645</span>' +
            '<p>The Supreme Court of the United States said Puerto Rico is a state? I hope you\'re just trolling because that is obviously nowhere close to being true.</p>' +
          '</div>' +
          '<div class="reddit-comment">' +
            '<span class="reddit-author">u/CarelessPangolin993</span>' +
            '<p>It\'s certainly not a theory (assuming your usage of the term is in the non scientific sense). It\'s just a matter of fact. From the Monroe doctrine to the revival under trump (not that it ever went away) it\'s been this way for centuries. The recent expulsion of Cuban doctors across many Caribbean countries is due to U.S pressure and threats. They have halted countries upgrading their infrastructure because it involves Chinese equipment. They had Cuba under embargo and has assets in Haiti. So to suggest the U.S has influence would be underselling the state of affairs</p>' +
          '</div>' +
          '<div class="reddit-comment">' +
            '<span class="reddit-author">u/Tall_Pressure7042</span>' +
            '<p>It is like LATAM. America needs happy clients, not rebels.</p>' +
          '</div>' +
          '<div class="reddit-comment">' +
            '<span class="reddit-author">u/TumbleweedSuper9930</span>' +
            '<p>Looking at Education, infrastructure and crime under British rule and today, many people questioning home rule for TnT</p>' +
          '</div>' +
          '<div class="reddit-comment">' +
            '<span class="reddit-author">u/Weekly-Cicada-8615</span>' +
            '<p>I see Guyana as more like a eu territory than to ever to become a US backed state since it the European who buy most of the oil.</p>' +
          '</div>' +
          '<div class="reddit-comment reply">' +
            '<span class="reddit-author">u/TeachingSpiritual888</span>' +
            '<p>Not eu territory.</p>' +
            '<p>Guyana is like a neutral place, we sell to whoever. It just so happens that America and EU buy most of our oil.</p>' +
          '</div>' +
          '<div class="reddit-comment">' +
            '<span class="reddit-author">u/Islandrocketman</span>' +
            '<p>Who wants to give up their sovereignty? None of nations.</p>' +
          '</div>' +
          '<div class="reddit-comment">' +
            '<span class="reddit-author">u/Genki-sama2</span>' +
            '<p>I have seen an article giving the pros and cons of hands being a US satellite state, actually giving credence to it. I\'d say they\'re correct. Trinidad already halfway there</p>' +
          '</div>' +
          '<div class="reddit-comment reply">' +
            '<span class="reddit-author">u/StrategyFlashy4526</span>' +
            '<p>No credence to that notion. The trump administration has put great emphasis on removing brown and black people from the US. They will never give free entry to non- Europeans.</p>' +
          '</div>' +
          '<div class="reddit-comment">' +
            '<span class="reddit-author">u/Cool_Bananaquit9</span>' +
            '<p>I hope we don\'t become a state</p>' +
          '</div>' +
          '<div class="reddit-comment">' +
            '<span class="reddit-author">u/Own-Enthusiasm-2348</span>' +
            '<p>As a Puerto Rican, all I want for the island is free economic trade with other countries so we can thrive. Instead...we have to depend on the USA for everything...I don\'t hate the USA, but historically you simply cannot deny the damage the USA has done to Puerto Rico.</p>' +
          '</div>' +
          '<div class="reddit-comment">' +
            '<span class="reddit-author">u/Icy_Scar_1249</span>' +
            '<p>I could see Cuba maybe happenning, but not the rest ever. PR is already a territory, and look how hard it\'s been to get them to Statehood, will never happen with TNT and Guyana unless they want to be colonies</p>' +
          '</div>' +
          '<div class="reddit-comment">' +
            '<span class="reddit-author">u/catejeda</span>' +
            '<p>False.</p>' +
          '</div>' +
          '<div class="reddit-comment">' +
            '<span class="reddit-author">u/Em1-_-</span>' +
            '<span class="reddit-badge">Top 1% Commenter</span>' +
            '<p>Puerto Rico and Cuba belong to the Antillean Confederation, don\'t care about the other two, but PR gotta become independent first so Hostos can be returned to his motherland (As were his wishes) and the Antillean Confederation can begin.</p>' +
          '</div>' +
          '<div class="reddit-comment">' +
            '<span class="reddit-author">u/catsoncrack420</span>' +
            '<p>Ridiculous. US has less to gain and more to lose. Now territories with autocracy, that I can see. Like Puerto Rico but we won\'t be granted citizenship. Just better access to work visas</p>' +
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
