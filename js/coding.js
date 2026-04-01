/**
 * coding.js — Highlighting, code creation, memo management
 */

var Coding = {
  // Colour palette for code highlights
  colours: [
    '#FDEAA8', '#A8D8B9', '#F8B4C8', '#A8C8F0',
    '#D4B8E8', '#F8D0A0', '#B8E0D0', '#E8C0C0'
  ],
  colourIndex: 0,
  codeColourMap: {},

  /**
   * Coding filter definitions from Saldana
   */
  filters: [
    { value: 'In Vivo', label: 'In Vivo', description: "Uses the participant's own words or short phrases as the code. Preserves the original voice." },
    { value: 'Descriptive', label: 'Descriptive', description: 'Summarises the topic of a passage in a word or short phrase.' },
    { value: 'Process', label: 'Process', description: 'Uses gerunds (-ing words) to capture actions or processes.' },
    { value: 'Initial', label: 'Initial', description: 'Open, exploratory coding. Used in grounded theory as a first pass.' },
    { value: 'Emotion', label: 'Emotion', description: 'Labels the emotions expressed, recalled, or inferred from the data.' },
    { value: 'Values', label: 'Values', description: 'Captures values, attitudes, and beliefs reflected in the data.' },
    { value: 'Evaluation', label: 'Evaluation', description: 'Assigns evaluative judgments to the data.' },
    { value: 'Versus', label: 'Versus', description: 'Identifies dichotomies, conflicts, or binary oppositions in the data.' },
    { value: 'Structural', label: 'Structural', description: 'Codes data according to its relevance to the research question.' },
    { value: 'Holistic', label: 'Holistic', description: 'Applies a single code to a large unit of data. Captures the gist.' },
    { value: 'Provisional', label: 'Provisional', description: 'Starts from a pre-established list of codes derived from the literature.' }
  ],

  /**
   * Initialise the coding module
   */
  init: function() {
    this.setupAnnotationToolbar();
    this.renderCodesList();
  },

  /**
   * Set up the floating annotation toolbar for text selection
   */
  setupAnnotationToolbar: function() {
    var toolbar = document.getElementById('annotation-toolbar');
    if (!toolbar) return;

    var self = this;

    // Listen on the thread pane specifically
    var threadPane = document.getElementById('thread-pane');
    if (threadPane) {
      threadPane.addEventListener('mouseup', function(e) {
        // Small delay to let the selection finalise
        setTimeout(function() { self.handleTextSelection(e); }, 10);
      });
      threadPane.addEventListener('touchend', function(e) {
        setTimeout(function() { self.handleTextSelection(e); }, 100);
      });
    }

    // Hide toolbar when clicking outside thread pane
    document.addEventListener('mousedown', function(e) {
      if (!toolbar.contains(e.target) && !threadPane.contains(e.target)) {
        toolbar.classList.remove('visible');
      }
    });
  },

  /**
   * Handle text selection in the thread pane
   */
  handleTextSelection: function(e) {
    var toolbar = document.getElementById('annotation-toolbar');
    if (!toolbar) return;

    var selection = window.getSelection();

    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      // Don't hide if the user clicked on the toolbar itself
      if (e && toolbar.contains(e.target)) return;
      toolbar.classList.remove('visible');
      return;
    }

    // Check that the selection is within the thread pane
    var threadPane = document.getElementById('thread-pane');
    if (!threadPane) return;

    var anchorNode = selection.anchorNode;
    if (!threadPane.contains(anchorNode)) {
      toolbar.classList.remove('visible');
      return;
    }

    var selectedText = selection.toString().trim();
    if (!selectedText) return;

    var range = selection.getRangeAt(0);
    var rect = range.getBoundingClientRect();

    // Position toolbar above the selection
    var top = rect.top + window.scrollY - 56;
    var left = rect.left + (rect.width / 2) - 120;

    // Keep within viewport
    top = Math.max(60, top);
    left = Math.max(10, Math.min(left, window.innerWidth - 280));

    toolbar.style.top = top + 'px';
    toolbar.style.left = left + 'px';
    toolbar.classList.add('visible');

    // Store selected text for code creation
    toolbar.dataset.selectedText = selectedText;
  },

  /**
   * Apply annotation (bold, underline, or highlight colour)
   */
  applyAnnotation: function(type, colour) {
    var selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    var range = selection.getRangeAt(0);
    var span = document.createElement('span');

    switch (type) {
      case 'bold':
        span.style.fontWeight = 'bold';
        break;
      case 'underline':
        span.style.textDecoration = 'underline';
        break;
      case 'highlight':
        span.style.backgroundColor = colour || '#FDEAA8';
        span.style.borderRadius = '2px';
        span.style.padding = '1px 2px';
        break;
    }

    try {
      range.surroundContents(span);
    } catch (e) {
      var fragment = range.extractContents();
      span.appendChild(fragment);
      range.insertNode(span);
    }

    selection.removeAllRanges();
    document.getElementById('annotation-toolbar').classList.remove('visible');
  },

  /**
   * Open the code creation modal with selected text
   */
  openCodeModal: function(selectedText, editingCode) {
    var modal = document.getElementById('code-modal');
    if (!modal) return;

    document.getElementById('code-selected-text').textContent = selectedText || '';
    document.getElementById('code-label-input').value = editingCode ? editingCode.label : '';
    document.getElementById('code-memo-input').value = editingCode ? editingCode.memo : '';

    // Use session-wide filter; set the hidden select and display the read-only label
    var sessionFilter = App.state.selectedFilter || '';
    document.getElementById('code-filter-select').value = sessionFilter;
    var filterValueEl = document.getElementById('code-filter-value');
    if (filterValueEl) {
      filterValueEl.textContent = sessionFilter || 'Not selected';
    }
    var filterObj = sessionFilter ? this.filters.find(function(f) { return f.value === sessionFilter; }) : null;
    document.getElementById('filter-help').textContent = filterObj ? filterObj.description : '';

    modal.dataset.editingId = editingCode ? editingCode.id : '';
    modal.dataset.selectedText = selectedText || (editingCode ? editingCode.highlightedText : '');

    modal.classList.add('open');
    document.getElementById('code-label-input').focus();
  },

  /**
   * Close the code modal
   */
  closeCodeModal: function() {
    var modal = document.getElementById('code-modal');
    if (modal) modal.classList.remove('open');
  },

  /**
   * Save a code (create or update)
   */
  saveCode: function() {
    var modal = document.getElementById('code-modal');
    var label = document.getElementById('code-label-input').value.trim();
    var filter = App.state.selectedFilter || '';
    var memo = document.getElementById('code-memo-input').value.trim();
    var selectedText = modal.dataset.selectedText;
    var editingId = modal.dataset.editingId;

    if (!label) {
      App.showSnackbar('Please enter a code label.');
      return;
    }
    if (!filter) {
      App.showSnackbar('Please choose a coding filter from the setup screen or ask the AI tutor.');
      return;
    }

    if (editingId) {
      var code = null;
      for (var i = 0; i < App.state.codes.length; i++) {
        if (App.state.codes[i].id === editingId) {
          code = App.state.codes[i];
          break;
        }
      }
      if (code) {
        code.label = label;
        code.filter = filter;
        code.memo = memo;
      }
    } else {
      var newCode = {
        id: 'code-' + Date.now(),
        label: label,
        filter: filter,
        highlightedText: selectedText,
        memo: memo,
        timestamp: new Date().toISOString()
      };

      this.codeColourMap[newCode.id] = this.colours[this.colourIndex % this.colours.length];
      this.colourIndex++;

      App.state.codes.push(newCode);

      this.highlightTextInThread(selectedText, this.codeColourMap[newCode.id]);
    }

    Storage.save(App.state);
    this.renderCodesList();
    this.closeCodeModal();
    App.showSnackbar(editingId ? 'Code updated.' : 'Code created.');
  },

  /**
   * Delete a code
   */
  deleteCode: function(codeId) {
    var index = -1;
    for (var i = 0; i < App.state.codes.length; i++) {
      if (App.state.codes[i].id === codeId) { index = i; break; }
    }
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
  highlightTextInThread: function(text, colour) {
    var threadContent = document.getElementById('thread-content');
    if (!threadContent) return;

    var walker = document.createTreeWalker(threadContent, NodeFilter.SHOW_TEXT, null, false);
    var node;

    while ((node = walker.nextNode())) {
      var idx = node.textContent.indexOf(text);
      if (idx !== -1) {
        var range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + text.length);

        var mark = document.createElement('mark');
        mark.style.backgroundColor = colour;
        mark.style.borderRadius = '2px';
        mark.style.padding = '1px 0';

        try {
          range.surroundContents(mark);
        } catch (e) { /* partial selection across nodes */ }
        break;
      }
    }
  },

  /**
   * Render the codes list panel
   */
  renderCodesList: function() {
    var list = document.getElementById('codes-list');
    if (!list) return;

    if (!App.state || App.state.codes.length === 0) {
      list.innerHTML = '<div class="codes-empty"><span class="material-icons">code</span><p>No codes yet. Select text in the thread and tap "Code" to begin.</p></div>';
      return;
    }

    var self = this;
    var html = '';
    App.state.codes.forEach(function(code) {
      var colour = self.codeColourMap[code.id] || '#FDEAA8';
      var excerpt = code.highlightedText.length > 50
        ? code.highlightedText.substring(0, 50) + '...'
        : code.highlightedText;

      html +=
        '<div class="code-card mdc-card" data-code-id="' + code.id + '">' +
          '<div class="code-card__header" onclick="Coding.toggleCodeExpand(\'' + code.id + '\')">' +
            '<div class="code-card__colour" style="background-color: ' + colour + '"></div>' +
            '<div class="code-card__info">' +
              '<span class="code-card__label">' + self.escapeHtml(code.label) + '</span>' +
              '<span class="code-card__filter">' + self.escapeHtml(code.filter) + '</span>' +
              '<span class="code-card__excerpt">"' + self.escapeHtml(excerpt) + '"</span>' +
            '</div>' +
            '<div class="code-card__actions">' +
              '<button class="mdc-icon-button code-card__btn" onclick="event.stopPropagation(); Coding.editCode(\'' + code.id + '\')" aria-label="Edit code">' +
                '<span class="material-icons">edit</span>' +
              '</button>' +
              '<button class="mdc-icon-button code-card__btn code-card__btn--delete" onclick="event.stopPropagation(); Coding.confirmDelete(\'' + code.id + '\')" aria-label="Delete code">' +
                '<span class="material-icons">delete</span>' +
              '</button>' +
            '</div>' +
          '</div>' +
          '<div class="code-card__memo" id="memo-' + code.id + '">' +
            '<p class="code-card__memo-label">Memo:</p>' +
            '<p class="code-card__memo-text">' + self.escapeHtml(code.memo || 'No memo written.') + '</p>' +
            '<p class="code-card__full-text-label">Full text:</p>' +
            '<p class="code-card__full-text">"' + self.escapeHtml(code.highlightedText) + '"</p>' +
          '</div>' +
        '</div>';
    });

    list.innerHTML = html;
  },

  /**
   * Edit an existing code
   */
  editCode: function(codeId) {
    var code = null;
    for (var i = 0; i < App.state.codes.length; i++) {
      if (App.state.codes[i].id === codeId) { code = App.state.codes[i]; break; }
    }
    if (code) this.openCodeModal('', code);
  },

  /**
   * Toggle code card expansion
   */
  toggleCodeExpand: function(codeId) {
    var memo = document.getElementById('memo-' + codeId);
    if (memo) memo.classList.toggle('expanded');
  },

  /**
   * Confirm code deletion
   */
  confirmDelete: function(codeId) {
    var dialog = document.getElementById('delete-dialog');
    if (dialog) {
      dialog.dataset.codeId = codeId;
      dialog.classList.add('open');
    }
  },

  /**
   * Escape HTML entities
   */
  escapeHtml: function(text) {
    var div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  },

  /**
   * Get unique filters used across all codes
   */
  getUsedFilters: function() {
    var filterSet = {};
    App.state.codes.forEach(function(c) {
      filterSet[c.filter] = true;
    });
    return Object.keys(filterSet);
  }
};
