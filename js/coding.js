/**
 * coding.js — Highlighting, code creation, memo management
 */

const Coding = {
  // Colour palette for code highlights
  colours: [
    '#FDEAA8', // warm yellow
    '#A8D8B9', // soft green
    '#F8B4C8', // soft pink
    '#A8C8F0', // soft blue
    '#D4B8E8', // soft purple
    '#F8D0A0', // soft orange
    '#B8E0D0', // soft teal
    '#E8C0C0', // soft rose
  ],
  colourIndex: 0,
  codeColourMap: {},

  /**
   * Coding filter definitions from Saldana
   */
  filters: [
    { value: 'in-vivo', label: 'In Vivo', description: "Uses the participant's own words or short phrases as the code. Preserves the original voice." },
    { value: 'descriptive', label: 'Descriptive', description: 'Summarises the topic of a passage in a word or short phrase (e.g., "Education", "Family dynamics").' },
    { value: 'process', label: 'Process', description: 'Uses gerunds (-ing words) to capture actions or processes (e.g., "Negotiating identity", "Preserving tradition").' },
    { value: 'initial', label: 'Initial', description: 'Open, exploratory coding. Used in grounded theory as a first pass. Stay close to the data.' },
    { value: 'emotion', label: 'Emotion', description: 'Labels the emotions expressed, recalled, or inferred from the data (e.g., "Pride", "Grief", "Ambivalence").' },
    { value: 'values', label: 'Values', description: 'Captures values, attitudes, and beliefs reflected in the data (e.g., "Community solidarity", "Individualism").' },
    { value: 'evaluation', label: 'Evaluation', description: 'Assigns evaluative judgments to the data (e.g., "Positive framing of X", "Critical of Y").' },
    { value: 'versus', label: 'Versus', description: 'Identifies dichotomies, conflicts, or binary oppositions in the data (e.g., "Tradition vs. modernity").' },
    { value: 'structural', label: 'Structural', description: 'Codes data according to its relevance to the research question. Segments data by research topic.' },
    { value: 'holistic', label: 'Holistic', description: 'Applies a single code to a large unit of data (a whole paragraph, story, or response). Captures the gist.' },
    { value: 'provisional', label: 'Provisional', description: 'Starts from a pre-established list of codes derived from the literature, then modifies as needed.' }
  ],

  /**
   * Initialise the coding module
   */
  init() {
    this.setupAnnotationToolbar();
    this.setupCodeModal();
    this.renderCodesList();
  },

  /**
   * Set up the floating annotation toolbar for pre-coding
   */
  setupAnnotationToolbar() {
    const toolbar = document.getElementById('annotation-toolbar');
    if (!toolbar) return;

    document.addEventListener('mouseup', (e) => this.handleTextSelection(e));
    document.addEventListener('touchend', (e) => this.handleTextSelection(e));
  },

  /**
   * Handle text selection in the thread pane
   */
  handleTextSelection(e) {
    const threadPane = document.getElementById('thread-pane');
    if (!threadPane) return;

    // Check if selection is within the thread pane
    const iframe = document.getElementById('thread-iframe');
    let selection;
    let selectionContainer;

    if (iframe && iframe.contentDocument) {
      selection = iframe.contentDocument.getSelection();
      selectionContainer = iframe.contentDocument;
    } else {
      selection = window.getSelection();
      selectionContainer = document;
    }

    const toolbar = document.getElementById('annotation-toolbar');
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      if (toolbar) toolbar.classList.remove('visible');
      return;
    }

    const selectedText = selection.toString().trim();
    if (!selectedText) return;

    // Show the annotation toolbar near the selection
    if (toolbar) {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      // Position toolbar above the selection
      let top = rect.top - 50;
      let left = rect.left + (rect.width / 2) - 100;

      // If using iframe, adjust position
      if (iframe) {
        const iframeRect = iframe.getBoundingClientRect();
        top += iframeRect.top;
        left += iframeRect.left;
      }

      // Keep within viewport
      top = Math.max(10, top);
      left = Math.max(10, Math.min(left, window.innerWidth - 220));

      toolbar.style.top = top + 'px';
      toolbar.style.left = left + 'px';
      toolbar.classList.add('visible');

      // Store the selection data for later use
      toolbar.dataset.selectedText = selectedText;
    }
  },

  /**
   * Apply annotation (bold, underline, or highlight colour)
   */
  applyAnnotation(type, colour) {
    const iframe = document.getElementById('thread-iframe');
    let selection;
    let doc;

    if (iframe && iframe.contentDocument) {
      selection = iframe.contentDocument.getSelection();
      doc = iframe.contentDocument;
    } else {
      selection = window.getSelection();
      doc = document;
    }

    if (!selection || selection.isCollapsed) return;

    const range = selection.getRangeAt(0);
    const span = doc.createElement('span');

    switch (type) {
      case 'bold':
        span.style.fontWeight = 'bold';
        break;
      case 'underline':
        span.style.textDecoration = 'underline';
        break;
      case 'highlight':
        span.style.backgroundColor = colour || '#FDEAA8';
        break;
    }

    try {
      range.surroundContents(span);
    } catch (e) {
      // If surroundContents fails (partial node selection), use extractContents
      const fragment = range.extractContents();
      span.appendChild(fragment);
      range.insertNode(span);
    }

    selection.removeAllRanges();
    document.getElementById('annotation-toolbar').classList.remove('visible');
  },

  /**
   * Open the code creation modal with selected text
   */
  openCodeModal(selectedText, editingCode) {
    const modal = document.getElementById('code-modal');
    if (!modal) return;

    document.getElementById('code-selected-text').textContent = selectedText || '';
    document.getElementById('code-label-input').value = editingCode ? editingCode.label : '';
    document.getElementById('code-memo-input').value = editingCode ? editingCode.memo : '';

    // Set filter dropdown
    const filterSelect = document.getElementById('code-filter-select');
    if (filterSelect) {
      filterSelect.value = editingCode ? editingCode.filter : '';
    }

    // Store context
    modal.dataset.editingId = editingCode ? editingCode.id : '';
    modal.dataset.selectedText = selectedText || (editingCode ? editingCode.highlightedText : '');

    modal.classList.add('open');
    document.getElementById('code-label-input').focus();
  },

  /**
   * Close the code modal
   */
  closeCodeModal() {
    const modal = document.getElementById('code-modal');
    if (modal) modal.classList.remove('open');
  },

  /**
   * Save a code (create or update)
   */
  saveCode() {
    const modal = document.getElementById('code-modal');
    const label = document.getElementById('code-label-input').value.trim();
    const filter = document.getElementById('code-filter-select').value;
    const memo = document.getElementById('code-memo-input').value.trim();
    const selectedText = modal.dataset.selectedText;
    const editingId = modal.dataset.editingId;

    if (!label) {
      App.showSnackbar('Please enter a code label.');
      return;
    }
    if (!filter) {
      App.showSnackbar('Please select a coding filter.');
      return;
    }

    if (editingId) {
      // Update existing code
      const code = App.state.codes.find(c => c.id === editingId);
      if (code) {
        code.label = label;
        code.filter = filter;
        code.memo = memo;
      }
    } else {
      // Create new code
      const code = {
        id: 'code-' + Date.now(),
        label: label,
        filter: filter,
        highlightedText: selectedText,
        memo: memo,
        timestamp: new Date().toISOString()
      };

      // Assign a colour to this code
      this.codeColourMap[code.id] = this.colours[this.colourIndex % this.colours.length];
      this.colourIndex++;

      App.state.codes.push(code);

      // Highlight the text in the thread
      this.highlightTextInThread(selectedText, this.codeColourMap[code.id]);
    }

    Storage.save(App.state);
    this.renderCodesList();
    this.closeCodeModal();
    App.showSnackbar(editingId ? 'Code updated.' : 'Code created.');
  },

  /**
   * Delete a code
   */
  deleteCode(codeId) {
    const index = App.state.codes.findIndex(c => c.id === codeId);
    if (index === -1) return;

    App.state.codes.splice(index, 1);
    delete this.codeColourMap[codeId];
    Storage.save(App.state);
    this.renderCodesList();
    App.showSnackbar('Code deleted.');
  },

  /**
   * Highlight text in the thread pane
   */
  highlightTextInThread(text, colour) {
    const iframe = document.getElementById('thread-iframe');
    const threadContent = document.getElementById('thread-content');

    let doc;
    if (iframe && iframe.contentDocument) {
      doc = iframe.contentDocument;
    } else if (threadContent) {
      doc = document;
    } else {
      return;
    }

    const container = iframe ? doc.body : threadContent;
    if (!container) return;

    // Walk through text nodes and find the matching text
    const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
    let node;

    while ((node = walker.nextNode())) {
      const idx = node.textContent.indexOf(text);
      if (idx !== -1) {
        const range = doc.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + text.length);

        const mark = doc.createElement('mark');
        mark.style.backgroundColor = colour;
        mark.style.borderRadius = '2px';
        mark.style.padding = '1px 0';

        try {
          range.surroundContents(mark);
        } catch (e) {
          // Partial selection across nodes — skip
        }
        break;
      }
    }
  },

  /**
   * Render the codes list panel
   */
  renderCodesList() {
    const list = document.getElementById('codes-list');
    if (!list) return;

    if (App.state.codes.length === 0) {
      list.innerHTML = '<div class="codes-empty"><span class="material-icons">code</span><p>No codes yet. Select text in the thread and click "Create Code" to begin.</p></div>';
      return;
    }

    list.innerHTML = App.state.codes.map(code => {
      const colour = this.codeColourMap[code.id] || '#FDEAA8';
      const excerpt = code.highlightedText.length > 50
        ? code.highlightedText.substring(0, 50) + '...'
        : code.highlightedText;
      const filterObj = this.filters.find(f => f.value === code.filter || f.label === code.filter);
      const filterLabel = filterObj ? filterObj.label : code.filter;

      return `
        <div class="code-card mdc-card" data-code-id="${code.id}">
          <div class="code-card__header" onclick="Coding.toggleCodeExpand('${code.id}')">
            <div class="code-card__colour" style="background-color: ${colour}"></div>
            <div class="code-card__info">
              <span class="code-card__label">${this.escapeHtml(code.label)}</span>
              <span class="code-card__filter">${this.escapeHtml(filterLabel)}</span>
              <span class="code-card__excerpt">"${this.escapeHtml(excerpt)}"</span>
            </div>
            <div class="code-card__actions">
              <button class="mdc-icon-button code-card__btn" onclick="event.stopPropagation(); Coding.openCodeModal('', App.state.codes.find(c => c.id === '${code.id}'))" aria-label="Edit code">
                <span class="material-icons">edit</span>
              </button>
              <button class="mdc-icon-button code-card__btn code-card__btn--delete" onclick="event.stopPropagation(); Coding.confirmDelete('${code.id}')" aria-label="Delete code">
                <span class="material-icons">delete</span>
              </button>
            </div>
          </div>
          <div class="code-card__memo" id="memo-${code.id}">
            <p class="code-card__memo-label">Memo:</p>
            <p class="code-card__memo-text">${this.escapeHtml(code.memo || 'No memo written.')}</p>
            <p class="code-card__full-text-label">Full text:</p>
            <p class="code-card__full-text">"${this.escapeHtml(code.highlightedText)}"</p>
          </div>
        </div>
      `;
    }).join('');
  },

  /**
   * Toggle code card expansion
   */
  toggleCodeExpand(codeId) {
    const memo = document.getElementById('memo-' + codeId);
    if (memo) memo.classList.toggle('expanded');
  },

  /**
   * Confirm code deletion
   */
  confirmDelete(codeId) {
    const dialog = document.getElementById('delete-dialog');
    if (dialog) {
      dialog.dataset.codeId = codeId;
      dialog.classList.add('open');
    }
  },

  /**
   * Escape HTML entities
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  /**
   * Get unique filters used across all codes
   */
  getUsedFilters() {
    const filters = new Set();
    App.state.codes.forEach(c => {
      const filterObj = this.filters.find(f => f.value === c.filter || f.label === c.filter);
      filters.add(filterObj ? filterObj.label : c.filter);
    });
    return Array.from(filters);
  }
};
