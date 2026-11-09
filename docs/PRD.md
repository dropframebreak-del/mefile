# mefile — Product Requirements Document

| Field | Value |
| --- | --- |
| Product name | **mefile** (see naming note below) |
| Document status | Derived from source code; no stakeholder interviews |
| Date | 4 November 2026 |
| Source revision | `8645a3c` |
| Repository | `C:\dev\saakhilo` |
| Method | Every behaviour below was read from the files cited. Anything not determinable from code is marked **Unclear from code**. Items that do not exist are confined to §10 Future work. |

> **Naming note.** The user-facing name is **mefile**: `README.md:1`, `public/index.html:6`, the header brand (`public/index.html:17-24`), and the page titles (`public/js/app.js:545,552,581,590,605,1336`). The npm package is still named `meeting-notes-pdf` (`package.json:2`) and the startup banner still prints `Meeting Notes → PDF` (`server/index.js:395`). This document uses "mefile" for the product and treats the remaining strings as a naming inconsistency rather than a second product.

---

## 1. Overview and problem statement

mefile is a single-user, local-first web application that turns raw meeting notes or transcripts into a structured report, lets the user correct that report in place, and exports it as a PDF or Markdown file.

**The problem, as evidenced by the feature set:**

- Meeting notes arrive as messy text: transcripts with timestamps and cue numbers, partial sentences, role labels instead of names. The cleaning code in `server/ai/text.js` exists specifically to handle this.
- Producing a shareable document (summary, decisions, owners, deadlines, risks) is manual work that people skip.
- Cloud note-taking tools require uploading confidential meeting content to a third party. mefile's entire design — loopback binding (`server/config.js:15`), on-disk JSON (`server/store.js`), a renderer denied network and filesystem access (`server/pdf/render.js:22-25`) — exists to avoid that.

**What the product does:**

1. Accepts pasted text or an uploaded text file (`server/index.js:335-372`).
2. Sends the cleaned notes to a language model running on a configurable local address (`server/ai/provider.js:126-205`).
3. Coerces the model's JSON into a fixed report schema (`server/ai/schema.js:331-403`).
4. Presents the report as an editable form (`public/js/app.js:1127-1337`).
5. Renders a paginated PDF with a cover, table of contents, and footer page numbers (`server/pdf/render.js:341-457`).

There is no build step, no database, no account system, and no external service beyond the configured model endpoint (`README.md`; `public/index.html` loads only local assets).

---

## 2. Target users

Inferred from capabilities; the codebase contains no persona research.

**Primary user**

- An individual who takes or receives meeting notes and needs a shareable written report.
- Works on a single machine: there is one global settings file (`data/settings.json`, `server/store.js:97-110`) and no concept of users, owners, or tenants anywhere in the code.
- Has a machine capable of running a 7–8B parameter model. `README.md:15-20` specifies Node 20.11+, 8 GB RAM minimum, and notes that 6 GB VRAM will partially offload to CPU.
- Is technical enough to install Node.js and a model runtime, per the quick start in `README.md:22-42`.

**Secondary user**

- Someone in a privacy-constrained setting (legal, HR, healthcare, internal product) who cannot send notes to a cloud API. This is the explicit positioning: "Nothing is sent to a cloud API" (`README.md:8`), and the cover footer states "Prepared on your machine. Nothing in this document left your computer." (`server/pdf/render.js:219`).

**Explicit non-users, based on absent capability**

- Teams needing shared access or per-user separation: no authentication or authorization exists (`server/index.js` defines no auth middleware).
- Users who want to upload `.docx`/`.pdf` or audio: rejected by the extension allowlist (`server/index.js:339-342`) and listed as out of scope in `README.md:200-202`.
- Users who want real-time collaboration or cloud sync: no such code paths.

---

## 3. Goals and non-goals

### Goals (each implemented)

| # | Goal | Implementation |
| --- | --- | --- |
| G1 | Keep notes and reports on the local machine by default | `server/config.js:15` (loopback bind), `server/store.js` (disk persistence), no telemetry or third-party assets anywhere |
| G2 | Extract a fixed, predictable report schema from unstructured text | `server/ai/prompts.js:1-60` (schema + 15 rules), `server/ai/schema.js:294-403` |
| G3 | Survive weak or non-compliant local models | `server/ai/parse.js:5-59` (lenient JSON), `server/ai/generate.js:98-128` (two repair attempts), `server/ai/schema.js` (coercion, dedupe, limits) |
| G4 | Fit long transcripts into a small context window | `server/ai/text.js:76-96` (overlapping chunks), `server/ai/generate.js:61-88` (per-chunk condensing) |
| G5 | Let the user correct the AI output without a separate editor | `public/js/app.js:999-1337` (inline editing, add/remove, autosave) |
| G6 | Produce a print-ready PDF that looks deliberate | `server/pdf/render.js` (A4, cover, TOC, tables, footer page numbers) |
| G7 | Give honest, actionable failure states | `server/ai/provider.js:104-121` (friendly network errors), `server/index.js:284-297` (status + error persisted), `public/js/app.js:796-801` (inline composer error) |
| G8 | Work without a build toolchain or framework | `package.json:6` (`"type": "module"`), `public/js/app.js` (vanilla ES module), `public/index.html:260` |

### Non-goals (absent from the codebase)

- Audio recording or transcription. No media handling exists; `README.md:200` states "no audio transcription".
- Ingesting `.docx` or `.pdf`. Rejected at `server/index.js:339-342`.
- Multi-user accounts, permissions, or sharing. No auth middleware, no session, no user field in storage.
- Cloud sync or backup. Storage is a local directory (`server/config.js:9-13`).
- Meeting scheduling or calendar integration. No calendar code.
- Server-side full-text search or pagination. The library payload is finite and filtered in the browser (`public/js/app.js:661-664`).
- Usage analytics or telemetry. No analytics code or third-party scripts; `Content-Security-Policy` is not set either.

---

## 4. Core features

### 4.1 Library and navigation

| Capability | Behaviour | Files |
| --- | --- | --- |
| Hash-based routing | `#/library`, `#/new`, `#/meeting/:id`, `#/settings`; unknown hashes fall back to the library | `public/js/app.js:528-555` |
| Meeting cards | Title, summary line, status chip (Analysing/Failed/Draft), date, action-item count, attendee count, relative update time, model or source filename | `public/js/app.js:676-704` |
| Search | Case-insensitive substring filter over title, summary overview, and source filename; shows "N of M meetings" and a "No matches" state | `public/js/app.js:661-674` |
| Delete | Per-card delete button, custom confirmation dialog, server deletes the JSON file and aborts any active run | `public/js/app.js:1076-1097,1373-1402`; `server/index.js:193-200` |
| Empty state | Explains the three-step flow and offers "Create your first report" and "Try the sample meeting" | `public/index.html:62-80` |
| Draft resume | Opening a meeting that has no result reopens the composer with its notes pre-filled | `public/js/app.js:568-596` |
| Responsive layout | Two-column composer collapses at 960px; single-column library and compact header at 720px; reduced-motion support | `public/css/app.css:1815-1952` |

### 4.2 Notes input and file ingestion

| Capability | Behaviour | Files |
| --- | --- | --- |
| Paste/edit notes | Textarea with live "N words · N characters" counter | `public/index.html:99-106`; `public/js/app.js:716-720` |
| Drag and drop | Dropzone accepts the first dropped file and uploads it | `public/js/app.js:218-236` |
| File picker | Hidden input plus "Upload file" label | `public/index.html:110-114`; `public/js/app.js:200-204` |
| Server-side upload | 5 MB limit, in-memory storage, UTF-8 decode, extension allowlist `.txt .md .markdown .vtt .srt .json .log` | `server/index.js:22,335-372` |
| JSON transcript flattening | A JSON array of objects is converted to `Speaker: text` lines using `speaker/name/user` and `text/content/message` | `server/index.js:346-366` |
| Sample transcript | Fetches `/samples/sample-transcript.vtt` into the textarea | `public/js/app.js:722-733`; `server/index.js:374` |
| Clear | Empties the textarea and resets the counter | `public/js/app.js:208,710-714` |
| Client-side guard | Analysis is blocked under 40 characters with an inline message | `public/js/app.js:753-756` |
| Transcript cleaning | Removes WEBVTT header, NOTE blocks, cue timestamps, cue settings, SRT indices, `Kind:`/`Language:` lines, control characters, and collapses whitespace | `server/ai/text.js:10-48` |

### 4.3 AI connectivity and status

| Capability | Behaviour | Files |
| --- | --- | --- |
| Status pill | Shows the active model name when the endpoint responds, otherwise "AI offline"; clicking opens Settings | `public/index.html:33-36`; `public/js/app.js:438-453` |
| Health probe | `GET /api/health` races model discovery against a 1.8 s timeout and reports `online`, `provider`, `model`, `baseUrl`, and `dataDir` | `server/index.js:81-98` |
| Server discovery | Probes Ollama (11434), LM Studio (1234), llama.cpp (8080), Jan (1337), and vLLM (8000), returning only reachable servers | `server/ai/provider.js:1-7,85-96` |
| Model listing | `GET /api/models` normalises the address, infers provider kind, and returns id/name/parameter size | `server/ai/provider.js:52-83`; `server/index.js:109-119` |
| Model picker | Composer dropdown populated from the model list, with a "(not installed)" entry if the saved model is missing | `public/js/app.js:500-522` |
| Auto-selection | If no model is saved, prefers `qwen2.5 7b`, `llama3.1 8b`, or `mistral 7b`, else the first available model | `server/index.js:66-79` |
| Connection test | `POST /api/ai/test` probes an arbitrary address and returns the discovered models | `server/index.js:121-129`; `server/ai/provider.js:98-102` |
| Offline guidance | A warning card appears in the composer when no server is reachable | `public/index.html:147-151`; `public/js/app.js:471-475` |
| Refresh | Manual refresh button re-lists models and re-detects providers | `public/js/app.js:210-216` |

### 4.4 Generation pipeline

| Capability | Behaviour | Files |
| --- | --- | --- |
| Run isolation | One active run per meeting; a second request returns HTTP 409 `busy` | `server/index.js:23,214-216` |
| Live progress | Server-Sent Events with `phase`, `done`, `cancelled`, and `error` events, plus a 15 s heartbeat comment | `server/index.js:243-260,268-306` |
| Phase model | reading 5% → condensing 12–42% → analyzing 50% → repairing 58–62% → reviewing 78% → saving 94% | `server/ai/generate.js:47,62,90,100,140,171` |
| Progress UI | Full-screen overlay with phase title, detail, progress bar (`aria-valuenow`), elapsed seconds, and Cancel | `public/index.html:227-242`; `public/js/app.js:803-838` |
| Cancellation | Client aborts the fetch and posts to `/cancel`; server aborts the controller and resets status to `draft` | `public/js/app.js:920-925`; `server/index.js:202-209,284-291` |
| Disconnect handling | If the client closes the request, the run is aborted server-side | `server/index.js:262-266` |
| Shutdown handling | `SIGINT`/`SIGTERM` abort all active runs before exit | `server/index.js:402-408` |
| Persisted outcome | Status transitions `draft → generating → ready` or `error`; the error message is stored on the meeting | `server/index.js:238-241,277-297` |
| Stats and warnings | Elapsed time, characters, words, token estimate, chunk count, model, provider usage, and deduplicated warnings | `server/ai/generate.js:172-181`; `public/js/app.js:1320-1331` |
| Result-driven title | The meeting title is replaced by the model's report title on success | `server/index.js:281` |

### 4.5 Review and inline editing

| Capability | Behaviour | Files |
| --- | --- | --- |
| Editable report | Every field is an input, textarea, or select: title, date, time, duration, location, organiser, objective, tags | `public/js/app.js:1132-1147` |
| Sections | Executive summary, attendees, agenda, discussion topics, decisions, action items, risks, open questions, next steps | `public/js/app.js:1149-1318` |
| Add/remove items | Attendees, topics, decisions, risks, and action items can be added or removed; focus moves to the new field | `public/js/app.js:1022-1071` |
| Action items | Checkbox for done, owner, due date, priority select (high/medium/low), optional context, visual strike-through when done | `public/js/app.js:1240-1272` |
| Autosave | Debounced 900 ms after a change; retries if a newer revision arrived during save; visible `Unsaved / Saving… / Saved / Save failed` state | `public/js/app.js:931-993` |
| Manual save | Save button and Ctrl/Cmd+S in the review view | `public/js/app.js:269,304-309` |
| Unsaved-change guard | Browser prompt before leaving with unsaved edits | `public/js/app.js:316-321` |
| Edit notes | Returns to the composer with the same meeting id, so re-analysis replaces the existing result | `public/js/app.js:624-630,766-775` |
| Server-side re-validation | Saving a result re-runs the coercion pipeline; invalid payloads are rejected with `invalid_result` | `server/index.js:174-191` |
| Counts | Live counts for attendees, decisions, action items, risks, topics | `public/js/app.js:1099-1107` |

### 4.6 Export

| Capability | Behaviour | Files |
| --- | --- | --- |
| PDF download | `GET /api/meetings/:id/pdf` returns `application/pdf` as an attachment with an RFC 5987 filename | `server/index.js:308-323` |
| PDF preview | Same endpoint with `?inline=1`, opened in a new tab | `public/js/app.js:1353-1356` |
| PDF layout | A4 with cover (accent rule, "MEETING REPORT", title, objective, metadata table, tags, stat columns, footer note), table of contents, numbered sections, tables, checkbox column, footer with title and "Page X of Y" | `server/pdf/render.js:147-224,226-457` |
| Safe filenames | Slugified title, 60-character cap, `.pdf` fallback to `meeting-report.pdf` | `server/pdf/render.js:467-474` |
| Markdown export | Sectioned Markdown including metadata, summary, attendee and action tables, decisions, risks, open questions, next steps, and a "Generated locally with AI" note | `server/markdown.js:6-94` |
| Markdown filename | Slugified title, `.md`, fallback `meeting-report.md` | `server/markdown.js:96-103` |
| Save-before-export | The review view flushes pending edits before any download | `public/js/app.js:1339-1345` |

### 4.7 Settings

| Capability | Behaviour | Files |
| --- | --- | --- |
| Report defaults | Creativity slider (0–0.8 in the DOM, clamped 0–1 by the server) and a "Thorough review by default" toggle | `public/index.html:194-214`; `server/index.js:58-60` |
| Persistence | `GET/PUT /api/settings`, merged over defaults, written atomically | `server/index.js:131-137`; `server/store.js:97-110` |
| Debounced autosave | Composer controls save 700 ms after change | `public/js/app.js:367-376` |
| About panel | States that the app runs locally, notes go only to the local model, and data is stored as JSON | `public/index.html:216-222` |
| Generation-time overrides | A generate request can carry `notes`, `model`, `temperature`, `thorough`, `baseUrl`, `provider`, which are saved back to settings | `server/index.js:218-235`; `public/js/app.js:850-857` |

**Observed gap:** the shipped Settings page contains no controls for server address, provider, or model, although `public/js/app.js:299-302,334-340,379-390,403-426,1408-1434` expects `#settings-baseurl`, `#settings-provider`, `#settings-model`, `#test-connection`, `#detect-servers`, and `#detected-servers`. None of those ids exist in `public/index.html:185-224`. Those handlers are null-guarded, so the page works, but the only ways to change `baseUrl`/`provider`/`numCtx` are the REST API or `data/settings.json`. See §9.

### 4.8 Persistence and HTTP surface

| Capability | Behaviour | Files |
| --- | --- | --- |
| One JSON file per meeting | `data/meetings/<id>.json`, written to a temp file and renamed | `server/store.js:8-13,43-45,82-87` |
| Safe IDs | Slug (≤32 chars) + `YYYYMMDD-HHMM` + 4 hex characters; validated against `^[a-z0-9-]{4,80}$` | `server/store.js:6,27-41` |
| Listing | Returns a trimmed view (no notes, no full result) sorted by `updatedAt` descending | `server/store.js:47-75` |
| Settings file | `data/settings.json`, defaults merged on read | `server/config.js:13,18-25`; `server/store.js:97-110` |
| Static serving | `/samples` and the `public` directory, then an SPA fallback to `index.html` for non-API GETs | `server/index.js:374-380` |
| API headers | `X-Powered-By` disabled; `nosniff`, `no-referrer`, and `no-store` on `/api/` | `server/index.js:25-33` |

---

## 5. User flow

### Primary flow: New report → Analyse → Review → Download PDF

```
[Library]
   │  "New report" (#/new)
   ▼
[Composer]
   │  paste notes / upload file / load sample
   │  choose model, creativity, thorough  ← settings autosaved
   │  "Analyse notes" (or Ctrl+Enter)
   ▼
POST /api/meetings (draft created, status = draft)      server/index.js:143-166
   │
   ▼
POST /api/meetings/:id/generate  →  text/event-stream    server/index.js:211-306
   │
   ├─ phase: reading      (clean + normalise)            server/ai/text.js:10-48
   ├─ phase: condensing   (only if input > maxChars)     server/ai/generate.js:61-88
   ├─ phase: analyzing    (extract JSON)                 server/ai/generate.js:90-91
   ├─ phase: repairing    (up to 2 retries)              server/ai/generate.js:98-120
   ├─ phase: reviewing    (only if thorough = true)      server/ai/generate.js:139-169
   └─ phase: saving       (status = ready)               server/ai/generate.js:171
   │
   ▼
[Review] #/meeting/:id
   │  edit any field, add/remove items, tick actions
   │  autosave 900 ms → PUT /api/meetings/:id            public/js/app.js:947-993
   │
   ├─ "Preview PDF" → GET …/pdf?inline=1 (new tab)
   ├─ "Download PDF" → GET …/pdf (attachment)
   └─ "Markdown" → GET …/markdown (attachment)
```

**Step detail**

1. **Enter notes.** The user pastes text, drops a file, uploads one, or loads the bundled sample (`public/js/app.js:195-236,722-749`). The composer shows a live word/character count. A model must be selectable; if none is found, analysis is blocked with an explanation (`public/js/app.js:757-760`).
2. **Analyse.** Under 40 characters is rejected client-side (`public/js/app.js:753-756`). A meeting record is created first, so a draft survives a failure; the generation request then opens an SSE stream (`public/js/app.js:765-775,840-918`).
3. **Watch progress.** The overlay shows the current phase, a human-readable detail line, a percentage, and elapsed seconds (`public/js/app.js:803-838`). Cancel aborts both the fetch and the server run, returning the meeting to `draft` (`server/index.js:284-291`).
4. **Review.** On success the user is routed to `#/meeting/:id`. Every extracted field is editable, and structural changes (add/remove) are supported (`public/js/app.js:1127-1337`). Edits autosave; the save indicator reflects queued, saving, saved, and failed states.
5. **Export.** PDF preview opens inline; PDF and Markdown download as attachments. The filename derives from the report title (`server/pdf/render.js:467-474`; `server/markdown.js:96-103`).

### Alternate flows

| Flow | Behaviour | Files |
| --- | --- | --- |
| AI offline | Pill reads "AI offline"; composer shows a notice card; analysis fails with a readable message if attempted | `public/js/app.js:438-453,471-475`; `server/ai/provider.js:104-121` |
| Malformed model output | Up to two repair turns quoting the validation error; if still unusable, status becomes `error` with the reason stored | `server/ai/generate.js:98-128`; `server/index.js:291-297` |
| Model runs out of tokens | `doneReason === 'length'` adds a warning that items may be missing | `server/ai/generate.js:133-135` |
| Empty extraction | If no action items or decisions were found, a warning suggests checking the notes or enabling thorough review | `server/ai/generate.js:135-137` |
| Long transcript | Input above `min(18000, max(6000, numCtx×3))` characters is condensed chunk by chunk; a warning records the part count | `server/ai/generate.js:57-88` |
| Edit existing notes | "Edit notes" reuses the meeting id, so re-analysis replaces the report instead of creating a duplicate | `public/js/app.js:624-630,766-775` |
| Delete | Confirmation dialog, then file deletion; an in-flight run for that meeting is aborted | `public/js/app.js:1083-1097`; `server/index.js:193-200` |
| Draft with no result | Opening it returns to the composer with its notes, not an empty report | `public/js/app.js:583-591` |

---

## 6. Technical architecture

### 6.1 Stack

| Layer | Choice | Evidence |
| --- | --- | --- |
| Runtime | Node.js ≥ 20.11 | `package.json:13-15` |
| HTTP server | Express 5 | `package.json:17`; `server/index.js:21` |
| Upload parsing | multer, memory storage | `server/index.js:22` |
| PDF generation | pdfmake 0.3 with bundled Roboto | `package.json:19`; `server/pdf/render.js:1-16` |
| Frontend | Vanilla ES modules, no framework, no build | `public/index.html:260`; `public/js/app.js:1` |
| Styling | Hand-written CSS with custom properties | `public/css/app.css` |
| Persistence | JSON files on disk | `server/store.js` |
| AI transport | Ollama native API or OpenAI-compatible chat completions | `server/ai/provider.js:126-154` |
| Tests | `node:test` | `test/*.test.js`; `package.json:11` |

### 6.2 Modules

| Module | Responsibility | Files |
| --- | --- | --- |
| Composition root | Express app, routes, SSE, error middleware, shutdown | `server/index.js` |
| Configuration | Paths, host, port, default settings, directory creation | `server/config.js` |
| Storage | Atomic JSON read/write, ID generation, listing, settings merge | `server/store.js` |
| AI adapter | Address normalisation, provider inference, model discovery, chat calls, error mapping | `server/ai/provider.js` |
| Pipeline | Normalise → condense → extract → repair → review → stats | `server/ai/generate.js` |
| Prompts | Extraction schema and rules, condensing, repair, review | `server/ai/prompts.js` |
| Parsing | Fence stripping, balanced-brace JSON extraction, minor repairs | `server/ai/parse.js` |
| Schema | Coercion, limits, owner resolution, dedupe, merge | `server/ai/schema.js` |
| Text | Transcript cleaning, token estimate, chunking, word count | `server/ai/text.js` |
| PDF | Document definition, styles, cover, TOC, footer, renderer | `server/pdf/render.js` |
| Markdown | Text export | `server/markdown.js` |
| Frontend | Routing, state, API client, composer, review, settings, dialogs | `public/js/app.js` |

### 6.3 HTTP API

| Method | Path | Purpose | File |
| --- | --- | --- | --- |
| GET | `/api/health` | AI status, model, base URL, data directory | `server/index.js:81-98` |
| GET | `/api/providers` | Detect reachable local runtimes | `server/index.js:100-107` |
| GET | `/api/models` | List models for an address/provider | `server/index.js:109-119` |
| POST | `/api/ai/test` | Probe an address and return its models | `server/index.js:121-129` |
| GET, PUT | `/api/settings` | Read/merge settings | `server/index.js:131-137` |
| GET, POST | `/api/meetings` | List trimmed meetings; create a draft | `server/index.js:139-166` |
| GET, PUT, DELETE | `/api/meetings/:id` | Read, update title/notes/result/status, delete | `server/index.js:168-200` |
| POST | `/api/meetings/:id/generate` | Run the pipeline, stream SSE events | `server/index.js:211-306` |
| POST | `/api/meetings/:id/cancel` | Abort an active run | `server/index.js:202-209` |
| GET | `/api/meetings/:id/pdf` | Render PDF (`?inline=1` for preview) | `server/index.js:308-323` |
| GET | `/api/meetings/:id/markdown` | Render Markdown | `server/index.js:325-333` |
| POST | `/api/upload` | Accept a text file, return extracted text | `server/index.js:335-372` |

Error responses are uniformly `{ error, code }`; `AiError` carries its own HTTP status (`server/index.js:35-37,382-391`; `server/ai/provider.js:9-16`).

### 6.4 AI pipeline in detail

1. **Normalise.** Strip BOM, normalise newlines, remove VTT/SRT artefacts, control characters, and excess whitespace (`server/ai/text.js:10-48`). Empty input aborts with `empty_notes` (`server/ai/generate.js:49-51`). Under 40 characters adds a "very short notes" warning (`server/ai/generate.js:52-54`).
2. **Decide on condensing.** Token estimate is `ceil(chars / 3.6)` (`server/ai/text.js:50-53`). The working limit is `min(18000, max(6000, numCtx × 3))` characters (`server/ai/generate.js:57`). Above it, the text is split on paragraphs/sentences with 600-character overlap (`server/ai/text.js:76-96`) and each part is condensed sequentially at temperature 0.1 with a 900-token cap, preserving decisions, actions, owners, deadlines, numbers, and risks (`server/ai/prompts.js:75-95`; `server/ai/generate.js:61-88`).
3. **Extract.** One JSON-mode chat call at the user's temperature, 4096 output tokens, 600 s timeout, with a schema and 15 explicit rules including "never invent", relative-date resolution against today, decisions vs action items, deferrals to open questions, owner = person not role, and no cross-list duplication (`server/ai/prompts.js:1-73`; `server/ai/generate.js:20-36`).
4. **Parse leniently.** Strip code fences, scan for the first balanced JSON object while respecting string escapes, then accept trailing commas and smart quotes via a second parse attempt (`server/ai/parse.js:5-59`).
5. **Coerce.** Unwrap `meeting`/`report`/`result`/`data`; map aliases for every field; bound all strings and list lengths; normalise priorities; derive sentence casing; resolve owner names from attendee roles; move conditional "if we… consider…" items from decisions to open questions; drop decisions that duplicate action items; deduplicate decisions, risks, action items, and tags; fall back to "Meeting notes"; fail fatally when no usable content remains (`server/ai/schema.js:294-403`).
6. **Repair.** Up to two extra calls at temperature 0.1 supplying the validation error, a 6000-character snippet of the bad output, and the source notes (`server/ai/generate.js:98-120`; `server/ai/prompts.js:97-121`).
7. **Review (optional).** When thorough mode is on, a dedicated call returns only missing/incorrect items (actions, decisions, risks, open questions, highlights), merged with union-and-dedupe semantics (`server/ai/generate.js:139-169`; `server/ai/prompts.js:123-158`; `server/ai/schema.js:405-422`). A review failure is non-fatal and becomes a warning (`server/ai/generate.js:165-168`).
8. **Report stats.** Elapsed time, characters, words, token estimate, chunks, model, token usage, and unique warnings (`server/ai/generate.js:171-183`).

**Model abstraction.** `chat()` normalises the origin, removes `/v1` or `/api` suffixes, infers Ollama from port 11434 or the provider id, and posts either `format: "json"` with `options.num_ctx`/`num_predict` (Ollama) or `response_format: {"type":"json_object"}` with `max_tokens` (OpenAI-compatible). It combines the caller's abort signal with a timeout, maps connection refused, timeouts, HTTP statuses, and empty bodies to friendly messages, and returns content, model, usage, and finish reason (`server/ai/provider.js:18-41,104-205`).

### 6.5 Storage model

Each meeting is one JSON document containing `id`, `title`, `status` (`draft` | `generating` | `ready` | `error`), `createdAt`, `updatedAt`, `model`, `source` (`notes`, `filename`, `chars`), `result`, `stats`, and `error` (`server/index.js:151-164,237-241,277-297`).

The `result` object is fixed by `emptyResult()` (`server/ai/schema.js:294-314`):

```
title, date, time, durationMinutes, location, organizer, objective,
attendees[{name, role}],
summary{overview, highlights[]},
agenda[],
topics[{title, summary, points[], decisions[], followUps[]}],
decisions[{decision, rationale, owner}],
actionItems[{id, task, owner, dueDate, priority, status, context}],
risks[{risk, impact, mitigation, owner}],
openQuestions[],
nextMeeting{date, focus, prep},
tags[]
```

Hard limits are enforced during coercion: title 180, short fields 200, lines 400, paragraphs 1800, 60 attendees, 20 topics, 18 points per topic, 60 action items, 30 decisions, 20 risks, 20 questions, 12 tags (`server/ai/schema.js:7-20`).

Writes are atomic per file (temp + rename), and listing skips files whose ids fail validation or whose JSON cannot be read (`server/store.js:8-21,47-55`).

### 6.6 Frontend architecture

A single module holds a `state` object and renders by replacing `innerHTML` for the library grid and review body (`public/js/app.js:4-26`). A small `request()` wrapper centralises JSON fetch and error extraction (`public/js/app.js:92-119`). Review editing uses `data-path` attributes written through a path setter, which means one delegated listener handles every field (`public/js/app.js:77-86,999-1020`). Save races are handled with a revision counter: if the revision changed during an in-flight save, another save is scheduled (`public/js/app.js:947-993`). Toasts are transient DOM nodes; deletion uses a promise-based modal with a `window.confirm` fallback (`public/js/app.js:125-145,1371-1402`).

---

## 7. Data and privacy

### What is stored, and where

| Data | Location | Contents | Evidence |
| --- | --- | --- | --- |
| Meetings | `data/meetings/<id>.json` | Full source notes plus the complete result and generation stats | `server/config.js:12`; `server/store.js:43-45,82-87` |
| Settings | `data/settings.json` | `baseUrl`, `provider`, `model`, `temperature`, `thorough`, `numCtx` | `server/config.js:13,18-25` |
| Data directory | Default `./data`, overridable via `MEETING_DATA_DIR` | Created on demand | `server/config.js:9-13,27-31` |
| Uploaded files | Never persisted as files | Read into memory, decoded, and returned as text; only the resulting notes are stored | `server/index.js:22,335-372` |
| Browser storage | None | No `localStorage`, `sessionStorage`, cookie, or IndexedDB usage | `public/js/app.js` |
| Logs | Stdout only | Startup banner, unexpected server errors | `server/index.js:389,393-400` |

`data/` is git-ignored (`AGENTS.md` aside, see `.gitignore:2`), as are `*.pdf` and `*.log` (`.gitignore:3-4`).

### What leaves the machine

- **Nothing, when `baseUrl` is a loopback address.** Notes, prompts, and model output travel only to the configured endpoint (`server/ai/provider.js:126-205`).
- **Everything sent to the model, if `baseUrl` is remote.** The address is user-configurable (`server/config.js:19`; `server/index.js:55`), so the privacy claim in `README.md:8` holds only while it points at the local runtime.
- **No other outbound requests.** There are no CDNs, fonts, analytics, or update checks; `public/index.html:12-13` loads only local files, and the only `fetch` targets in server code are the configured AI origin (`server/ai/provider.js:44-49,161-166`).
- **No telemetry.** No reporting code exists.

### Renderer isolation

The PDF renderer denies all URL access and restricts local file reads to the bundled font directory (`server/pdf/render.js:18-27`). Emoji and control characters are stripped from text before layout (`server/pdf/render.js:48-55`). Fonts come from the installed `pdfmake` package (`server/pdf/render.js:5-16`).

### Privacy gaps (see also §9)

- No authentication or authorization: anyone who can reach the port can read, edit, and delete every meeting (`server/index.js` defines no auth middleware).
- No transport encryption: plain HTTP (`server/index.js:393-396`).
- No encryption at rest: meeting JSON is readable text, including full transcripts.
- No `Host`/`Origin` validation, so a malicious page or DNS rebinding on the same machine is not explicitly blocked by application code.
- The default loopback bind (`server/config.js:15`) is the only access control, and it is a deliberate one; `README.md:124` advises leaving it as loopback.

---

## 8. Configuration and requirements

### Environment variables

| Variable | Default | Effect | Evidence |
| --- | --- | --- | --- |
| `HOST` | `127.0.0.1` | Bind address | `server/config.js:15`; `server/index.js:393` |
| `PORT` | `4317` | HTTP port | `server/config.js:16` |
| `MEETING_DATA_DIR` | `<repo>/data` | Storage location | `server/config.js:9-11` |

### Settings

| Key | Default | Validation | Evidence |
| --- | --- | --- | --- |
| `baseUrl` | `http://127.0.0.1:11434` | Non-empty string, normalised (scheme added, trailing `/`, `/v1`, `/api` stripped) | `server/config.js:19`; `server/index.js:55`; `server/ai/provider.js:18-26` |
| `provider` | `ollama` | Free-form string; `ollama` selects the native API, anything else uses OpenAI-compatible | `server/config.js:20`; `server/ai/provider.js:28-41` |
| `model` | `''` (auto-detected) | Trimmed string; auto-pick prefers 7–8B instruct models | `server/config.js:21`; `server/index.js:66-79` |
| `temperature` | `0.2` | Clamped to 0–1 by both the route and the store | `server/config.js:22`; `server/index.js:58-60`; `server/store.js:104-106` |
| `thorough` | `false` | Boolean | `server/config.js:23` |
| `numCtx` | `8192` | Must be ≥ 2048 | `server/config.js:24`; `server/index.js:62`; `server/store.js:107` |

**How each is changeable today**

| Setting | UI | API | File |
| --- | --- | --- | --- |
| `temperature` | Composer slider, Settings slider | `PUT /api/settings` | `public/index.html:134-137,197-201` |
| `thorough` | Composer toggle, Settings toggle | `PUT /api/settings` | `public/index.html:138-144,203-209` |
| `model` | Composer dropdown | `PUT /api/settings` | `public/js/app.js:500-522` |
| `baseUrl` | **No control in the shipped UI** | `PUT /api/settings`, `POST /api/ai/test` | see §4.7 gap |
| `provider` | **No control in the shipped UI** | `PUT /api/settings` | see §4.7 gap |
| `numCtx` | None | `PUT /api/settings` | see §4.7 gap |

The settings models referenced by the frontend but missing from the markup are documented in §9; nothing in this PRD assumes they are visible.

### Runtime requirements

| Requirement | Value | Evidence |
| --- | --- | --- |
| Node.js | ≥ 20.11 | `package.json:13-15` |
| npm | Any version compatible with the lockfile | `package-lock.json` |
| AI runtime | Ollama, or any OpenAI-compatible server (LM Studio, llama.cpp, Jan, vLLM) | `server/ai/provider.js:1-7`; `README.md:18` |
| Model | A 7–8B instruct model that follows JSON instructions; `qwen2.5:7b-instruct` recommended | `README.md:19,44-51` |
| Memory | 8 GB RAM minimum; 6 GB VRAM runs a 7B Q4 model partly on CPU | `README.md:20,53` |
| Disk | Model size plus `data/` | `README.md:46-51` |
| Network | Not required after setup, unless `baseUrl` points elsewhere | `server/ai/provider.js` is the only outbound client |
| Browser | **Unclear from code.** The frontend uses ES modules, optional chaining, and modern DOM APIs with no transpilation step (`public/js/app.js`, `public/index.html:260`); no supported-browser matrix is declared. |

### Scripts

| Script | Command | Purpose |
| --- | --- | --- |
| `npm start` | `node server/index.js` | Run the app (`package.json:9`) |
| `npm run dev` | `node --watch server/index.js` | Restart on server changes (`package.json:10`) |
| `npm test` | `node --test` | Run the suites (`package.json:11`) |

There is no build, lint, format, or typecheck script.

---

## 9. Known limitations

### Stated in the README

| Limitation | Evidence |
| --- | --- |
| Text input only; no `.docx` or `.pdf` upload | `README.md:200`; enforced at `server/index.js:339-342` |
| No audio transcription | `README.md:200` |
| One meeting per report; long transcripts are condensed, so fine detail can be lost | `README.md:201-202`; warning emitted at `server/ai/generate.js:87` |
| AI output can be wrong; names, dates, and owners need checking | `README.md:203-204`; also printed on the PDF cover and Markdown footer (`server/pdf/render.js:219,387`; `server/markdown.js:92`) |
| Bind address should stay loopback | `README.md:124` |

### Observable in the code

| Limitation | Detail | Evidence |
| --- | --- | --- |
| No authentication | Every API route is open to anyone who can reach the port | `server/index.js` (no auth middleware) |
| No HTTPS | Plain `http.createServer` under Express | `server/index.js:393` |
| No encryption at rest | Full notes stored as readable JSON | `server/store.js:8-13` |
| Single global settings file | Changing the model or defaults affects the whole installation; there is no per-user state | `server/store.js:97-110` |
| In-process run registry | Concurrency is limited per meeting, not globally; restarting the server loses the registry but not the data | `server/index.js:23,214-216` |
| No cross-process locking | Atomic per-file writes, but two server instances on the same data directory would race with last-write-wins semantics | `server/store.js:8-13` |
| No schema versioning | Stored meetings carry no `schemaVersion`; a future shape change has no migration path | `server/index.js:151-164`; `server/ai/schema.js:294-314` |
| Permanent deletion | Delete removes the file immediately, with no trash or undo | `server/store.js:89-95`; `public/js/app.js:1083-1097` |
| Search is client-side and shallow | Filters only title, summary overview, and filename; notes are not searched, and the whole list is loaded with no pagination | `public/js/app.js:661-664`; `server/store.js:56-72` |
| Input ceilings | 5 MB upload, 400,000-character notes on create, 12 MB JSON body | `server/index.js:22,26,148-150` |
| PDF typography | Roboto only, emoji stripped, no images or charts | `server/pdf/render.js:5-16,48-55` |
| Tests cover only pure logic | `text`, `schema`/`parse`, and PDF rendering; no HTTP route, SSE, storage, or frontend tests | `test/text.test.js`, `test/schema.test.js`, `test/pdf.test.js` |
| Settings UI does not match frontend code | `#settings-baseurl`, `#settings-provider`, `#settings-model`, `#test-connection`, `#detect-servers`, `#detected-servers` are referenced but absent from the markup, so server address/provider/context cannot be changed from the UI | `public/js/app.js:299-302,334-340,379-390,403-426,1408-1434` vs `public/index.html:185-224` |
| AI status pill can report offline when online | `loadHealth()` dereferences `#about-data-dir`, which does not exist; the thrown `TypeError` is caught by the same `try`, and the catch sets the pill to offline | `public/js/app.js:428-436` vs `public/index.html` (no such id) |
| Card keyboard activation | Cards expose `role="button"` and `tabindex="0"` but have no key handler, so Enter/Space do not open them | `public/js/app.js:687`; only global Ctrl handlers at `public/js/app.js:304-314` |
| Modal keyboard support | The delete dialog has no focus trap, no Escape handler, and no initial focus | `public/js/app.js:1371-1402` |
| Naming inconsistency | UI/README say mefile; package name and startup banner still say "Meeting Notes → PDF" | `package.json:2`; `server/index.js:395`; `README.md:1` |
| No i18n | Dates use `en-GB`; all copy is English | `server/pdf/render.js:62,378`; `public/js/app.js:47,59` |
| No dark theme | No `prefers-color-scheme` support; reduced motion is supported | `public/css/app.css:1944-1952` |
| Unreferenced artefacts | `data/e2e-meeting-id.txt` and `data/thorough-meeting-id.txt` exist in the working tree but are referenced nowhere in the repository | **Unclear from code**; no reads or writes found |
| Tests depend on Node behaviour | `import.meta.dirname` is used, requiring the Node version floor in `package.json` | `test/text.test.js:7` |

---

## 10. Future work

Everything in this section is **not implemented**. It is listed to separate known gaps from shipped behaviour.

### Correctness and UX gaps found while reading the code

1. Restore the missing Settings controls for server address, provider, and context size, matching the handlers that already exist in `public/js/app.js:299-302,334-340,403-426,1408-1434`.
2. Guard or add `#about-data-dir` so the AI pill reflects real health instead of falling back to offline (`public/js/app.js:432`).
3. Add keyboard activation for meeting cards and focus trapping plus Escape handling for the delete dialog.
4. Add HTTP-level tests: route validation, SSE phase ordering, cancellation, upload parsing, and storage round-trips.
5. Add a `schemaVersion` field and a migration path for stored meetings.

### Product extensions

6. Server-side search and pagination, including searching notes and report text.
7. Authentication and per-user data separation, as a prerequisite for any shared or networked deployment.
8. Optional TLS and encryption at rest.
9. Import from `.docx`/`.pdf` and audio transcription.
10. Streaming token output during generation instead of phase-only progress.
11. Richer PDF options: template choice, branding, additional fonts, embedded images.
12. Localization and a dark theme.
13. Export formats beyond PDF and Markdown (e.g. `.docx`).
14. Retention controls: archive, trash/restore, and a delete-all action.
15. Model management from the UI (pull/remove models, show size and context window).
16. An install/run path for non-technical users, given the current Node + model-runtime prerequisite.

---

## 11. Success metrics

**No analytics or metrics collection exists in the codebase.** The definitions below are therefore proposed, with the data source that would supply them today. Figures marked "proposed" are targets, not current behaviour.

| Metric | Definition | Available source today | Instrumented? | Proposed target |
| --- | --- | --- | --- | --- |
| Generation success rate | Meetings reaching `ready` divided by meetings that entered `generating` | `status` field on stored meetings (`server/index.js:238-297`) | Partially — status is persisted, no aggregate | ≥ 90% on the recommended model |
| Median generation time | Median `stats.elapsedMs` for successful runs | `server/ai/generate.js:172-181` | Yes, per meeting | ≤ 90 s for 45 minutes of notes on 6 GB VRAM (`README.md:53`) |
| Repair rate | Share of runs needing at least one repair phase | Phase events are streamed but not stored | No — would need a new persisted counter | Trend downward after model or prompt changes |
| Warning rate | Share of successful runs with one or more warnings | `stats.warnings` | Yes, per meeting | ≤ 20% |
| Post-generation edit rate | Share of reports where at least one field changed before export | No event log; save requests are not counted | No | Track after instrumentation exists |
| Action-item completeness | Average owners assigned and due dates present per report | `result.actionItems` | Yes, derivable | Owners on ≥ 80% of items where notes name one |
| Export rate | Share of `ready` reports downloaded as PDF or Markdown | No request logging | No | ≥ 60% |
| Privacy regressions | Count of outbound hosts other than `baseUrl` | None by design (`server/ai/provider.js` is the only client) | Verifiable by code review | 0 |
| Install success | New users completing setup and one successful report | None | No | Measure via manual onboarding until analytics are explicitly designed |

Measurement constraints worth stating in any metrics review: there is no request logging, no analytics SDK, and no aggregation layer. Any dashboard would require new instrumentation, which itself would need a privacy decision, since the product's premise is that nothing leaves the machine.

---

## Appendix A — Sources reviewed

- `README.md`
- `package.json`, `package-lock.json` (dependency names only), `.gitignore`
- `server/config.js`, `server/index.js`, `server/store.js`, `server/markdown.js`
- `server/ai/generate.js`, `server/ai/provider.js`, `server/ai/prompts.js`, `server/ai/parse.js`, `server/ai/schema.js`, `server/ai/text.js`
- `server/pdf/render.js`
- `public/index.html`, `public/js/app.js`, `public/css/app.css`
- `test/text.test.js`, `test/schema.test.js`, `test/pdf.test.js`, `test/fixtures.js`
- `samples/sample-transcript.vtt` (fixture content only)

## Appendix B — Items marked "Unclear from code"

1. Minimum supported browser version (no browserlist, transpilation, or documentation).
2. Purpose and origin of `data/e2e-meeting-id.txt` and `data/thorough-meeting-id.txt`.
3. Whether the simplified Settings markup in `public/index.html` is an intentional scope reduction or an incomplete merge; the frontend handlers clearly expect the richer form.
4. Whether `numCtx` is intended to be user-editable; the API and store support it, but no UI references it.
5. Intended distribution model (local checkout versus packaged installer); only a Node startup path is documented.
