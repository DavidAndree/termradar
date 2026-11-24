# TermRadar 📡

**See your crunch weeks before they hit.**

TermRadar turns your course syllabi into one semester-wide radar. It finds every exam, project, paper and quiz, stacks all your courses on a weekly heatmap, flags the weeks where several courses collide, and tells you exactly when to start each deadline. The AI runs **entirely in your browser**, so there's no sign-up, no API key, and your files never leave your device.

> Built for **Build Your First AI App 2026** (Devpost).

**Live demo:** _add your GitHub Pages link here_ · **Demo video:** _add link_

---

## The problem

Every course hands out a syllabus, and each one is formatted differently: tables, week-by-week outlines, paragraphs. Students read them one at a time, so nobody sees the full picture until it's too late: the week when a CS midterm, a physics exam and an English essay all land within three days.

## What TermRadar does

| Feature | What you get |
|---|---|
| **Syllabus scanning** | Drop several PDFs or paste text. Tables, weekly outlines and prose all work. |
| **Semester radar** | A heatmap with one row per course plus a combined row. Color shows workload; a red dot marks a *collision week* (major work in 2+ courses). |
| **Grade-aware workload** | Grading breakdowns ("Midterm 20%") are detected and spread over the matching items, so a 30% final weighs more than a 4% homework. |
| **Start-by dates** | Each deadline gets a prep window by type (exam 7 days, project 10, quiz 2…), giving a concrete "start on Tue Feb 23" plan. |
| **AI study coach** | Click any heavy week and an on-device LLM streams a day-by-day plan for it, prioritized by weight and due date. |
| **"What do I need?" calculator** | Enter your scores so far and a target grade to see the average you need on the remaining work. |
| **Calendar export** | One `.ics` file for Google, Apple or Outlook Calendar, with "start preparing" reminders built in. |
| **Review & edit** | Every extracted item is editable, and badges show whether it came from rules, AI, or both. |

## How the AI works: "AI proposes, rules verify"

```
syllabus.pdf ──► PDF.js (in browser) ──► text
                                         │
                ┌────────────────────────┴────────────────────────┐
                ▼                                                 ▼
      Rule engine (chrono-node + regex)               On-device LLM (WebLLM, WebGPU)
      • every real date in the text  = "anchors"      Qwen2.5-1.5B-Instruct, JSON-schema
      • grading weights                               constrained output: {title, type, date}
      • keyword classification                                    │
                └──────────────► merge & verify ◄─────────────────┘
                                 • AI item kept ONLY if its date is an anchor
                                   (hallucinated dates are blocked and counted)
                                 • agreement → "verified" badge
                                         │
                                         ▼
                 workload scoring → heatmap → prep plan → .ics
```

- **Model:** `Qwen2.5-1.5B-Instruct-q4f16_1-MLC` via [WebLLM](https://github.com/mlc-ai/web-llm). It downloads once (~1 GB, then cached) and runs on the user's GPU.
- **Structured output:** the model is constrained by a JSON schema, so it returns valid data rather than free text.
- **Hallucination guard:** small models sometimes invent dates. TermRadar accepts an AI-proposed deadline only if that exact date appears in the syllabus text. The scan summary reports how many were blocked.
- **Graceful fallback:** without WebGPU (e.g. Safari or older browsers) the rule engine still produces the full dashboard; only the AI coach is disabled.
- **Study coach:** the same local model streams a short day-by-day plan for the selected week.

## Try it

1. Open the live demo in Chrome or Edge (desktop).
2. Click **Try a sample semester →** to load three fictional syllabi in three different formats.
3. Click the red week of **Mar 1** on the radar (a collision week), then **✨ Load AI coach**.
4. Optional: turn on **On-device AI**, then drop in your own syllabus PDF.
5. Click **Export to calendar**.

## Run locally

No build step and no API keys.

```bash
git clone <this repo>
cd termradar
python3 -m http.server 5173
# open http://localhost:5173
```

Parser tests (Node 18+):

```bash
npm install
node tests/parser.test.mjs
```

## Tech stack

- Vanilla HTML, CSS and JavaScript (ES modules), with no framework and no build step
- [WebLLM](https://github.com/mlc-ai/web-llm) 0.2.86 with Qwen2.5-1.5B-Instruct for on-device inference on WebGPU
- [chrono-node](https://github.com/wanasit/chrono) 2.7.7 for natural-language date parsing
- [PDF.js](https://mozilla.github.io/pdf.js/) 3.11 for in-browser PDF text extraction
- iCalendar (RFC 5545) export written from scratch
- Hosted as a static site (GitHub Pages)

## Project structure

```
index.html          page layout
css/styles.css      design system, light/dark themes, responsive layout
js/parser.js        rule engine: dates, item types, grading weights, course/term detection
js/ai.js            WebLLM loading, schema-constrained extraction, verification merge, study coach
js/app.js           state, heatmap, week view, grade calculator, editing, persistence
js/calendar.js      .ics export with prep reminders
js/samples.js       three fictional sample syllabi
tests/              parser tests
```

## Privacy

Everything runs client-side. Syllabi are parsed in the browser, the model runs on your GPU, and results are stored only in your browser's localStorage. There's no server and no analytics.

## Limitations

- The on-device model needs WebGPU (Chrome or Edge on desktop) and a ~1 GB first download.
- Syllabi that give only relative dates ("Week 5, Tuesday") without calendar dates can't be placed on the calendar. Those items can be added by hand.
- Scanned (image-only) PDFs have no text layer. Paste the text instead.

## AI-assisted development disclosure

This project was built with help from Claude (Anthropic) as an AI coding assistant, used for scaffolding, code generation, debugging and documentation. The product decisions, testing and submission are my own. Third-party libraries are credited above, and the sample syllabi are fictional.

## License

MIT. See [LICENSE](LICENSE).
