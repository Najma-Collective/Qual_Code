/**
 * ai.js — Gemini API integration
 */

var AI = {
  selectedModel: 'gemini-2.0-flash',
  availableModels: [],
  retryDelay: 1000,
  maxRetryDelay: 30000,
  heartbeatIntervalId: null,
  heartbeatIntervalMs: 60000, // 1 minute
  _heartbeatPaused: false,
  _heartbeatInFlight: false,
  _consecutiveHeartbeatFailures: 0,

  /**
   * Get the Gemini API key (localStorage first, then CONFIG fallback)
   */
  getApiKey: function() {
    var saved = localStorage.getItem('qualcode_gemini_key');
    if (saved) return saved;
    if (typeof CONFIG !== 'undefined' && CONFIG.GEMINI_API_KEY) return CONFIG.GEMINI_API_KEY;
    return '';
  },

  /**
   * Get the Drive API key (localStorage first, then CONFIG fallback)
   */
  getDriveApiKey: function() {
    var saved = localStorage.getItem('qualcode_drive_key');
    if (saved) return saved;
    if (typeof CONFIG !== 'undefined' && CONFIG.DRIVE_API_KEY) return CONFIG.DRIVE_API_KEY;
    return '';
  },

  /**
   * Save API keys to localStorage
   */
  saveApiKeys: function(geminiKey, driveKey) {
    if (geminiKey) localStorage.setItem('qualcode_gemini_key', geminiKey);
    if (driveKey) localStorage.setItem('qualcode_drive_key', driveKey);
  },

  /**
   * Check if API key is set
   */
  hasApiKey: function() {
    return this.getApiKey().length > 0;
  },

  /**
   * List available models and auto-select the best one
   */
  listAndSelectModel: function() {
    if (!this.hasApiKey()) return;
    var self = this;

    fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + this.getApiKey())
      .then(function(response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function(data) {
        self.availableModels = (data.models || []).map(function(m) {
          return m.name.replace('models/', '');
        });

        // Try preferred models in order
        var preferred = ['gemini-3.1-pro-preview', 'gemini-2.5-pro-preview-05-06', 'gemini-2.0-flash', 'gemini-1.5-pro'];
        var found = null;
        for (var i = 0; i < preferred.length; i++) {
          if (self.availableModels.indexOf(preferred[i]) !== -1) {
            found = preferred[i];
            break;
          }
        }

        if (found) {
          self.selectedModel = found;
          self.updateModelDisplay(found);
        } else if (self.availableModels.length > 0) {
          self.selectedModel = self.availableModels[0];
          self.updateModelDisplay(self.availableModels[0]);
        }
        self.populateModelDropdown();
      })
      .catch(function(err) {
        console.error('Failed to list models:', err);
      });
  },

  /**
   * Update the model display in the settings panel
   */
  updateModelDisplay: function(modelName) {
    var el = document.getElementById('current-model');
    if (el) el.textContent = modelName;
  },

  /**
   * Populate model dropdown
   */
  populateModelDropdown: function() {
    var select = document.getElementById('model-select');
    if (!select) return;
    var self = this;

    select.innerHTML = '';
    this.availableModels.forEach(function(name) {
      var opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      if (name === self.selectedModel) opt.selected = true;
      select.appendChild(opt);
    });

    if (this.availableModels.length > 0) {
      select.style.display = 'block';
    }
    select.onchange = function() {
      self.selectedModel = select.value;
      if (App.state) {
        App.state.selectedModel = self.selectedModel;
        Storage.save(App.state);
      }
    };
  },

  /**
   * Build the system prompt with interpolated variables
   */
  buildSystemPrompt: function() {
    var state = App.state;
    var elapsedMinutes = Timer.getElapsedMinutes();

    var formattedCodes = 'No codes created yet.';
    if (state.codes.length > 0) {
      formattedCodes = state.codes.map(function(c, i) {
        return (i + 1) + '. Code: "' + c.label + '" | Filter: ' + c.filter + '\n   Text: "' + c.highlightedText + '"\n   Memo: "' + c.memo + '"';
      }).join('\n\n');
    }

    var selectedFilter = state.selectedFilter || 'not yet chosen';

    return 'You are a supportive AI tutor assisting a student with a qualitative coding exercise. Your role is to facilitate and scaffold — never to produce content or perform analysis on the student\'s behalf. You are a catalyst and a gentle guide.\n\n' +
    '## Context\n' +
    '- The student is on an Introduction to Qualitative Research Methods course.\n' +
    '- They are analysing a personal reflection or field notes document that they uploaded.\n' +
    '- They are practising first-cycle qualitative coding using methods from Johnny Saldaña\'s "The Coding Manual for Qualitative Researchers."\n' +
    '- This is a formative (self-check) exercise. There are no grades.\n' +
    '- The session lasts 20 minutes. Current elapsed time: ' + elapsedMinutes + ' minutes.\n' +
    '- Current phase: ' + state.phase + '.\n' +
    '- The student has chosen ONE coding filter for the entire session: ' + selectedFilter + '.\n\n' +
    '## Research Question\n' + (state.researchQuestion || 'Not yet specified.') + '\n\n' +
    '## Document Being Analysed\nTitle: "' + (state.documentTitle || 'Not yet loaded.') + '"\n\n' +
    '## Student\'s Current Work\n' + formattedCodes + '\n\n' +
    '## Your Behaviour\n\n' +
    '### During Setup (minutes 0–1)\n' +
    '- Greet the student warmly. Use accessible, clear language (B1 level English).\n' +
    '- Briefly explain the task: they will read their document and begin coding using their chosen filter.\n' +
    '- If the student has already chosen a filter (' + selectedFilter + '), acknowledge their choice and briefly explain how it works. If not, ask which coding filter they plan to use and why.\n\n' +
    '### During Pre-coding (minutes 1–5)\n' +
    '- If the student shares preliminary observations, acknowledge them briefly.\n' +
    '- If the student has not yet chosen a coding filter, gently remind them to select one before they start coding.\n' +
    '- At minute 5, gently prompt: "You might want to start assigning your first codes now."\n\n' +
    '### During Coding (minutes 5–15)\n' +
    '- **Be mostly silent.** Do not intervene unless the student explicitly asks a question.\n' +
    '- If the student has created 0 codes after 7+ minutes, you may gently encourage them once.\n\n' +
    '### During Follow-up (minutes 15–18)\n' +
    '- Ask exactly 4 questions, one at a time, referencing the student\'s specific codes and memos.\n' +
    '- Question types: CLARIFY, EXPAND, NUANCE, EMERGENT.\n\n' +
    '### During Debrief (minutes 18–20)\n' +
    '- Ask: "What is one key takeaway from this session for you?"\n' +
    '- Give a warm closing. Do not evaluate or grade.\n\n' +
    '## Trauma-Informed Practice (SAMHSA 2014)\n' +
    '1. Safety 2. Trustworthiness 3. Peer Support 4. Collaboration 5. Empowerment 6. Cultural Awareness\n\n' +
    '## Language and Tone\n' +
    '- B1 CEFR level. Warm, encouraging, concise. 2–4 sentences max.\n' +
    '- The student may write in Creole, French, or English. Mirror their language.\n' +
    '- Never correct spelling, grammar, or language use.';
  },

  /**
   * Send a message to Gemini and get a response
   */
  sendMessage: function(userText) {
    var self = this;

    if (!this.hasApiKey()) {
      return Promise.reject(new Error('No API key configured'));
    }

    App.state.conversationHistory.push({
      role: 'user',
      parts: [{ text: userText }],
      timestamp: new Date().toISOString()
    });
    Storage.save(App.state);

    return this.callGemini(App.state.conversationHistory).then(function(responseText) {
      App.state.conversationHistory.push({
        role: 'model',
        parts: [{ text: responseText }],
        timestamp: new Date().toISOString()
      });
      Storage.save(App.state);
      return responseText;
    }).catch(function(err) {
      console.error('Gemini API error:', err);
      var status = err && err.httpStatus;
      if (status === 429) {
        App.showSnackbar('API quota exceeded — please wait or switch models.');
      } else if (status === 400 || status === 401 || status === 403) {
        App.showSnackbar('API key error — please check your key in settings.');
      } else {
        App.showSnackbar('Connection issue — your work is saved locally.');
      }
      App.state.conversationHistory.pop();
      Storage.save(App.state);
      throw err;
    });
  },

  /**
   * Call the Gemini API with retry logic
   */
  callGemini: function(conversationHistory, retries) {
    if (retries === undefined) retries = 0;
    var maxRetries = 3;
    var self = this;

    var endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/' + this.selectedModel + ':generateContent?key=' + this.getApiKey();

    var cleanedHistory = conversationHistory.map(function(msg) {
      return { role: msg.role, parts: msg.parts };
    });

    var payload = {
      contents: cleanedHistory,
      systemInstruction: {
        parts: [{ text: this.buildSystemPrompt() }]
      },
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1024
      }
    };

    return fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function(response) {
      if (!response.ok) {
        var status = response.status;
        return response.text().then(function(errBody) {
          var err = new Error('HTTP ' + status + ': ' + errBody);
          err.httpStatus = status;
          throw err;
        });
      }
      return response.json();
    }).then(function(data) {
      if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
        throw new Error('Invalid response structure from Gemini');
      }
      return data.candidates[0].content.parts[0].text;
    }).catch(function(err) {
      // Don't retry on errors that won't resolve with retries
      var status = err.httpStatus;
      if (status === 429 || status === 400 || status === 401 || status === 403) {
        console.warn('Non-retryable error (HTTP ' + status + '), not retrying.');
        throw err;
      }
      if (retries < maxRetries) {
        var delay = Math.min(self.retryDelay * Math.pow(2, retries), self.maxRetryDelay);
        console.log('Retrying in ' + delay + 'ms (attempt ' + (retries + 1) + '/' + maxRetries + ')...');
        return new Promise(function(resolve) {
          setTimeout(resolve, delay);
        }).then(function() {
          return self.callGemini(conversationHistory, retries + 1);
        });
      }
      throw err;
    });
  },

  /**
   * Trigger the AI follow-up questions phase
   */
  startFollowUp: function() {
    var state = App.state;
    if (state.codes.length === 0) {
      App.addChatMessage('model', 'It looks like you haven\'t created any codes yet. That\'s okay! Let\'s talk about what you noticed while reading your document. What stood out to you?');
      return;
    }

    var contextMsg = '[SYSTEM: The coding phase is now complete. The student has created ' + state.codes.length + ' code(s). Please begin the follow-up phase by asking your first question. Remember to reference specific codes and memos the student has produced.]';
    App.addChatMessage('system', 'The coding phase is complete. The AI tutor will now ask you some follow-up questions.');

    this.sendMessage(contextMsg).then(function(response) {
      App.addChatMessage('model', response);
    }).catch(function() {
      App.addChatMessage('system', 'Could not connect to the AI. You can still export your work.');
    });
  },

  /**
   * Trigger the debrief phase
   */
  startDebrief: function() {
    App.state.phase = 'debrief';
    Storage.save(App.state);

    var contextMsg = '[SYSTEM: The follow-up questions are complete. Please begin the debrief phase by asking the student for their key takeaway.]';

    this.sendMessage(contextMsg).then(function(response) {
      App.addChatMessage('model', response);
    }).catch(function() {
      App.addChatMessage('model', 'Before we finish, what is one key takeaway from this session for you?');
    });
  },

  /**
   * Start the periodic heartbeat check-in during pre-coding and coding phases.
   * Sends a context-only API call once per minute so the AI can proactively
   * intervene if it notices something that needs addressing.
   */
  startHeartbeat: function() {
    this.stopHeartbeat();
    this._heartbeatPaused = false;
    this._consecutiveHeartbeatFailures = 0;
    var self = this;

    // Fire first heartbeat after 30 seconds (not waiting a full minute)
    this._heartbeatFirstTimeout = setTimeout(function() {
      self._doHeartbeat();
    }, 30000);

    this.heartbeatIntervalId = setInterval(function() {
      self._doHeartbeat();
    }, this.heartbeatIntervalMs);
  },

  /**
   * Execute a single heartbeat check-in
   */
  _doHeartbeat: function() {
    if (!this.hasApiKey()) return;
    if (this._heartbeatPaused) return;
    if (this._heartbeatInFlight) return;

    var phase = App.state.phase;
    // Only pulse during pre-coding and coding phases
    if (phase !== 'precoding' && phase !== 'coding') {
      this.stopHeartbeat();
      return;
    }

    var elapsed = Timer.getElapsedMinutes();
    var codeCount = App.state.codes.length;
    var filterChosen = App.state.selectedFilter || '';

    // Build code summary so the AI can see actual student work
    var codeSummary = '';
    if (codeCount > 0) {
      codeSummary = ' Current codes: ';
      codeSummary += App.state.codes.map(function(c, i) {
        return (i + 1) + '. "' + c.label + '" (' + c.filter + ') on text: "' + (c.highlightedText.length > 80 ? c.highlightedText.substring(0, 80) + '...' : c.highlightedText) + '" — memo: "' + (c.memo || 'none') + '"';
      }).join('; ');
      codeSummary += '.';
    }

    var heartbeatMsg;
    if (phase === 'precoding') {
      heartbeatMsg = '[SYSTEM HEARTBEAT — do NOT repeat this tag to the student. ' +
        'Elapsed: ' + elapsed + ' min. Phase: pre-coding. ' +
        'Codes created: ' + codeCount + '. Selected filter: ' + (filterChosen || 'not yet chosen') + '.' + codeSummary + ' ' +
        'If the student has not yet chosen a coding filter, gently ask which one they plan to use and why. ' +
        'If they have chosen a filter but have not begun reading, encourage them to start reading the document. ' +
        'If they seem to be reading already, stay silent and respond with exactly: "[SILENT]". ' +
        'Keep any response to 1-2 sentences max.]';
    } else {
      heartbeatMsg = '[SYSTEM HEARTBEAT — do NOT repeat this tag to the student. ' +
        'Elapsed: ' + elapsed + ' min. Phase: coding. ' +
        'Codes created: ' + codeCount + '. Selected filter: ' + (filterChosen || 'not yet chosen') + '.' + codeSummary + ' ' +
        'Review the student\'s codes above. ' +
        'If the student has 0 codes and more than 7 minutes have elapsed, gently encourage them to start coding. ' +
        'If the student has created codes, assess their quality: are the code labels meaningful or gibberish? Are the memos thoughtful? Is the chosen filter being applied correctly? ' +
        'If you notice a problem (e.g. unclear labels, empty memos, codes that don\'t match the filter, or gibberish entries), give a brief, supportive nudge. ' +
        'If everything looks good and the student is working well, respond with exactly: "[SILENT]". ' +
        'Keep any response to 1-2 sentences max.]';
    }

    var self = this;
    this._heartbeatInFlight = true;
    this.sendMessage(heartbeatMsg).then(function(response) {
      self._heartbeatInFlight = false;
      self._consecutiveHeartbeatFailures = 0;
      // Only show the response if the AI chose to speak (not silent)
      if (response && response.indexOf('[SILENT]') === -1 && response.trim().length > 0) {
        App.addChatMessage('model', response);
      }
    }).catch(function(err) {
      self._heartbeatInFlight = false;
      self._consecutiveHeartbeatFailures++;
      var status = err && err.httpStatus;
      // Stop heartbeat entirely on quota or auth errors
      if (status === 429 || status === 400 || status === 401 || status === 403) {
        console.warn('Heartbeat paused due to API error (HTTP ' + status + ').');
        self._heartbeatPaused = true;
        return;
      }
      // After 3 consecutive failures, pause heartbeat to avoid spam
      if (self._consecutiveHeartbeatFailures >= 3) {
        console.warn('Heartbeat paused after 3 consecutive failures.');
        self._heartbeatPaused = true;
      }
    });
  },

  /**
   * Stop the heartbeat check-in
   */
  stopHeartbeat: function() {
    if (this._heartbeatFirstTimeout) {
      clearTimeout(this._heartbeatFirstTimeout);
      this._heartbeatFirstTimeout = null;
    }
    if (this.heartbeatIntervalId) {
      clearInterval(this.heartbeatIntervalId);
      this.heartbeatIntervalId = null;
    }
  }
};
