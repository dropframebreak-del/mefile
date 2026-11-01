   # mefile — local meeting reports

Paste messy meeting notes or a transcript. A language model running on your own
machine turns them into a structured, print-ready PDF report: cover page, table of
contents, executive summary, discussion, decisions, an action-item table with
checkboxes, risks, open questions and page numbers.

Nothing is sent to a cloud API. Notes go to a model server on `127.0.0.1` and the
result is stored as JSON on disk.

---

## Requirements

| | |
| --- | --- |
| Node.js | 20.11 or newer (built on 24) |
| AI runtime | [Ollama](https://ollama.com) recommended; LM Studio, llama.cpp, Jan and vLLM also work |
| Model | any 7–8B instruct model that follows JSON instructions |
| RAM/VRAM | 8 GB RAM minimum. 6 GB VRAM runs a 7B Q4 model partly on CPU |

## Quick start

```bash
# 1. install dependencies
npm install

# 2. get a model (one time, ~4.7 GB)
ollama pull qwen2.5:7b-instruct

# 3. make sure the server is running
ollama serve

# 4. start the app
npm start
```

Open <http://127.0.0.1:4317>. The status pill in the top right turns green and
shows the active model when the AI server is reachable.

Ollama normally starts itself at login, so step 3 is only needed if it is not
already running.

### Which model?

| Model | Size on disk | Notes |
| --- | --- | --- |
| `qwen2.5:7b-instruct` | ~4.7 GB | **Recommended.** Reliable JSON, good at extracting owners and dates. |
| `llama3.1:8b` | ~4.9 GB | Stronger prose, slightly slower. |
| `mistral:7b-instruct` | ~4.1 GB | Fast, but drops detail on long transcripts. |
| `qwen2.5:14b-instruct` | ~9 GB | Best quality if you have 12 GB+ VRAM; very slow if it spills to CPU. |

On a 6 GB GPU expect roughly 20–40 tokens/second and **1–3 minutes** for a
45-minute meeting. The progress dialog shows each phase so it never looks hung.

## Using it

1. **New report** → paste notes, or drop a `.txt`, `.md`, `.vtt`, `.srt` or `.json`
   file. Transcript timestamps and cue numbers are stripped automatically.
2. Pick a model, optionally enable **Thorough review** (a second pass that hunts
   for missed action items and owners — roughly twice as slow).
3. **Analyse notes.** Watch the phase progress; you can cancel at any time.
4. **Review** the extracted report. Every field is editable — fix a name, add a
   decision, tick an action item as done. Changes save automatically.
5. **Download PDF**, **Preview PDF**, or export **Markdown**.

Meetings are saved in the Library and stay there until you delete them.

## What the report contains

- Cover page with title, objective, date, attendees, tags and headline counts
- Table of contents with real page numbers
- Executive summary with key takeaways
- Attendees, agenda, and discussion broken into topics
- Decisions table (decision, rationale, owner)
- Action items table with checkboxes, owner, due date and priority
- Risks and blockers with impact and mitigation
- Open questions and next-meeting details
- Footer on every page with the report title and `Page X of Y`

## How it works

```
notes ──► clean ──► [condense long transcripts] ──► extract JSON ──► validate
                                                          │              │
                                                          └── repair ◄───┘
                                                                 │
                                                        [review pass]
                                                                 │
                                                    normalise ──► PDF
```

- **One adapter, many runtimes.** `server/ai/provider.js` speaks Ollama's native
  `/api/chat` and any OpenAI-compatible `/v1/chat/completions`, so the same app
  works with LM Studio, llama.cpp, Jan and vLLM.
- **JSON is enforced, not hoped for.** Ollama gets `format: "json"`; OpenAI servers
  get `response_format: json_object`. The reply is then parsed leniently (code
  fences, stray prose and trailing commas are tolerated).
- **Bad output is repaired, not surfaced.** If the JSON will not parse or contains
  no usable content, the model gets one repair turn with the validation error.
- **Long transcripts are condensed per chunk** so a two-hour recording still fits
  the context window, with overlap so a decision on a boundary is not lost.
- **Everything is normalised** in `server/ai/schema.js`: strings coerced, lists
  capped, duplicates removed, priorities mapped to high/medium/low.

## Configuration

Settings live in the app (Settings screen) and are stored in `data/settings.json`:

| Setting | Default | Meaning |
| --- | --- | --- |
| `baseUrl` | `http://127.0.0.1:11434` | Local model server |
| `provider` | `ollama` | `ollama`, `lmstudio`, `llamacpp`, `jan`, `vllm`, `custom` |
| `model` | auto-detected | Model name as the server knows it |
| `temperature` | `0.2` | Creativity. 0.1–0.3 works best for notes |
| `thorough` | `false` | Run the second review pass |
| `numCtx` | `8192` | Context window; raise for very long notes if your model supports it |

Environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `4317` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address — leave as loopback |
| `MEETING_DATA_DIR` | `./data` | Where meetings and settings are stored |

## Privacy and storage

- The server binds to `127.0.0.1` only; it is not reachable from the network.
- Notes are sent only to the `baseUrl` you configure. There is no telemetry and no
  outbound request other than to that address.
- Meetings are plain JSON in `data/meetings/<id>.json`, including the source notes.
  `data/` is git-ignored. Delete a meeting from the Library to remove both.
- PDF fonts are bundled with `pdfmake`; the renderer is denied access to any other
  local file and to all URLs.

## Project layout

```
server/
  index.js          Express app, REST + SSE routes, static files
  config.js         paths, defaults, env
  store.js          JSON persistence for meetings and settings
  markdown.js       Markdown export
  ai/
    provider.js     Ollama + OpenAI-compatible chat, model discovery
    prompts.js      extraction, condensing, repair and review prompts
    generate.js     the pipeline, phases, cancellation
    schema.js       coercion, validation, de-duplication, merge
    parse.js        tolerant JSON extraction
    text.js         transcript cleaning and chunking
  pdf/
    render.js       pdfmake document definition and renderer
public/             zero-build frontend (HTML, CSS, ES modules)
samples/            a messy WebVTT transcript to try
test/               node:test suites
```

## Tests

```bash
npm test
```

Covers transcript cleaning (VTT/SRT), chunking, schema coercion, JSON extraction,
de-duplication, merging, and PDF rendering (including a minimal, mostly-empty
report).

## Troubleshooting

**"AI offline" in the top right.**
Start the server: `ollama serve`. Check `curl http://127.0.0.1:11434/api/tags`.
If you use another runtime, open Settings, set the address, and press *Find servers*.

**"No AI model is available."**
The server is up but has no models: `ollama pull qwen2.5:7b-instruct`. If your model
is installed under a different name, pick it in Settings.

**Generation is very slow.**
A 7B model on 6 GB VRAM offloads layers to CPU. Close other GPU-heavy apps, or use
a smaller model (`qwen2.5:3b-instruct`). Leave *Thorough review* off for speed.

**"The model ran out of output space."**
The report was cut off at the token limit. Turn on *Thorough review*, shorten the
notes, or raise output space by using a model with a larger context.

**The report misses an action item.**
Small models are imperfect. Turn on *Thorough review*, or add it manually in the
Review screen — every field is editable.

**"The model returned malformed JSON" repeatedly.**
Try a different model. `qwen2.5:7b-instruct` is the most reliable at this size;
some creative-writing models cannot hold a JSON contract.

**Port already in use.**
Run on another port: `PORT=4400 npm start` (PowerShell: `$env:PORT=4400; npm start`).

## Limits

- Text input only — no `.docx` or `.pdf` upload, no audio transcription.
- One meeting at a time per report; long transcripts are condensed, so very fine
  detail can be lost.
- AI output can be wrong. Names, dates and owners are worth a glance before you
  send the PDF to anyone.
