/**
 * app.js — Main application logic
 */

const App = {
  state: null,
  snackbarTimeout: null,

  /**
   * Initialise the application
   */
  async init() {
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
      // No dialog element — just start fresh
      this.state = Storage.createEmptyState();
      this.showSetupScreen();
      return;
    }

    document.getElementById('resume-student-id').textContent = savedState.studentId;
    const elapsedMins = Math.floor(savedState.elapsedSeconds / 60);
    document.getElementById('resume-elapsed').textContent = elapsedMins + ' minute(s) elapsed';
    overlay.classList.add('open');

    document.getElementById('btn-resume').onclick = () => {
      overlay.classList.remove('open');
      this.state = savedState;
      // Restore colour map for codes
      this.state.codes.forEach((code, i) => {
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
      const studentId = document.getElementById('student-id-input').value.trim();
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
   * Start or resume the main session
   */
  async startSession(isResume) {
    document.getElementById('setup-screen').classList.remove('active');
    document.getElementById('main-app').classList.add('active');

    // Initialise coding module
    Coding.init();

    // Initialise model selector
    AI.listAndSelectModel();

    // Load a thread
    try {
      if (!isResume) {
        await this.loadRandomThread();
        this.state.sessionStartTime = new Date().toISOString();
        this.state.phase = 'precoding';
        Storage.save(this.state);
      } else {
        // Load the same thread
        if (this.state.threadId) {
          await this.loadThread(this.state.threadId);
        }
        // Re-render codes
        Coding.renderCodesList();
        // Re-render conversation
        this.restoreChat();
      }
    } catch (err) {
      console.error('Thread loading error, using fallback:', err);
      this.loadFallbackThread();
      if (!isResume) {
        this.state.sessionStartTime = new Date().toISOString();
        this.state.phase = 'precoding';
        Storage.save(this.state);
      }
    }

    // Set up timer callbacks
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

    // Start timer
    Timer.start(this.state.elapsedSeconds);

    // Update phase display
    this.updatePhaseDisplay();

    // Set up chat input (do this BEFORE async AI call)
    this.setupChatInput();

    // Set up hamburger menu
    this.setupDrawer();

    // Set up code creation from toolbar
    this.setupToolbarActions();

    // Update research question display
    this.updateResearchQuestionDisplay();

    // Greet with AI (after all UI is set up, so errors here don't block the app)
    if (!isResume) {
      this.greetStudent();
    }
  },

  /**
   * Load a random thread from the threads directory
   */
  async loadRandomThread() {
    try {
      // Try to load the thread manifest or default to thread-01
      const threadIds = ['thread-01']; // Extendable list
      const randomId = threadIds[Math.floor(Math.random() * threadIds.length)];
      await this.loadThread(randomId);
    } catch (err) {
      console.error('Failed to load thread:', err);
      this.loadFallbackThread();
    }
  },

  /**
   * Load a specific thread by ID
   */
  async loadThread(threadId) {
    this.state.threadId = threadId;

    try {
      const metaResponse = await fetch(`threads/${threadId}/metadata.json`);
      if (!metaResponse.ok) throw new Error('Metadata not found');
      const metadata = await metaResponse.json();

      this.state.researchQuestion = metadata.researchQuestion;
      this.state.threadTitle = metadata.threadTitle;
      this.state.subreddit = metadata.subreddit;
      this.state.aiGuidance = metadata.aiGuidance;
      Storage.save(this.state);

      // Load the thread HTML into the thread pane
      const threadContent = document.getElementById('thread-content');
      if (threadContent) {
        try {
          const htmlResponse = await fetch(`threads/${threadId}/index.html`);
          if (htmlResponse.ok) {
            const html = await htmlResponse.text();
            threadContent.innerHTML = html;
          } else {
            this.loadFallbackThread();
          }
        } catch (e) {
          this.loadFallbackThread();
        }
      }
    } catch (err) {
      console.error('Error loading thread:', err);
      this.loadFallbackThread();
    }
  },

  /**
   * Load a fallback thread if actual thread files aren't available
   */
  loadFallbackThread() {
    const threadContent = document.getElementById('thread-content');
    if (!threadContent) return;

    // Set default metadata
    if (!this.state.threadTitle) {
      this.state.threadTitle = "What's your favourite Caribbean dish?";
      this.state.subreddit = 'r/AskCaribbean';
      this.state.researchQuestion = 'How do participants in r/AskCaribbean construct and negotiate Caribbean culinary identity through food discourse?';
      this.state.aiGuidance = 'Focus assessment on whether the student identifies cultural identity markers in food descriptions, recognises in-group/out-group dynamics in recipe attribution, and connects food practices to broader Caribbean cultural narratives.';
      Storage.save(this.state);
    }

    threadContent.innerHTML = `
      <div class="reddit-thread">
        <div class="reddit-header">
          <span class="reddit-sub">${this.state.subreddit}</span>
          <h2 class="reddit-title">${this.state.threadTitle}</h2>
          <span class="reddit-meta">Posted by u/caribbeanfoodie42 &middot; 3 months ago</span>
        </div>
        <div class="reddit-post">
          <p>Hey everyone! I'm curious about what dishes make you feel most connected to your Caribbean identity. What's the one dish that screams "home" for you?</p>
        </div>
        <div class="reddit-comments">
          <div class="reddit-comment">
            <span class="reddit-author">u/trini_pride</span>
            <p>Pelau, no question. My grandmother used to make it every Sunday. The way the rice gets that brown colour from the caramelised sugar... there's nothing like it. I always feel proud when someone mentions our pelau because it's uniquely ours.</p>
          </div>
          <div class="reddit-comment">
            <span class="reddit-author">u/jamaicanroots</span>
            <p>For me it's ackee and saltfish. My mother learned it from her mother, who learned from her grandmother. My grandmother's recipe, passed down from slavery days, uses scotch bonnet in a way that nobody else does. When I cook it abroad, the smell takes me straight back to Kingston.</p>
          </div>
          <div class="reddit-comment">
            <span class="reddit-author">u/haitiankreyol</span>
            <p>Griot with pikliz. Every celebration, every family gathering. You can't be Haitian without griot. When I moved to Montreal, the first thing I did was find a Haitian restaurant. The food is how we stay connected. Li nan san nou — it's in our blood.</p>
          </div>
          <div class="reddit-comment">
            <span class="reddit-author">u/bajan_queen</span>
            <p>Cou-cou and flying fish. But honestly? I think the younger generation is losing these recipes. My niece asked me what cou-cou was last week. That hurt. We need to write these things down before they disappear. The tradition vs modernity struggle is real in Barbados right now.</p>
          </div>
          <div class="reddit-comment">
            <span class="reddit-author">u/guyanese_diaspora</span>
            <p>Pepperpot. It's the taste of Christmas morning. My father says the pot should never be empty — you just keep adding to it. There's something beautiful about a dish that literally carries the flavours of yesterday into today. It's history in a pot.</p>
          </div>
          <div class="reddit-comment">
            <span class="reddit-author">u/cuban_in_miami</span>
            <p>Ropa vieja. The name means "old clothes" but the taste is anything but old. I've been making it differently from my abuela though. She would be horrified that I use a pressure cooker. But I keep her sofrito recipe exactly the same. Some things you don't change. That's the compromise — you adapt the method but keep the soul.</p>
          </div>
          <div class="reddit-comment">
            <span class="reddit-author">u/dominican_york</span>
            <p>Mangú con los tres golpes. Every single morning. People think Dominican food is simple but there's so much technique in getting the mangú right. Too many plantains and it's heavy, too few and it's just mush. My tía says cooking is like life — balance is everything. I miss her kitchen so much sometimes it makes me cry.</p>
          </div>
          <div class="reddit-comment">
            <span class="reddit-author">u/soca_soul</span>
            <p>I notice nobody mentioned how food at Carnival is different. The doubles you eat at 3am after playing mas is NOT the same as doubles from a regular vendor. There's magic in that context. The food tastes better because of where you are and who you're with. That's something outsiders never understand about Caribbean food culture — it's never just about the food.</p>
          </div>
        </div>
      </div>
    `;
  },

  /**
   * Update the research question display
   */
  updateResearchQuestionDisplay() {
    const el = document.getElementById('research-question-text');
    if (el && this.state.researchQuestion) {
      el.textContent = this.state.researchQuestion;
    }
  },

  /**
   * Update phase display in the UI
   */
  updatePhaseDisplay() {
    const el = document.getElementById('phase-display');
    if (!el) return;

    const phaseLabels = {
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
  async greetStudent() {
    try {
      const greeting = await AI.sendMessage(
        `[SYSTEM: The session has just started. The student's ID is "${this.state.studentId}". The research question is: "${this.state.researchQuestion}". The thread being analysed is titled "${this.state.threadTitle}" from ${this.state.subreddit}. Please greet the student warmly and briefly explain the task.]`
      );
      this.addChatMessage('model', greeting);
    } catch (err) {
      this.addChatMessage('model', 'Welcome! Today you will read a Reddit thread and practise qualitative coding. Take a few minutes to read the thread first, then start creating codes by selecting text. I\'m here if you need help.');
    }
  },

  /**
   * Set up chat input handling
   */
  setupChatInput() {
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('btn-send');

    const sendMessage = async () => {
      const text = input.value.trim();
      if (!text) return;

      input.value = '';
      this.addChatMessage('user', text);

      // Track follow-up responses
      if (this.state.phase === 'followup') {
        // Find the last AI message as the question
        const lastAiMsg = [...this.state.conversationHistory].reverse().find(m => m.role === 'model');
        if (lastAiMsg) {
          this.state.aiFollowUpResponses.push({
            question: lastAiMsg.parts[0].text,
            answer: text
          });
          Storage.save(this.state);

          // After 4 follow-up responses, start debrief
          if (this.state.aiFollowUpResponses.length >= 4 && this.state.phase !== 'debrief') {
            setTimeout(() => AI.startDebrief(), 500);
            return;
          }
        }
      }

      // Track debrief response
      if (this.state.phase === 'debrief' && !this.state.keyTakeaway) {
        this.state.keyTakeaway = text;
        Storage.save(this.state);
      }

      // Send to AI
      this.showTypingIndicator();
      try {
        const response = await AI.sendMessage(text);
        this.hideTypingIndicator();
        this.addChatMessage('model', response);
      } catch (err) {
        this.hideTypingIndicator();
        this.addChatMessage('system', 'Could not reach the AI. Your message has been saved.');
      }
    };

    if (sendBtn) {
      sendBtn.onclick = sendMessage;
    }

    if (input) {
      input.addEventListener('keydown', (e) => {
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
    const container = document.getElementById('chat-messages');
    if (!container) return;

    const msg = document.createElement('div');
    msg.className = `chat-message chat-message--${role}`;

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.textContent = text;

    msg.appendChild(bubble);
    container.appendChild(msg);

    // Scroll to bottom
    container.scrollTop = container.scrollHeight;
  },

  /**
   * Show typing indicator
   */
  showTypingIndicator() {
    const container = document.getElementById('chat-messages');
    if (!container) return;

    let indicator = document.getElementById('typing-indicator');
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
    const indicator = document.getElementById('typing-indicator');
    if (indicator) indicator.style.display = 'none';
  },

  /**
   * Restore chat from conversation history
   */
  restoreChat() {
    this.state.conversationHistory.forEach(msg => {
      // Skip system context messages
      if (msg.parts[0].text.startsWith('[SYSTEM:')) return;
      this.addChatMessage(msg.role === 'model' ? 'model' : 'user', msg.parts[0].text);
    });
  },

  /**
   * Set up hamburger menu / drawer
   */
  setupDrawer() {
    const menuBtn = document.getElementById('btn-menu');
    const drawer = document.getElementById('codes-drawer');
    const scrim = document.getElementById('drawer-scrim');

    if (menuBtn && drawer) {
      menuBtn.onclick = () => {
        drawer.classList.toggle('open');
        if (scrim) scrim.classList.toggle('open');
      };
    }

    if (scrim) {
      scrim.onclick = () => {
        drawer.classList.remove('open');
        scrim.classList.remove('open');
      };
    }
  },

  /**
   * Set up toolbar action buttons
   */
  setupToolbarActions() {
    // Create Code button on annotation toolbar
    const createCodeBtn = document.getElementById('btn-create-code');
    if (createCodeBtn) {
      createCodeBtn.onclick = () => {
        const toolbar = document.getElementById('annotation-toolbar');
        const selectedText = toolbar ? toolbar.dataset.selectedText : '';
        if (selectedText) {
          Coding.openCodeModal(selectedText);
          toolbar.classList.remove('visible');
        }
      };
    }

    // Annotation buttons
    document.getElementById('btn-bold')?.addEventListener('click', () => Coding.applyAnnotation('bold'));
    document.getElementById('btn-underline')?.addEventListener('click', () => Coding.applyAnnotation('underline'));
    document.getElementById('btn-highlight-yellow')?.addEventListener('click', () => Coding.applyAnnotation('highlight', '#FDEAA8'));
    document.getElementById('btn-highlight-green')?.addEventListener('click', () => Coding.applyAnnotation('highlight', '#A8D8B9'));
    document.getElementById('btn-highlight-pink')?.addEventListener('click', () => Coding.applyAnnotation('highlight', '#F8B4C8'));
    document.getElementById('btn-highlight-blue')?.addEventListener('click', () => Coding.applyAnnotation('highlight', '#A8C8F0'));

    // Save code button in modal
    const saveCodeBtn = document.getElementById('btn-save-code');
    if (saveCodeBtn) {
      saveCodeBtn.onclick = () => Coding.saveCode();
    }

    // Cancel code button
    const cancelCodeBtn = document.getElementById('btn-cancel-code');
    if (cancelCodeBtn) {
      cancelCodeBtn.onclick = () => Coding.closeCodeModal();
    }

    // Delete confirm buttons
    const confirmDeleteBtn = document.getElementById('btn-confirm-delete');
    if (confirmDeleteBtn) {
      confirmDeleteBtn.onclick = () => {
        const dialog = document.getElementById('delete-dialog');
        const codeId = dialog.dataset.codeId;
        if (codeId) Coding.deleteCode(codeId);
        dialog.classList.remove('open');
      };
    }

    const cancelDeleteBtn = document.getElementById('btn-cancel-delete');
    if (cancelDeleteBtn) {
      cancelDeleteBtn.onclick = () => {
        document.getElementById('delete-dialog').classList.remove('open');
      };
    }

    // Export button
    const exportBtn = document.getElementById('btn-export');
    if (exportBtn) {
      exportBtn.onclick = () => Export.generatePDF();
    }

    // Settings button
    const settingsBtn = document.getElementById('btn-settings');
    const settingsPanel = document.getElementById('settings-panel');
    if (settingsBtn && settingsPanel) {
      settingsBtn.onclick = () => settingsPanel.classList.toggle('open');
    }
  },

  /**
   * End the session
   */
  endSession() {
    Timer.stop();
    this.updatePhaseDisplay();

    // Disable chat input
    const input = document.getElementById('chat-input');
    if (input) {
      input.disabled = true;
      input.placeholder = 'Session complete';
    }

    // Show export button
    const exportBtn = document.getElementById('btn-export');
    if (exportBtn) exportBtn.style.display = 'inline-flex';

    // Add completion message
    this.addChatMessage('system', 'Session complete! You can now export your work as a PDF using the export button.');

    this.showSnackbar('Session complete. You can now export your work.');
  },

  /**
   * Show a snackbar notification
   */
  showSnackbar(message) {
    const snackbar = document.getElementById('snackbar');
    if (!snackbar) return;

    const label = snackbar.querySelector('.mdc-snackbar__label');
    if (label) label.textContent = message;

    snackbar.classList.add('mdc-snackbar--open');

    if (this.snackbarTimeout) clearTimeout(this.snackbarTimeout);
    this.snackbarTimeout = setTimeout(() => {
      snackbar.classList.remove('mdc-snackbar--open');
    }, 4000);
  }
};

// Initialise when DOM is ready
document.addEventListener('DOMContentLoaded', () => App.init());
