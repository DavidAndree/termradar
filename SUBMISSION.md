# Devpost submission: TermRadar

Copy each section into the matching Devpost field.

---

**Project name:** TermRadar

**Tagline (short pitch):** Drop in your syllabi and see your crunch weeks before they hit. Private on-device AI turns every deadline into a semester heatmap, a prep plan and a calendar.

**Built with (tags):** javascript, html5, css3, webllm, webgpu, qwen, chrono-node, pdf.js, github-pages

**Try it out links:** <GitHub Pages URL> · <GitHub repo URL>

---

## Inspiration

Every class hands out a syllabus, and every one is formatted differently: a table in CS, a weekly outline in physics, paragraphs in English. Students read them one at a time, so nobody notices until it's too late that a midterm, a physics exam and an essay all land in the same three days. I wanted one screen that shows the whole semester's pressure at a glance and tells me when to *start*, not just when things are due.

## What it does

- **Scans syllabi** (PDF or pasted text, several at once) and extracts every graded deadline: exams, projects, papers, quizzes, labs and breaks.
- **Detects grading breakdowns** ("Midterm 20%") and assigns weights to each item, so a 30% final counts more than a 4% homework.
- **Semester radar:** a heatmap with one row per course and a combined row. A red dot marks *collision weeks*, where major work lands in two or more courses at once.
- **Week view and prep plan:** click any week to see what's due, what share of your total grade it carries, and a "start by" date for each item.
- **AI study coach:** an on-device LLM streams a day-by-day plan for that week, prioritized by weight and due date.
- **"What do I need?" calculator:** enter your scores so far and your target grade to see the average you need on the remaining work.
- **Calendar export:** one `.ics` file for Google, Apple or Outlook, with built-in "start preparing" reminders.
- **Fully editable:** every item can be corrected, and badges show whether it was found by rules, by AI, or by both ("verified").

**Example (before → after):** Before, three separate syllabi in three formats, and no idea that Mar 3–5 has a CS midterm (20%), a physics exam (20%) and an English essay (20%). After, one click shows Mar 1 as a red collision week carrying 60% of three course grades, with "start Feb 24 / Feb 25 / Feb 26" prep dates and an AI plan for that week.

## How I built it

TermRadar is a static web app (vanilla JS modules, no build step) with all of its AI running in the browser:

1. **PDF.js** extracts text from PDFs client-side, rebuilding line structure from text positions.
2. **Rule engine** (chrono-node plus regex) finds every real calendar date, classifies items by keyword, detects course code and term (so "Mar 3" resolves to the correct year), and parses grading weights from tables, bullet lists and prose.
3. **On-device LLM:** Qwen2.5-1.5B-Instruct runs through **WebLLM on WebGPU**. Its output is constrained by a **JSON schema** (`{title, type, date}`), so it returns structured data, not chat text.
4. **"AI proposes, rules verify":** every AI-proposed deadline is kept only if its date actually appears in the syllabus text (the rule engine's "anchors"). Hallucinated dates are blocked and counted. When both systems agree, the item is marked *verified*.
5. **Scoring:** each item's load is its type weight × (1 + grade weight / 20). Loads are summed per course per week to drive the heatmap and collision detection.
6. **Calendar:** I wrote an RFC 5545 iCalendar generator with VALARM "start preparing" reminders.

## AI implementation

- **Model:** Qwen2.5-1.5B-Instruct (4-bit, MLC format) via WebLLM 0.2.86, running locally on the user's GPU. It downloads once (~1 GB) and is cached by the browser.
- **Role 1, extraction:** reads messy syllabus text in chunks and proposes graded items as schema-constrained JSON.
- **Role 2, study coach:** given a week's deadlines, weights and today's date, it streams a 5–7 step prep plan.
- **Safety and quality:** the hallucination guard, temperature 0 for extraction, and a deterministic rule-engine fallback when WebGPU isn't available.
- **Why on-device:** syllabi and grades are personal. Running locally means it's free, needs no API keys (nothing to leak in a public repo), and keeps the data private.

## Challenges I ran into

- **Every syllabus format is different.** Tables put the date and the deadline in different cells, weekly outlines put the date on one line and "Lab report due" two lines below, and prose packs several deadlines into one sentence. I handled these with table-cell splitting, sentence splitting, and a "date context" carried across nearby lines.
- **Small models invent dates.** A 1.5B model is fast enough for a browser but sometimes hallucinates. Grounding every AI date against dates literally present in the text solved this without losing the model's better titles and classification.
- **Matching grade weights to items.** "Exam 1 20% / Exam 2 20%" should not be split evenly across every exam. Token matching (including numbers) plus exact-name priority fixed it.
- **Year inference.** "Jan 18" in a Spring 2027 syllabus has to land in 2027, so the term line sets the reference date.

## Accomplishments I'm proud of

- A useful AI app that costs nothing to run and never sends data to a server.
- The "AI proposes, rules verify" design, which makes a small local model trustworthy.
- A polished, accessible interface with light and dark themes, keyboard support, a mobile layout and reduced-motion support.

## What I learned

- How to run an LLM in the browser with WebGPU and constrain its output with JSON schemas.
- Combining deterministic code with an LLM gives better results than either alone.
- Practical date parsing and why time zones and year inference matter.
- The iCalendar format.

## What's next

- An OCR fallback (Tesseract.js) for scanned PDFs.
- Canvas/LMS import.
- Shared semesters for study groups, to spot crunch weeks the whole team has in common.
- A larger optional model for higher extraction accuracy on capable GPUs.

## AI-assisted development disclosure

I used Claude (Anthropic) as an AI coding assistant for scaffolding, code generation, debugging and documentation. I reviewed, tested and directed the project, and can explain how every part works. Third-party libraries: WebLLM, Qwen2.5 (Apache 2.0), chrono-node (MIT), PDF.js (Apache 2.0). The sample syllabi are fictional.
