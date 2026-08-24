# Design Reference: srmeeevlab.github.io

**Purpose:** Reference material for restyling VLab (`E:\work\projects\vlab\vlab`) to read as a real institutional engineering-lab platform rather than a generic startup/SaaS template. Compiled by fetching the live site's raw HTML/CSS/data (not just a text-stripped read), so most observations below — including hex colors — are directly observed, not inferred. Anywhere I'm guessing, it's flagged explicitly.

**Method note:** `WebFetch` on the root URL returned almost nothing usable (the page is a client-side JS dashboard, so the text-extraction pass saw only the empty shell). I switched to fetching raw HTML/CSS/JSON directly (`curl`) for the homepage and three lab sub-sites (`/PSA/`, `/PSOC/`, `/CE/`), plus their sub-pages (Introduction, List of Experiments, Team Details, Aim, Theory, Pre Test, Procedure, Simulation, Post Test, References, Feedback) and linked markdown content files. That gave full access to markup, inline styles, stylesheets, and copy — so color values, class names, and body text below are exact, not approximated.

---

## What kind of site this is

This isn't one website — it's a **thin dashboard** (`srmeeevlab.github.io/`) that links out to **three independently-built lab sub-sites**, each a separate GitHub repo hosted as a sub-path: `/PSA` (Power System Simulation Laboratory), `/PSOC` (Power System Operation and Control Laboratory), `/CE` (Control Engineering Laboratory). This is the standard structure of India's government-backed **"Virtual Labs" (MHRD/AICTE) initiative** — SRM's EEE department built their contribution on the official Virtual Labs template, and it shows: boilerplate like "The Virtual Labs Project started as an initiative from the Ministry of Human Resource and Development (MHRD)..." appears verbatim on the CE lab's Introduction page.

Two of the three labs (PSA, PSOC) use the **same shared template** (`vlabs-style.css`, identical header/sidebar/footer markup, only the lab title and content differ). The third (CE) is a **bespoke build** with its own CSS, its own layout system, and a visibly different visual language (rounded pill-button nav, cursive-font logo heading, blue-on-white color scheme instead of the shared template's teal/orange). This inconsistency is itself a real, observed trait of the site, not a flaw I'm inventing — see "What NOT to copy" below.

Overall character: **templated-but-real**, not generic-SaaS. It has the seams of a multi-year, multi-cohort student project (visible template reuse, inconsistent sub-sites, dev-only styling artifacts like duplicate Bootstrap versions), but the content itself — faculty names with SRM email addresses and bios, real student contributor credits, department-specific citations, per-experiment quiz/procedure structure — is unmistakably a real academic lab, not a marketing site pretending to be one.

---

## 1. Overall visual identity

- **Not polished/branded in the design-agency sense.** No custom illustration system, no consistent icon set, no marketing photography. Visual identity comes from institutional signals, not designed ones: the SRM crest/logo in the header, a Creative Commons license badge in every footer, and boilerplate MHRD/Virtual-Labs language.
- **What makes it read as "a college lab" and not a product:**
  - Every single footer (across all three lab sub-sites, every sub-page) repeats: *"Copyright © [year] Department of Electrical and Electronics Engineering, SRM Institute of Science and Technology, Kattankulathur — PALS-VLAB initiative, in collaboration with NITK as Technology Partner"* plus a Creative Commons Attribution-NonCommercial-NoDerivatives 4.0 badge and link. A SaaS product never puts a legal license badge in its footer on every page.
  - A **Team Details** page lists named faculty (with title "Assistant Professor," institutional email addresses like `maharajd@srmist.edu.in`, and links to their official SRM faculty profile pages) *and* named undergraduate student contributors with their branch (e.g. "B.Tech(EEE) Student") and email. This is a co-authorship/attribution convention unique to academic project pages — nothing like a SaaS "About the team" page.
  - A **Google Form embedded in a modal that auto-opens on page load** (`staticBackdrop` modal, `Fill the form`, with a "Verifying..." blinking status message and a 10-second delay before the close button appears) — reads as a feedback/registration gate a department administrator bolted on, not a designed onboarding flow.
  - Literal **MHRD ministry-initiative boilerplate paragraph** reused across lab intros: "The Virtual Labs Project started as an initiative from the Ministry of Human Resource and Development (MHRD) to create online interactive media..." — a phrase that only exists because this is a nationally-funded program, not something a startup would ever write.
  - Explicit **academic reference lists per experiment** in numbered citation format (see Content Organization below) — full textbook citations with author, publisher, city, year.
- **Information density:** high on content pages (Theory, References), terse on navigational/landing pages. The homepage dashboard has almost no copy at all beyond a one-line tagline; the depth is inside each lab.

---

## 2. Layout patterns

### Homepage (`srmeeevlab.github.io/`)
- Single `<nav>` bar, flex row, three items: SRM logo (links to `srmist.edu.in`) → centered tagline text → Virtual Labs program logo. No hamburger, no dropdown, no auth/login control visible in markup.
- Below the nav: a plain Bootstrap `.container` with a `.row` grid (`col-6 col-md-3` — i.e. 2-up on mobile, 4-up on desktop) populated **client-side from a `labs.json` file** fetched via `fetch()`. Each card is a Bootstrap `.card` with a thumbnail image and a centered name label. No description text on the cards at all, just name + thumbnail.
- Background: a **tiled SVG circuit-board pattern** (`background-image: url(/images/circuit-board.svg)`) behind the whole page — a concrete, cheap way to signal "electronics" without needing a designed illustration system.
- A modal (Google Form for feedback/verification) auto-fires on load, sitting on top of everything.
- No footer at all on the homepage — the footer/legal boilerplate lives only inside each lab sub-site.

### Lab sub-sites (PSA / PSOC — shared template)
- **Sticky header**, white background, bottom border in **solid orange (`#ff6600`, 8px)** — this thick accent-color bar under the header is the single most distinctive branding element on the shared template.
- Header contains: SRM logo (image link to srmist.edu.in) + lab name as an inline `<h1>` in blue, bold, no subtitle/tagline.
- **Persistent left sidebar nav** (collapses on mobile via a hamburger button), present on every page of a lab, always the same order:
  - Homepage-level: `Introduction` → `List of Experiments` → `Team Details`
  - Inside an individual experiment: `Home → Aim → Theory → Pre Test → Procedure → Simulation → Post Test → References → Feedback`
  - This 9-step experiment structure (Aim/Theory/Pretest/Procedure/Simulation/Posttest/References/Feedback) is the load-bearing structural pattern of the whole site and is the strongest "real academic lab" signal in the entire reference.
- Main content column is bordered on the left with a **dotted 2px line** (`border-left: 2px dotted #89a7c4`) separating it from the sidebar — a subtle, old-fashioned but functional content/nav separator.
- **List of Experiments** is a literal HTML `<table>`: columns "S.No" | "Experiment", each experiment name a link. Not cards, not a list — a numbered table.
- **Footer**: centered text block, light pink-gray background (`#f9f6f7`), copyright + CC license badge + license link, present identically on every sub-page.
- Simulation page embeds the actual interactive simulator in an `<iframe>` (fixed pixel sizing via media queries: 1000×1000 desktop, ~325×1000 mobile) with a "Pop Up Procedure" link that opens the procedure steps in a separate popup window (`window.open`) so students can follow steps beside the simulator — a real, practical UX pattern for lab work.

### CE lab sub-site (bespoke build — visibly different)
- Custom header: logo left, lab name centered in **cursive font**, a second "Virtual Labs" program logo on the right, then a thick **solid red horizontal bar** (`<hr style="height:12px;background:red">`) instead of the orange border-bottom.
- Navigation is a **horizontal row of pill-shaped buttons** (`.menuItems`, `border-radius: 0.7rem`, light blue `rgb(122,193,255)` background, dark navy `rgb(0,59,110)` text) rather than a sidebar: Introduction / Objective / List of experiments / Target Audience / Course Alignment / Team Details.
- Footer here is also custom: light blue bar (`rgb(122,193,255)` bg, `rgb(0,59,110)` text) instead of the shared template's pink-gray footer — same copyright text, different color treatment.
- This sub-site clearly wasn't built by the same team/cohort as PSA/PSOC — worth noting as an authenticity marker (real institutional sites accrete inconsistency across student generations) but also a caution (see "What NOT to copy").

---

## 3. Typography

Directly observed from `<link>` tags and CSS (not inferred):

- **Homepage:** `'Roboto Slab', serif` (Google Fonts) for the whole body — a slab serif is a slightly more "official/institutional" choice than a default sans, though it's only used on the thin dashboard shell.
- **Shared lab template (PSA/PSOC):** two-font pairing —
  - `'Raleway', sans-serif` for headers, nav, footer, markdown body (`.markdown-body`)
  - `"Open Sans", sans-serif` for main page body text (`.vlabs-page-main`)
  - This is a fairly standard "geometric sans for chrome, humanist sans for reading body copy" pairing — competent, not distinctive.
- **CE lab (bespoke):** `"Open Sans", sans-serif` for body; the big lab-name heading uses `font-family: cursive` — a jarring, dated choice (system cursive fonts render inconsistently and look unprofessional; flagged below under "What NOT to copy").
- **Heading hierarchy:** conventional and shallow — `h3.page-name` is the per-page title (e.g. "Introduction", "List of Experiments", "Aim"), colored blue (`#337ab7` or `#2C99CE` depending on page/CSS rule — the two blues are used somewhat interchangeably across files, another sign of multi-author drift), `h1/h2` inside markdown content also forced to `#2C99CE` and centered. No visible h4-h6 scale system; content mostly uses bold text and numbered lists rather than deep heading nesting.
- **Density:** body copy is **verbose and formal**, written in full academic paragraphs (see Tone section) — long unbroken `<p>` blocks with `text-align: justify`, not the short scannable copy of a marketing site.

---

## 4. Color usage

Exact hex/rgb values pulled directly from `default.css` and `vlabs-style.css` (these are real, not guessed):

| Role | Value | Where used |
|---|---|---|
| Dashboard background | `#5F7161` (muted sage/olive green) | homepage `body` |
| Dashboard nav bar | `#EFEAD8` (warm off-white/cream) | homepage `<nav>` |
| Dashboard card | `#D0C9C0` (warm gray/taupe) | lab thumbnail cards |
| Header accent bar | `#ff6600` (solid orange, 8px) | shared lab template header bottom-border |
| Primary heading blue | `#337ab7` and `#2C99CE` / `#2C98CD` (two close-but-different blues used inconsistently) | page titles, lab name, breadcrumbs |
| Sidebar link | `#3e6389` (steel blue), hover → `#77BB41` (green) with white text | sidebar nav |
| Content divider | `#89a7c4` (dotted border, muted blue-gray) | content/sidebar separator |
| Footer background | `#f9f6f7` (very light pink-gray) | shared template footer |
| Footer text/background (CE variant) | bg `rgb(122,193,255)` (sky blue), text `rgb(0,59,110)` (navy) | CE lab footer + nav pills |
| CE nav menu background | `rgb(221,239,255)` (pale blue) | CE lab sidebar/menu container |
| Meta theme-color | `#4076e0` (mobile browser chrome / Windows tile color) | all lab sub-pages `<meta>` tags |
| CE header rule | solid red, `height:12px` | CE lab only |

Overall palette reads as **institutional-eclectic**: no single controlled brand palette across the whole site. Each lab sub-site picked its own blue/orange/green/red accent independently, but all stay within a "muted, slightly dated Bootstrap-era" register — nothing saturated or trendy, no gradients, no dark mode. The one deliberate, consistent brand element across the entire dashboard+labs is **SRM's own logo and its blue**, appearing in every header regardless of which sub-site's palette otherwise diverges.

Not fetchable/observed: any design-token or CSS-variable system (there isn't one — these are literal hardcoded hex/rgb values scattered per stylesheet), and no dark-mode variant exists anywhere.

---

## 5. Content organization

- **Top level = a flat grid of labs**, populated from a tiny JSON file:
  ```json
  { "labs": [
      {"name":"Power System Simulation Laboratory","repoName":"PSA","image":"default.png"},
      {"name":"Power System Operation and Control Laboratory","repoName":"PSOC","image":"default.png"},
      {"name":"Control Engineering Laboratory","repoName":"CE","image":"default.png"}
  ]}
  ```
  Three labs total for this department. Cards show name + generic thumbnail only, no description, no "N experiments" count, no difficulty/duration metadata on the card itself.
- **Inside a lab:** Introduction (mission paragraph) → **List of Experiments** (numbered HTML table, one row per experiment, linking to a folder per experiment) → Team Details.
- **Inside an experiment**, the fixed 8-tab sequence (Aim → Theory → Pre Test → Procedure → Simulation → Post Test → References → Feedback) **is** the content model. Concretely, for Experiment 1 ("Modelling of Power System Components") in the PSA lab:
  - *Aim*: one-line objective + 2-3 numbered sub-objectives.
  - *Theory*: full academic write-up with headed subsections ("INTRODUCTION", "CONCEPT"), inline citation markers like `[1]`, `[3]`, bulleted technical detail (e.g. listing real transmission voltage levels: "66 kV, 110 kV, 132 kV, 220 kV, 400 kV and 765 kV").
  - *Pre Test / Post Test*: a `<div id="quiz">` populated by JS plus a "Submit Quiz" button — quiz gating before and after the simulation.
  - *Procedure*: numbered/nested steps, each annotated with a screenshot (`![Procedure 3.1, Explanation image](images/Exp1_StepN.png)`) showing exactly what to click in the simulator.
  - *Simulation*: the actual interactive tool in an iframe, plus a "Pop Up Procedure" link so students can keep steps open in a separate window while operating the simulator.
  - *References*: full numbered bibliography, real textbooks with author/publisher/city/year (e.g. "Power System Analysis by John.J.Grainger, William D. Stevenson, McGraw-Hill Education (India) Private Limited, New Delhi, 2015").
  - *Feedback*: presumably a form (not fully inspected).
- **Team Details** pages format faculty as a two-column table (photo | name, title, email, profile link) and students as a three-column table (Name | Branch | Email). This is a real, reusable "who built/runs this" pattern colleges use that a SaaS "Meet the team" grid never looks like.

---

## 6. Tone and copy style

- **Formal, academic, third-person, occasionally awkward English** — this reads as written by faculty/students, not a copywriter. Examples (verbatim):
  - "The main objective of this virtual lab is to study and analyze the fundamentals of power system analysis to benefit the students and the research scholar."
  - "This also invokes the mind of students to analyses the given topic both manually as well as practically."
  - "Many difficult concepts are already integrated in the provided course i curriculum." (typo, "i" for "in" — left uncorrected)
- **Zero marketing fluff.** No CTAs like "Get started," no adjectives like "powerful" or "seamless," no testimonials, no pricing, no social proof. Every sentence is describing what the lab teaches or how to use it.
- **Direct instructional voice in Procedure sections**: short imperative numbered steps ("Enter the inputs for the component...", "Then click check calculated impedance button.", "Click OK if you want to view the steps.") paired with screenshots — this is technical-manual tone, not UI-copy tone.
- **Legal/bureaucratic register in the footer and licensing text** — full Creative Commons license name spelled out every time, ministry-initiative language repeated verbatim across labs (evidence it's copy-pasted from a shared national template, not written per department).

---

## 7. Navigation model

- **Two-level nesting, no breadcrumbs anywhere observed.**
  - Level 0: the dashboard grid (department → list of labs).
  - Level 1: inside a lab — a short flat sidebar (Introduction / List of Experiments / Team Details), 3 items only.
  - Level 2: inside an experiment — a longer flat sidebar (8 items, the Aim...Feedback sequence), also no breadcrumb trail back to "which lab am I in" beyond the header title and a "Home" link at the top of the sidebar.
- Navigation state is marked with a plain `.active` class on the current sidebar link — no visual breadcrumb, no "you are here" path string.
- Cross-lab navigation only via a manual return to the department dashboard root — there's no persistent top-level "Labs" switcher visible once you're inside a lab (you'd use "Home" then browser back, or the SRM logo, to get elsewhere).
- The CE lab's horizontal pill-menu is navigationally equivalent to the sidebar but visually a completely different pattern — inconsistent across sub-sites (flagged above).
- Mobile: sidebar collapses behind a hamburger toggle (Bootstrap `data-toggle="collapse"`), auto-collapsed by a JS device-sniff (`/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)`) rather than a CSS media query — a dated (2015-era) technique, functionally fine but not how you'd build it today.

---

## 8. What makes this distinctly "academic institution," not generic SaaS

Concrete, non-generic signals, all directly observed:

1. **Named faculty with institutional email + link to their official university bio page**, and named undergraduate contributors credited with their branch of study, on a page literally called "Team Details."
2. **A fixed pedagogical structure per experiment** (Aim → Theory → Pretest → Procedure → Simulation → Posttest → References → Feedback) — this is a curriculum unit, not a product feature page. No SaaS onboards a user through a pretest/posttest quiz pair around a piece of UI.
3. **Formal academic bibliography per experiment**, full citation format (author, publisher, city, year) for real, purchasable textbooks.
4. **Ministry-of-education boilerplate language** ("The Virtual Labs Project started as an initiative from the Ministry of Human Resource and Development (MHRD)...") — only exists because this is a nationally-funded program, an unfakeable institutional signal.
5. **Creative Commons Attribution-NonCommercial-NoDerivatives 4.0 license badge in every single footer** — a legal/licensing posture no commercial SaaS product takes on its own content.
6. **A Google Form modal for "verification"/feedback that blocks the page on load** — bureaucratic in a way a designed product's onboarding flow never is (arbitrary 10-second timer, "Verifying..." blinking text, no design polish).
7. **Right-click and F12/devtools disabling scripts** on the simulation page (`disableContextMenu()`, keydown listener blocking F12) — a paternalistic, exam-proctoring-adjacent instinct that only appears in institutional/educational software, never in a modern SaaS product.
8. **Procedure steps annotated with literal step-by-step screenshots** (`Exp1_Step1.png` ... `Exp1_Step14.png`) embedded directly in the procedure markdown — a lab-manual convention, not a product walkthrough/tour pattern.
9. **A circuit-board SVG tiled as a page background** — a cheap, unmistakable "this is an electronics lab" visual cue with almost no design effort, which is oddly more authentic than a polished custom illustration would be.
10. **Multiple independently-built sub-sites under one department banner**, visibly built by different student cohorts with different tools/CSS conventions, all still carrying the same footer/license/ministry text — the inconsistency itself is a marker of a real, multi-year academic project rather than a single coherent product.

---

## Patterns worth adopting (for VLab's restyle)

Specific, concrete, sourced from this site:

- **Put a "Team/Credits" page with real names, roles, and institutional affiliation** if VLab has any faculty/student ownership to show — even a minimal version (name, role, contact) reads as "this is a real lab run by real people," which a polished SaaS-y about page can't fake.
- **Adopt the fixed experiment-structure convention**: Aim / Theory / Procedure / Simulation / References (VLab can skip Pretest/Posttest quiz gating if that's not the product's model, but "Theory" and "References/Further Reading" tabs next to the simulator would immediately read as a lab, not a tool). This is probably the single highest-leverage structural borrow.
- **A real bibliography/references section per experiment or per circuit**, citing actual textbooks — cheap to add, strongly signals engineering-department rigor over generic tooltip-style "learn more" links.
- **A literal, thick, single-color accent bar under the header** (their orange `#ff6600`, 8px solid) is a low-effort, high-signal "institutional" flourish — a bold flat color rule rather than a soft SaaS shadow/gradient header.
- **Numbered, table-based "List of Experiments"** rather than a card grid conveys "curriculum" more than a Tinkercad-style visual gallery does — worth considering at least as an alternate/list view alongside a card view, especially for an instructor-facing surface.
- **Procedure steps paired 1:1 with annotated screenshots** — for VLab's own experiments/tutorials, embedding a numbered click-by-click walkthrough with screenshots (not just a text description) matches how actual lab manuals are written and would read as more rigorous than free-form help text.
- **A licensing/attribution footer line** — even something as simple as course/institution attribution or a license note in the footer of lab pages adds an institutional-legitimacy signal a plain "© 2026 VLab" does not.
- **Keep department-specific, unpolished technical language where appropriate** — e.g. real citations, real component names, real specs (their example: listing actual transmission voltage classes) rather than smoothing everything into friendly SaaS copy. Precision reads as credible in an engineering context.

## What NOT to copy

Real, observed flaws — be honest about these:

- **Disabling right-click and F12/devtools on the simulation page.** This is hostile to users, trivially bypassable, breaks accessibility tooling and legitimate debugging, and reads as distrustful rather than protective. Do not adopt.
- **Auto-opening modal (Google Form) on page load with a fake "Verifying..." blinking timer and a forced 10-second wait before the user can close it.** Actively bad UX — interruptive, patronizing, and the fake verification delay serves no real purpose. Avoid any pattern that blocks the page on load without clear user intent.
- **Visual inconsistency across the CE lab vs. the PSA/PSOC shared template** — different fonts (including a cursive heading font that renders unpredictably across OSes), different color systems, different nav paradigms (pill buttons vs. sidebar) under the same department banner. If VLab has multiple content areas/modules, keep one consistent design system — don't let each get built independently.
- **Two conflicting near-identical blues used interchangeably** (`#337ab7` vs `#2C99CE`/`#2C98CD`) for what should be one semantic "heading/link" color — a sign of no design tokens. Use a defined token system instead of ad hoc hex values scattered per file.
- **Loading two different Bootstrap versions on the same homepage** (`bootstrap@5.0.2` and `bootstrap@5.1.3` both linked in `<head>`) — pure technical debt, adds weight for no benefit. A leftover from copy-paste template evolution; don't replicate the underlying carelessness even though the visual result is invisible to users.
- **Device-sniffing via `navigator.userAgent` regex to decide sidebar collapse state**, instead of a CSS media query — fragile and dated; any modern responsive approach is strictly better.
- **Justified body text** (`text-align: justify`) on long paragraphs — creates uneven word-spacing/rivers of white space in narrow columns, a legibility problem the site has on multiple Theory pages. Left-aligned is more readable.
- **No visible focus states, skip links, or ARIA landmarks observed** in the fetched markup — accessibility appears to not have been a design consideration (can't fully confirm without a rendered/visual pass, but nothing in the raw HTML suggests any accessibility-specific markup beyond default Bootstrap semantics). Don't inherit this gap.
- **Fixed pixel-dimension iframes for the simulator** (`height:1000px; width:1000px` in a desktop media query, `350px`/`325px` fallback for mobile) rather than fluid/responsive sizing — works but is brittle and wastes space on very large or very small viewports.
- **No dark mode, no design-token/CSS-variable system anywhere** — every color is a hardcoded literal scattered across multiple stylesheets. If VLab wants long-term maintainability (and dark mode, which the current Tinkercad-esque theme may eventually want), don't replicate this — use tokens.

---

## What I could not observe

- **No computed/rendered visual inspection** (no screenshots were taken — this analysis is from raw HTML/CSS source, not a browser rendering pass). Actual rendered spacing, exact font rendering, responsive breakpoint behavior in practice, hover/focus micro-interactions, and real accessibility contrast ratios were not verified visually. **Recommend a follow-up visual screenshot pass** (e.g. via a headless browser) before finalizing any pixel-level decisions — particularly to confirm how the CE lab's bespoke layout actually renders, and to check real color contrast ratios against WCAG AA (several of the blues/grays here look borderline and should be measured, not assumed).
- **The homepage's `Virtual Labs.png` logo and `circuit-board.svg` background image** were referenced but not visually rendered in this pass — described from filename/usage context only, not pixel content.
- **Feedback page content** (per-experiment "Feedback" tab) was not fetched — likely a form, not confirmed.
- Whether other departments/labs beyond these three EEE labs exist under the same GitHub org was not explored — out of scope (task specifies this one department's site).
