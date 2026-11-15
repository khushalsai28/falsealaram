# FalseAlarm — Website

All of the website's text lives in this file. Edit the text under any `###` heading, save, and refresh the page.

## How editing works

- Each `### some.key` heading is a slot on the page. **Only change the text under the heading, never the heading itself.**
- Text formatting you can use:
  - `**bold**` makes text bold
  - `*accent*` colors text in the section's accent color (used in headlines)
  - `{red:text}` / `{orange:text}` adds a wavy red or orange underline
  - `[link text](https://example.com)` makes a link
- Anything under a `##` heading (like this section) is notes for you and does **not** appear on the site.

## Preview on your computer

Browsers block a page from reading files when you double-click `index.html`, so preview it with a tiny local server:

- **VS Code:** install the *Live Server* extension, right-click `index.html` → **Open with Live Server**.
- **Or Python:** open a terminal in this folder, run `python -m http.server 8000`, then visit http://localhost:8000

## Publish

- **Netlify (easiest):** go to https://app.netlify.com/drop and drag this whole folder onto the page. You get a live link right away. To update, drag the folder again.
- **GitHub Pages:** create a new public repo, upload every file in this folder (including the hidden `.nojekyll` file), then go to **Settings → Pages → Build and deployment**, choose **Deploy from a branch**, pick `main` and `/ (root)`, and save. Your site appears at `https://<your-username>.github.io/<repo-name>/` after a minute or two.

## Files

- `README.md` — all the text (this file)
- `index.html` — page structure
- `styles.css` — colors, fonts and layout
- `script.js` — loads the text from this file and runs the Before/After switch
- `.nojekyll` — tells GitHub Pages to serve this README as-is

---

## Page text

### site.title
FalseAlarm: catch misinformation as you browse

### brand.name
FalseAlarm

### links.chrome_store
#

### nav.how
How it works

### nav.features
Features

### nav.demo
See it in action

### nav.cta
Add to Chrome

### hero.badge
Free Chrome extension

### hero.headline
Catch the fake.

### hero.headline_accent
Keep the facts.

### hero.subheadline
FalseAlarm flags misleading claims as you browse and shows you what peer-reviewed science actually says, right on the page.

### hero.cta
Add to Chrome - It's Free

### hero.secondary
See it in action

### hero.note
Works on news sites, social media and blogs.

### hero.mock.url
dailyhealthbuzz.example/hand-health

### hero.mock.meta
Health · 4 min read

### hero.mock.title
Doctors warn: that annoying habit could ruin your hands

### hero.mock.before
We all know someone who does it. But experts say

### hero.mock.claim
cracking your knuckles causes arthritis

### hero.mock.after
later in life, so it might be time to stop.

### hero.card.verdict
Contradicted

### hero.card.text
Studies comparing long-time knuckle-crackers with people who don't crack their knuckles found no higher rate of hand arthritis.

### hero.card.footer
Backed by peer-reviewed studies · View sources

### hero.annotation
Click any underline for the truth!

### how.kicker
Behind the scenes

### how.title
How it works

### how.intro
Four steps happen in seconds while you read. You just see the result.

### how.step1.title
Scan the page

### how.step1.text
FalseAlarm reads the article itself, skipping ads and clutter, and uses Gemini AI to pick out bold factual claims. Opinions and jokes are left alone.

### how.step2.title
Check the science

### how.step2.text
It searches academic databases like Google Scholar and Semantic Scholar for the top peer-reviewed research on each claim.

### how.step3.title
AI cross-examination

### how.step3.text
A second AI, Grok, compares the claim with what the studies actually found and gives a clear verdict.

### how.verdict.supported
Supported

### how.verdict.partial
Partially Supported

### how.verdict.contradicted
Contradicted

### how.step4.title
Click for the truth

### how.step4.text
Misleading claims get a subtle {red:red} or {orange:orange} underline. Click one to open a card with a plain-English explanation and links to the original studies.

### features.kicker
Why you can trust it

### features.title
Built to be *honest*

### features.1.title
No hallucinated sources

### features.1.text
Only cites real academic papers it actually retrieved. It never makes up links.

### features.2.title
Privacy first

### features.2.text
Never scans sensitive pages like banking, email or password screens, or anything in Incognito tabs.

### features.3.title
Non-intrusive design

### features.3.text
Subtle underlines that never break the layout of the site you're reading.

### features.4.title
Multi-AI verification

### features.4.text
Two separate AI models, Gemini and Grok, cross-check every claim against real research data.

### demo.kicker
Try flipping the switch

### demo.title
See it in action

### demo.intro
The same article, without FalseAlarm and with it.

### demo.button.before
Before

### demo.button.after
After

### demo.article.url
dailyhealthbuzz.example/vaccine-report

### demo.article.meta
Example article · Health

### demo.article.title
Shocking report: what parents aren't being told about childhood shots

### demo.article.before
A report spreading fast on social media is raising alarms among parents. According to the post,

### demo.article.claim
the MMR vaccine is directly linked to autism in young children

### demo.article.after
, and families are being urged to rethink their child's schedule.

### demo.beforenote.title
Looks convincing, right?

### demo.beforenote.text
Without a fact check, a bold claim like this reads just like real news. Flip to **After** to see what FalseAlarm finds.

### demo.card.verdict
Verdict: Contradicted

### demo.card.claim
"The MMR vaccine is directly linked to autism in young children."

### demo.card.research_label
What the research says

### demo.card.research
Large studies following hundreds of thousands of children have found no link between the MMR vaccine and autism. Vaccinated and unvaccinated children were diagnosed with autism at the same rates.

### demo.card.sources_label
Sources

### demo.source1.title
Measles, Mumps, Rubella Vaccination and Autism: A Nationwide Cohort Study

### demo.source1.journal
Annals of Internal Medicine · 2019

### demo.source1.url
https://doi.org/10.7326/M18-2101

### demo.source2.title
Vaccines are not associated with autism: an evidence-based meta-analysis

### demo.source2.journal
Vaccine · 2014

### demo.source2.url
https://doi.org/10.1016/j.vaccine.2014.04.085

### demo.source3.title
A Population-Based Study of Measles, Mumps, and Rubella Vaccination and Autism

### demo.source3.journal
New England Journal of Medicine · 2002

### demo.source3.url
https://doi.org/10.1056/NEJMoa021134

### cta.title
Read the internet with a *fact-checker* on your side

### cta.button
Add to Chrome - It's Free

### footer.disclaimer_label
Disclaimer:

### footer.disclaimer
FalseAlarm is an AI-assisted tool. AI can make mistakes, and scientific understanding changes over time. Always check the original sources, and talk to a qualified professional before making important health, legal or financial decisions.

### footer.link.how
How it works

### footer.link.features
Features

### footer.link.privacy
Privacy policy

### footer.link.contact
Contact

### footer.copyright
© 2026 FalseAlarm
