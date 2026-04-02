/**
 * export.js — PDF export functionality using jsPDF
 */

const Export = {
  /**
   * Generate and download the PDF export
   */
  generatePDF() {
    if (typeof jspdf === 'undefined' || !jspdf.jsPDF) {
      App.showSnackbar('PDF library not loaded. Please check your internet connection and try again.');
      return;
    }

    const { jsPDF } = jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const state = App.state;
    const pageWidth = 210;
    const margin = 20;
    const contentWidth = pageWidth - 2 * margin;
    let y = margin;

    const colours = {
      primary: [0, 32, 159],     // #00209F
      secondary: [210, 16, 52],  // #D21034
      dark: [28, 27, 31],        // #1C1B1F
      grey: [121, 116, 126],     // #79747E
      lightBg: [240, 237, 232]   // #F0EDE8
    };

    function checkPage(needed) {
      if (y + needed > 277) {
        doc.addPage();
        y = margin;
      }
    }

    function addTitle(text) {
      checkPage(12);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.setTextColor(...colours.primary);
      doc.text(text, margin, y);
      y += 10;
    }

    function addSubtitle(text) {
      checkPage(10);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(...colours.dark);
      doc.text(text, margin, y);
      y += 7;
    }

    function addBody(text, indent) {
      indent = indent || 0;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(...colours.dark);
      const lines = doc.splitTextToSize(text, contentWidth - indent);
      lines.forEach(function(line) {
        checkPage(6);
        doc.text(line, margin + indent, y);
        y += 5;
      });
      y += 2;
    }

    function addLabel(label, value) {
      checkPage(8);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(...colours.grey);
      doc.text(label, margin, y);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...colours.dark);
      doc.text(value, margin + doc.getTextWidth(label) + 2, y);
      y += 6;
    }

    function addDivider() {
      checkPage(6);
      doc.setDrawColor(...colours.grey);
      doc.setLineWidth(0.3);
      doc.line(margin, y, pageWidth - margin, y);
      y += 6;
    }

    // Header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(...colours.primary);
    doc.text('QUALITATIVE CODING EXERCISE', margin, y);
    y += 8;
    doc.setFontSize(12);
    doc.setTextColor(...colours.grey);
    doc.text('Export Report', margin, y);
    y += 10;

    addDivider();

    // Session info
    addLabel('Student ID: ', state.studentId || 'Not provided');
    addLabel('Date: ', new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }));
    addLabel('Duration: ', '20 minutes');

    y += 4;

    addLabel('Document: ', '"' + (state.documentTitle || 'Not available') + '"');

    const usedFilters = Coding.getUsedFilters();
    if (usedFilters.length > 0) {
      addLabel('Coding Filter(s) Used: ', usedFilters.join(', '));
    }

    addDivider();

    // Codes and Memos
    addTitle('Codes and Memos');
    y += 2;

    if (state.codes.length === 0) {
      addBody('No codes were created during this session.');
    } else {
      state.codes.forEach(function(code, i) {
        checkPage(30);

        // Code number and label
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(...colours.primary);
        doc.text((i + 1) + '. ' + code.label, margin, y);
        y += 6;

        var filterObj = Coding.filters.find(function(f) { return f.value === code.filter || f.label === code.filter; });
        var filterLabel = filterObj ? filterObj.label : code.filter;
        addLabel('   Filter: ', filterLabel);

        doc.setFont('helvetica', 'italic');
        doc.setFontSize(9);
        doc.setTextColor(...colours.grey);
        var textLines = doc.splitTextToSize('"' + code.highlightedText + '"', contentWidth - 8);
        textLines.forEach(function(line) {
          checkPage(5);
          doc.text(line, margin + 8, y);
          y += 4.5;
        });
        y += 2;

        if (code.memo) {
          addLabel('   Memo: ', '');
          addBody(code.memo, 8);
        }

        y += 3;
      });
    }

    addDivider();

    // AI Follow-up Questions and Responses
    addTitle('AI Follow-up Questions and Responses');
    y += 2;

    if (state.aiFollowUpResponses.length === 0) {
      addBody('No follow-up questions were completed during this session.');
    } else {
      state.aiFollowUpResponses.forEach(function(pair, i) {
        checkPage(20);
        addSubtitle('Q' + (i + 1) + ':');
        addBody(pair.question, 4);
        addSubtitle('A' + (i + 1) + ':');
        addBody(pair.answer, 4);
        y += 3;
      });
    }

    addDivider();

    // Key Takeaway
    addTitle('Key Takeaway');
    if (state.keyTakeaway) {
      addBody(state.keyTakeaway);
    } else {
      addBody('No key takeaway was recorded.');
    }

    // Save
    const filename = 'qualitative-coding-' + (state.studentId || 'export') + '-' + new Date().toISOString().slice(0, 10) + '.pdf';
    doc.save(filename);
    App.showSnackbar('PDF exported successfully.');
  }
};
