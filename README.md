# QualCode — AI-Scaffolded Qualitative Coding Tool

QualCode is a browser-based educational tool that teaches first-cycle inductive qualitative coding. Students upload a personal reflection or field notes document (via Google Docs), read it openly, choose a coding filter from Johnny Saldaña's *The Coding Manual for Qualitative Researchers*, and annotate the text — all guided by an AI tutor powered by Google's Gemini API.

The app runs entirely client-side with no backend. All student work is persisted in `localStorage` and can be exported as a styled PDF.

---

## Features

- **Inductive coding workflow** — Students read the data first, then choose a coding filter based on what they notice. The AI asks them to justify their choice.
- **AI tutor** — A Gemini-powered conversational agent that scaffolds the session using trauma-informed pedagogy (SAMHSA 2014). It greets, nudges, asks follow-up questions, and prompts research question formulation — but never does the analysis for the student.
- **11 Saldaña coding filters** — In Vivo, Descriptive, Process, Initial, Emotion, Values, Evaluation, Versus, Structural, Holistic, and Provisional.
- **Text annotation** — Select text in the document pane to highlight (4 colours), bold, underline, or create a code with a label and analytical memo.
- **Timed 20-minute session** — Structured phases with automatic transitions and ARIA-live announcements for accessibility.
- **Session persistence** — Resume interrupted sessions with all codes, chat history, and timer state intact.
- **PDF export** — One-click export of codes, memos, AI follow-up Q&A, and the student's emergent research question.
- **Responsive design** — Split-pane layout on desktop; stacked layout with a slide-out codes drawer on mobile.
- **Multilingual support** — The AI mirrors the student's language (English, French, or Creole) at B1 CEFR level.

---

## Session Flow

```
Setup → Pre-coding (0–5 min) → Filter Selection → Coding (5–15 min) → Follow-up (15–18 min) → Debrief (18–20 min) → Export
```

| Phase | What happens |
|---|---|
| **Setup** | Student enters their ID, pastes a Google Doc URL, and provides API keys. |
| **Pre-coding** | Student reads the document with an open mind. The AI stays mostly silent. |
| **Filter selection** | At 5 minutes the filter dropdown appears. The AI asks *why* the student chose that filter. |
| **Coding** | Student selects text, creates codes with labels and memos. The AI intervenes only if needed. |
| **Follow-up** | The AI asks 4 targeted questions (Clarify, Expand, Nuance, Emergent) referencing the student's specific codes. |
| **Debrief** | The AI asks the student to formulate a potential research question based on their codes. |
| **Export** | Student downloads a PDF containing all codes, memos, Q&A exchanges, and their emergent research question. |

---

## Getting Started

### Prerequisites

- A modern web browser (Chrome, Firefox, Safari, Edge)
- A [Google AI Studio](https://aistudio.google.com/) API key for Gemini
- A [Google Cloud](https://console.cloud.google.com/) API key with the Drive API enabled (for loading Google Docs)

### Running locally

1. Clone the repository:
   ```bash
   git clone https://github.com/Najma-Collective/Qual_Code.git
   cd Qual_Code
   ```

2. Serve the files with any static server:
   ```bash
   # Python
   python3 -m http.server 8000

   # Node
   npx serve .
   ```

3. Open `http://localhost:8000` in your browser.

4. On the setup screen, enter your Student ID, paste a Google Doc sharing link, and provide your Gemini and Drive API keys. Keys are saved to `localStorage` for subsequent sessions.

> **Note:** The Google Doc must be shared as "Anyone with the link can view" for the Drive API export to work.

---

## Project Structure

```
Qual_Code/
├── index.html          # Main UI — setup screen, chat, document pane, modals
├── config.js           # Default API key placeholders
├── css/
│   └── styles.css      # Material Design 3 styling with Haitian-inspired palette
└── js/
    ├── app.js          # Application orchestration, session lifecycle, Google Doc loading
    ├── ai.js           # Gemini API calls, system prompt, heartbeat, follow-up/debrief
    ├── coding.js       # Text selection, annotation toolbar, code CRUD, codes list
    ├── storage.js      # localStorage persistence and session state schema
    ├── timer.js        # 20-minute countdown with phase-transition callbacks
    └── export.js       # PDF generation via jsPDF
```

### Key files

- **`js/ai.js`** — Contains the full system prompt that governs AI behaviour across all phases. The prompt is rebuilt on every API call with live session data (elapsed time, current phase, student's codes and memos).
- **`js/coding.js`** — Handles the entire annotation and coding UX: text selection detection, floating toolbar positioning, code creation/edit/delete modals, highlight colour assignment, and the codes list rendering for both mobile drawer and desktop panel.
- **`js/timer.js`** — Fires milestone callbacks at 5, 15, and 20 minutes to trigger phase transitions. Persists elapsed seconds so sessions can be resumed.

---

## Coding Filters

| Filter | Description |
|---|---|
| **In Vivo** | Uses the participant's own words as the code. Preserves original voice. |
| **Descriptive** | Summarises the topic of a passage in a word or short phrase. |
| **Process** | Uses gerunds (-ing words) to capture actions or processes. |
| **Initial** | Open, exploratory coding. Stay close to the data. |
| **Emotion** | Labels the emotions expressed or inferred from the data. |
| **Values** | Captures values, attitudes, and beliefs reflected in the data. |
| **Evaluation** | Assigns evaluative judgments to the data. |
| **Versus** | Identifies dichotomies, conflicts, or binary oppositions. |
| **Structural** | Codes data according to its relevance to a specific topic or question. |
| **Holistic** | Applies a single code to a large unit of data. Captures the gist. |
| **Provisional** | Starts from a pre-established list of codes, then modifies as needed. |

---

## API Integration

### Gemini (AI Tutor)

The app calls the Gemini `generateContent` endpoint with the full conversation history and a dynamically generated system prompt. It auto-selects the best available model from your API key's quota:

1. `gemini-3.1-pro-preview`
2. `gemini-2.5-pro-preview-05-06`
3. `gemini-2.0-flash`
4. `gemini-1.5-pro`

A **heartbeat** mechanism pings the AI every 60 seconds during pre-coding and coding phases, allowing it to proactively nudge the student if needed (e.g., if no codes have been created after 7 minutes). The AI responds with `[SILENT]` when no intervention is needed, and the message is suppressed.

### Google Drive (Document Loading)

The app exports a Google Doc as HTML via the Drive API (`files/{id}/export?mimeType=text/html`), extracts the title from the first heading, and renders the content in the document pane.

---

## Design Principles

- **Trauma-informed pedagogy** — Follows the SAMHSA (2014) six key principles: Safety, Trustworthiness, Peer Support, Collaboration, Empowerment, and Cultural Awareness.
- **Inductive reasoning** — Students observe the data before choosing an analytical lens. The research question emerges from the codes, not the other way around.
- **Scaffolding, not doing** — The AI facilitates reflection but never produces codes, memos, or analysis on the student's behalf.
- **B1-level language** — All AI output targets B1 CEFR level English, warm and concise (2–4 sentences max). The AI mirrors the student's language if they write in Creole or French.
- **Formative assessment** — No grades. The exercise is a self-check designed to build confidence with qualitative methods.

---

## Technology

- **No build step** — Vanilla HTML, CSS, and JavaScript. Open `index.html` and go.
- **Material Design 3** — Uses [MDC Web](https://github.com/nicholasgasior/mdc-web) components for text fields, buttons, cards, and dialogs.
- **jsPDF** — Client-side PDF generation for the export feature.
- **localStorage** — All session data persisted locally; nothing is sent to a server beyond the Gemini and Drive API calls.

---

## Colour Palette

The UI uses a Haitian-inspired colour scheme:

| Role | Colour | Hex |
|---|---|---|
| Primary | Dark blue | `#00209F` |
| Secondary | Red | `#D21034` |
| Tertiary | Gold | `#E8A317` |
| Surface | Off-white | `#FAFAF8` |
| Error | Red | `#B3261E` |

---

## License

This project is developed by the [Najma Collective](https://github.com/Najma-Collective).
