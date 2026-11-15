# FalseAlarm v3 demo script (60 seconds)

Before the demo, load `dist/` as an unpacked extension and configure either a
Direct Gemini key (with optional Grok key) or the local proxy. The live agent
needs one of those paths; it intentionally does not guess without credentials.

1. **Pitch (5 seconds).** Open the FalseAlarm side panel: "Ask FalseAlarm a
   question and it searches, opens, reads, and cites real sources."
2. **Brain myth (15 seconds).** Ask: `Do humans only use 10% of their brain?`
   Show the trace progressing through Planned, Searched, Opened, and Verified.
   Show the **Contradicted** badge and the verbatim Wikipedia quote.
3. **Great Wall (15 seconds).** Ask: `Is the Great Wall of China visible from
   space?` Show the contradicted result and use **Open in background** on the
   source without disrupting the side panel.
4. **Page context (10 seconds).** Open `dist/demo-test-page.html`, select
   **Ask about this page**, and point out that the active title and URL are
   included as context.
5. **Scan (10 seconds).** Use the toolbar popup to scan the demo page. Show
   the three factual claims and the unflagged opinion/joke sentence. Click a
   highlighted result, then close its Shadow DOM card with **Esc**.
6. **Trust rule (5 seconds).** Close with: "No source found means
   insufficient evidence, never false. Verify the linked sources before
   sharing."

For a no-key fallback demo, leave both Direct-mode keys empty. Scan mode still
recognizes the three built-in example claims; agent mode clearly explains that
keys or a proxy are needed.
