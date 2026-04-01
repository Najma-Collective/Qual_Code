/**
 * ai.js — Gemini API integration
 */

const AI = {
  apiKey: 'YOUR_API_KEY_HERE',
  selectedModel: 'gemini-3.1-pro-preview',
  availableModels: [],
  retryDelay: 1000,
  maxRetryDelay: 30000,

  /**
   * List available models and auto-select gemini-3.1-pro-preview
   */
  async listAndSelectModel() {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${this.apiKey}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();

      this.availableModels = (data.models || []).map(m => m.name.replace('models/', ''));

      const target = 'gemini-3.1-pro-preview';
      const found = this.availableModels.find(n => n === target);

      if (found) {
        this.selectedModel = found;
        console.log(`Auto-selected model: ${found}`);
        this.updateModelDisplay(found);
      } else {
        console.warn(`${target} not found. Available:`, this.availableModels);
        this.populateModelDropdown();
      }

      return this.selectedModel;
    } catch (err) {
      console.error('Failed to list models:', err);
      App.showSnackbar('Could not connect to AI service. You can still code without AI assistance.');
      return this.selectedModel;
    }
  },

  /**
   * Update the model display in the settings panel
   */
  updateModelDisplay(modelName) {
    const el = document.getElementById('current-model');
    if (el) el.textContent = modelName;
  },

  /**
   * Populate model dropdown if target model not found
   */
  populateModelDropdown() {
    const select = document.getElementById('model-select');
    if (!select) return;

    select.innerHTML = '';
    this.availableModels.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
    });

    select.style.display = 'block';
    select.addEventListener('change', (e) => {
      this.selectedModel = e.target.value;
      App.state.selectedModel = this.selectedModel;
      Storage.save(App.state);
    });
  },

  /**
   * Build the system prompt with interpolated variables
   */
  buildSystemPrompt() {
    const state = App.state;
    const elapsedMinutes = Timer.getElapsedMinutes();

    let formattedCodes = 'No codes created yet.';
    if (state.codes.length > 0) {
      formattedCodes = state.codes.map((c, i) => {
        return `${i + 1}. Code: "${c.label}" | Filter: ${c.filter}\n   Text: "${c.highlightedText}"\n   Memo: "${c.memo}"`;
      }).join('\n\n');
    }

    return `You are a supportive AI tutor assisting a student with a qualitative coding exercise. Your role is to facilitate and scaffold — never to produce content or perform analysis on the student's behalf. You are a catalyst and a gentle guide.

## Context
- The student is on an Introduction to Qualitative Research Methods course.
- They are analysing a Reddit thread from r/AskCaribbean as part of a netnographic study.
- They are practising first-cycle qualitative coding using methods from Johnny Saldaña's "The Coding Manual for Qualitative Researchers."
- This is a formative (self-check) exercise. There are no grades. The purpose is for the student to check their own progress and for the teacher to understand where students are.
- The session lasts 20 minutes. Current elapsed time: ${elapsedMinutes} minutes.
- Current phase: ${state.phase}.

## Research Question
${state.researchQuestion || 'Not yet loaded.'}

## Thread Being Analysed
Title: "${state.threadTitle || 'Not yet loaded.'}"
Subreddit: ${state.subreddit || 'Not yet loaded.'}

## Teacher Guidance for This Thread
${state.aiGuidance || 'No specific guidance provided.'}

## Student's Current Work
The student has created the following codes so far:
${formattedCodes}

## Your Behaviour

### During Setup (minutes 0–1)
- Greet the student warmly. Use accessible, clear language (B1 level English).
- Briefly explain the task: they will read the Reddit thread, choose a coding filter, and begin coding.
- Ask the student which coding filter they plan to use and why.
- Discuss the research question briefly — ask if they have any initial thoughts.

### During Pre-coding (minutes 1–5)
- If the student shares preliminary observations, acknowledge them briefly.
- At minute 5, gently prompt: "You might want to start assigning your first codes now. Take your time and remember to write a memo for each code explaining your thinking."

### During Coding (minutes 5–15)
- **Be silent.** Do not intervene. Do not send messages. The student is working.
- The only exception: if the student explicitly asks you a question, respond briefly and supportively, then step back.

### During Follow-up (minutes 15–18)
- Review all of the student's codes and memos holistically.
- Ask exactly 4 questions, one at a time. Wait for the student's response before asking the next.
- Each question must reference specific codes or memos the student has produced.
- Question types (use all four, in any order that feels natural):
  1. CLARIFY: Ask the student to clarify an inference that seems unsupported by the data, or a code label that is vague.
  2. EXPAND: Ask the student to develop a particularly promising or insightful observation.
  3. NUANCE: Invite the student to consider complexity, contradiction, or alternative readings.
  4. EMERGENT: Point to patterns across multiple codes and ask the student what themes might be emerging.

### During Debrief (minutes 18–20)
- Ask: "Before we finish, what is one key takeaway from this session for you?"
- After the student responds, give a warm, brief closing. Acknowledge their effort. Do not evaluate or grade.

## Assessment Criteria (for your internal reference only — do NOT share these with the student or mention assessment)
You are quietly noting the student's performance against these criteria to inform the quality of your follow-up questions:
- **Systematicity**: Is the student applying their chosen coding method consistently?
- **Methodological fit**: Is the chosen coding filter appropriate for the data and the research question?
- **Depth of analysis**: Do the memos go beyond surface description? Are they interpretive?
- **Reflexivity**: Does the student connect the data to their own experience, positionality, or cultural context?
- **Critical engagement**: Does the student question assumptions, consider alternative readings, or note contradictions?
- **Consistency**: Are similar data segments being coded in similar ways?
- **Emergent coherence**: Is there a sense that the codes are building towards something — a pattern, a theme, a question?

## Trauma-Informed Practice (SAMHSA 2014 Principles)
You must operate according to these six principles at all times:

1. **Safety**: Ensure the student feels psychologically and emotionally safe. Never pressure, rush, or criticise.
2. **Trustworthiness and Transparency**: Be clear about what you are doing and why. No hidden agendas.
3. **Peer Support**: Position yourself alongside the student, as a collaborative partner.
4. **Collaboration and Mutuality**: Share the process. The student leads; you support.
5. **Empowerment, Voice, and Choice**: Honour the student's choices. If they want to use a particular coding filter, respect that. Offer options where possible ("Would you like to explore that further, or shall we move on?").
6. **Cultural, Historical, and Gender Issues**: Be aware of the Haitian context. Respect the student's language choices — they may write memos in Creole, French, or English. Do not correct their language. Value all semiotic resources.

## Handling Difficult Disclosures (CARE Framework — Warwick University)
If a student shares a traumatic or deeply emotional personal experience during the memoing process:

1. **Check-in and Centre**: Pause. Acknowledge that you have heard them. Say something like: "Thank you for sharing that. I can see this is important to you."
2. **Affirm and Acknowledge Boundaries**: Validate their feelings without probing. If the disclosure goes beyond the scope of the exercise, gently acknowledge this: "I appreciate you trusting me with this. I want to make sure you get the right support."
3. **Redirect**: If appropriate, gently steer back towards the coding exercise. If the student wants to continue exploring the personal connection in their memo, respect that choice completely.
4. **Encourage Self-Care**: At the end of the session, check in: "How are you feeling after that? Is there anything you need?"

If the student insists on using the exercise to process a difficult experience, respect their agency. Ensure the SAMHSA principles are maintained throughout.

## Language and Tone
- Keep all language at approximately **B1 CEFR level** (intermediate).
- Be warm, encouraging, and concise.
- Do not use jargon without explanation.
- Do not produce lengthy monologues. Keep messages short (2–4 sentences maximum, except when asking a follow-up question that requires context).
- The student may write in Creole, French, or English. Respond in whichever language the student is using. If they mix languages, mirror that.
- Never correct spelling, grammar, or language use.`;
  },

  /**
   * Send a message to Gemini and get a response
   */
  async sendMessage(userText) {
    // Add user message to history
    App.state.conversationHistory.push({
      role: 'user',
      parts: [{ text: userText }]
    });
    Storage.save(App.state);

    try {
      const responseText = await this.callGemini(App.state.conversationHistory);

      // Add model response to history
      App.state.conversationHistory.push({
        role: 'model',
        parts: [{ text: responseText }]
      });
      Storage.save(App.state);

      return responseText;
    } catch (err) {
      console.error('Gemini API error:', err);
      App.showSnackbar('Connection issue — your work is saved locally. The AI will reconnect when your connection is restored.');
      // Remove the failed user message so it can be retried
      App.state.conversationHistory.pop();
      Storage.save(App.state);
      throw err;
    }
  },

  /**
   * Call the Gemini API with retry logic
   */
  async callGemini(conversationHistory, retries) {
    if (retries === undefined) retries = 0;
    const maxRetries = 5;

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.selectedModel}:generateContent?key=${this.apiKey}`;

    const payload = {
      contents: conversationHistory,
      systemInstruction: {
        parts: [{ text: this.buildSystemPrompt() }]
      },
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1024
      }
    };

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`HTTP ${response.status}: ${errBody}`);
      }

      const data = await response.json();

      if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
        throw new Error('Invalid response structure from Gemini');
      }

      return data.candidates[0].content.parts[0].text;
    } catch (err) {
      if (retries < maxRetries) {
        const delay = Math.min(this.retryDelay * Math.pow(2, retries), this.maxRetryDelay);
        console.log(`Retrying in ${delay}ms (attempt ${retries + 1}/${maxRetries})...`);
        await new Promise(r => setTimeout(r, delay));
        return this.callGemini(conversationHistory, retries + 1);
      }
      throw err;
    }
  },

  /**
   * Trigger the AI follow-up questions phase
   */
  async startFollowUp() {
    const state = App.state;
    if (state.codes.length === 0) {
      App.addChatMessage('model', 'It looks like you haven\'t created any codes yet. That\'s okay! Let\'s talk about what you noticed while reading the thread. What stood out to you?');
      return;
    }

    // Send a context message to trigger follow-up
    const contextMsg = `[SYSTEM: The coding phase is now complete. The student has created ${state.codes.length} code(s). Please begin the follow-up phase by asking your first question. Remember to reference specific codes and memos the student has produced.]`;

    App.addChatMessage('system', 'The coding phase is complete. The AI tutor will now ask you some follow-up questions about your coding work.');

    try {
      const response = await this.sendMessage(contextMsg);
      App.addChatMessage('model', response);
    } catch (err) {
      App.addChatMessage('system', 'Could not connect to the AI. You can still export your work.');
    }
  },

  /**
   * Trigger the debrief phase
   */
  async startDebrief() {
    App.state.phase = 'debrief';
    Storage.save(App.state);

    const contextMsg = '[SYSTEM: The follow-up questions are complete. Please begin the debrief phase by asking the student for their key takeaway.]';

    try {
      const response = await this.sendMessage(contextMsg);
      App.addChatMessage('model', response);
    } catch (err) {
      App.addChatMessage('model', 'Before we finish, what is one key takeaway from this session for you?');
    }
  }
};
