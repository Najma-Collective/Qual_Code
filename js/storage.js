/**
 * storage.js — localStorage management for session persistence
 */

const STORAGE_KEY = 'qualcode_session';

const Storage = {
  /**
   * Returns a blank session state object
   */
  createEmptyState() {
    return {
      studentId: '',
      documentUrl: '',
      documentId: '',
      documentTitle: '',
      researchQuestion: '',
      sessionStartTime: null,
      elapsedSeconds: 0,
      phase: 'setup', // setup | precoding | coding | followup | debrief | complete
      codes: [],
      annotations: [],
      conversationHistory: [],
      aiFollowUpResponses: [],
      keyTakeaway: '',
      selectedModel: 'gemini-3.1-pro-preview',
      selectedFilter: '',
      followUpQuestionIndex: 0
    };
  },

  /**
   * Save the current session state to localStorage
   */
  save(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      console.error('localStorage save failed:', e);
      Storage.showStorageError();
      return false;
    }
  },

  /**
   * Load session state from localStorage
   * Returns null if no saved session exists
   */
  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      console.error('localStorage load failed:', e);
      return null;
    }
  },

  /**
   * Check if a previous session exists
   */
  hasSession() {
    return localStorage.getItem(STORAGE_KEY) !== null;
  },

  /**
   * Clear the saved session
   */
  clear() {
    localStorage.removeItem(STORAGE_KEY);
  },

  /**
   * Show storage error notification
   */
  showStorageError() {
    if (typeof App !== 'undefined' && App.showSnackbar) {
      App.showSnackbar('Unable to save your work to this device. Please ensure you export your work before closing the browser.');
    }
  }
};
