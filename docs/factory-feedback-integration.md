# Factory Droid feedback integration

The current five-step player finishes an attempt when all active ending targets
are reached with fresh tracking. Its local evaluator supplies measured issues,
and its descriptive formatter names the affected hand or foot. Factory is installed
and integrated as optional wording in `scripts/factory-practice-feedback.mjs`.
Local feedback appears immediately and remains available if Factory fails.

## Data flow

After the local review, the browser sends one background request to
`POST /api/practice-feedback` on the existing loopback server in
`scripts/serve-dual-view.mjs`. Supported measured issues and tracking/reference/
completion/timing limitations can invoke AI, including an overall unclear review
that contains a valid measured correction for a different limb. Successful
reviews without wording issues keep a full-sentence local message. A valid applied response
is labeled **AI wording** in the centered practice feedback.
Send the attempt and step IDs and grounded issue codes; the server derives the
affected limb names. A moving limb whose timing was explicitly not assessed adds
a `timing_unknown` wording annotation, without adding an issue to the grader.
The request retains a bounded compact evidence summary even though the displayed
and spoken feedback uses full sentences. A long wait for another limb is not
itself evidence that an already completed limb moved slowly.

Ask Droid to consolidate those issues or limitations into conversational main ideas. Local code continues
to control triangle completion, pass/retry status, progression and hardware
signals. Retain local text if the service is unavailable or its response is
invalid. Cancel or discard an old request when the learner retries or changes
steps. Camera frames are not needed for this text-generation request.

## Setup

Factory documents the CLI and TypeScript SDK installation as:

```powershell
npm install -g droid
npm install @factory/droid-sdk
```

The Node APIs are imported from `@factory/droid-sdk/node` and require Node 18 or
later. Installed versions are CLI `0.244.0` (Node 20+) and SDK `0.9.1`.
The current TypeScript SDK requires `FACTORY_API_KEY`; browser login alone does
not supply it. Configure it in the server environment or in the repository-root
`.env.factory.local`, which the existing `.env*` rule excludes from Git. The
server loads this file at startup only when the environment lacks the key.
Keep the key out of browser files, URLs, diagnostics and Git. On Windows, the
service resolves npm's native `droid.exe` explicitly because Node cannot directly
launch the `droid.cmd` shortcut. Set `FACTORY_FEEDBACK_ENABLED=0` to keep local
feedback without Factory calls.

## Server sketch

This example illustrates the adapter. The executed implementation lives in
`scripts/factory-practice-feedback.mjs`; it also bounds request size, rate,
concurrency and duration, validates origins, and checks every structured phrase
against the corresponding measured issue.
Provide an isolated working directory and validate the result before displaying
it. Request an output schema and disable all discovered tools for this wording
task; disabling only shell execution does not disable other agent tools.
In CLI 0.244.0, the built-in `ToolSearch` schema catalog remains available even
when included in `disabledToolIds`. The actual adapter allows only that exact
catalog exception, verifies every other tool is disabled, and rejects a run that
emits any tool event or requests permission. The isolated directory and empty
MCP configuration give the wording request no application files or external
tool integrations. The sketch below omits those additional production checks.

```ts
import {
  AutonomyLevel, createSession, DroidMessageType,
  OutputFormatType, ToolConfirmationOutcome,
} from '@factory/droid-sdk/node';

async function explainIssues(measuredReview, isolatedFeedbackDirectory) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  let session;
  try {
    session = await createSession({
      cwd: isolatedFeedbackDirectory,
      autonomyLevel: AutonomyLevel.Off,
      permissionHandler: () => ToolConfirmationOutcome.Cancel,
      abortSignal: controller.signal,
      systemPrompt:
        'Rewrite only the supplied measured movement errors. Name the affected ' +
        'hand or foot. Use one brief statement per affected limb. Do not add ' +
        'errors or change the outcome. Uncertain evidence stays uncertain.',
    });
    const tools = await session.listTools();
    await session.updateSettings({ disabledToolIds: tools.map(tool => tool.id) });
    for await (const item of session.stream(JSON.stringify(measuredReview), {
      abortSignal: controller.signal,
      outputFormat: {
        type: OutputFormatType.JsonSchema,
        schema: {
          type: 'object',
          properties: {
            messages: {
              type: 'array', minItems: 1, maxItems: 4,
              items: { type: 'string', maxLength: 100 },
            },
          },
          required: ['messages'], additionalProperties: false,
        },
      },
    })) {
      if (item.type === DroidMessageType.Result && item.success) {
        return item.structuredOutput; // Validate at runtime before using it.
      }
    }
    return null;
  } catch {
    return null; // The caller keeps the existing local feedback.
  } finally {
    clearTimeout(timeout);
    if (session) {
      try { await session.close(); } catch { /* Keep local feedback available. */ }
    }
  }
}
```

The caller must validate the message count/length and ensure wording refers only
to the supplied issues and limbs. Treat structured output as untrusted input;
show it with `textContent`. Display the local feedback immediately, and retain
it if Factory times out, fails, or introduces unsupported claims.

Factory now chooses complete, approved sentences for each measured issue. Each
sentence names the affected hand or foot, explains the observed error and gives
a specific correction, such as slowing that hand to follow the teacher's pace.
The server still rejects wrong sides, contradictory findings, omitted issues and
invented advice. Responses contain at most six anatomical/general paragraphs,
600 characters per paragraph and 200 words in total. Request summaries keep their
original smaller limits. Descriptive speech gets a word-count-based watchdog
of 18–120 seconds so a valid longer message is not cut off at the old 18-second
limit. Short local feedback keeps that original speech limit.

The centered feedback has no Retry or Next buttons and uses the landing page's
paper and ink style. For supported errors or uncertainty, it immediately speaks a short neutral
lead-in while requesting the wording in parallel. The selected local or AI
message starts when both the lead-in and the bounded 12-second request finish;
an early response does not interrupt the lead-in. Successful feedback advances after the
utterance ends without an added delay; mismatch or unknown retries the current
clip immediately after speech. If speech is off, unavailable, fails or times
out, ordinary feedback keeps its three-second reading pause, while descriptive
text gets a word-count reading pause bounded to 3–30 seconds. Pausing cancels
the old completion callback; resuming
reads the current text again without starting another Factory request. Starting
squares and self-paced triangle completion still use the existing local rules.

Unclear tracking is now eligible for Factory wording instead of bypassing AI.
For example, an uncertain right foot can receive: "I could not reliably assess
your right foot because its tracking was unclear. Keep it visible from start to
finish and try again." This remains an unknown result and retries the same step.
An unavailable timing measurement says that speed was not assessed; it never
turns into an invented fast/slow diagnosis or attributes the limitation to the
camera when the cause is unknown. Full-sentence local wording is also used when
Factory is unavailable, rate-limited, canceled or timed out. Dense local feedback
consolidates factual clauses and corrections within the same history budget.

## Responsive preparation and final session summary

While the learner watches a clip or returns to its starting squares, the browser
sends `POST /api/practice-feedback/warmup` with `{}`. This prepares a fresh,
isolated Droid session and disables its data/action tools. Preparation does not
call a model. The next feedback or summary consumes that session once; it is
closed afterward, so a later attempt cannot inherit an earlier prompt history.
Unused preparation expires after five minutes and server shutdown closes it.
SDK loading and executable discovery are also cached. Preparation happens in
the background and cannot affect tracking or completion.

Every selected review is retained in the browser's session journal with a stable
attempt ID, step ID, local result, actual issue codes and displayed/spoken
messages. A pause/resume does not duplicate the review. Successful retries do
not overwrite earlier corrections. No frames, landmarks or recordings enter
this journal or its AI requests. Practice again clears it for a new session.

After the final step, the camera stops and a short spoken introduction runs in
parallel with `POST /api/practice-summary`. The request includes the complete
attempt journal and the final matched/manual step results. The summary considers
earlier retries, per-limb corrections and unclear tracking/timing, while keeping
manual navigation separate from an observed match. It appears and speaks in the
same centered paper-and-ink layout, then remains readable without restarting the
lesson. The previous completion notice is hidden while this summary is shown.

The summary request has a 25-second browser limit, a separate server budget of
three summaries per minute and the same one-request concurrency limit. It may
follow a final step immediately without hitting the step-feedback spacing rule.
Responses are checked against sentences derived from the recorded evidence,
bounded to six paragraphs and 350 words. A later match proves target completion;
it does not by itself prove that an earlier timing issue was resolved. Failures
retain a grounded local summary. Requests over 200 attempts or 96 KiB stay local
instead of silently omitting earlier attempts. Navigation, stop and a new lesson
cancel obsolete summary requests and speech.
The journal retains typed timing limitations, so switching to full sentences
cannot hide them from the final summary. Measured issues in a mixed unclear
review are summarized while its uncertain observations remain separate.

## Conversational coaching and practice priorities

`public/practice-feedback-context.js` derives a small presentation annotation
from the actual teacher guide and accepted local learner samples. Both hands
moving too slowly on the way up share one coaching idea. A measured right-hand
beam deviation can say "sideways instead of upward" only when several trusted,
contiguous samples support that excursion. An off-guide code alone cannot tell
the direction. Mirrored horizontal directions are described as sideways.

The optional `practice-feedback-context-v1` object contains only bounded limb
indices, expected/observed directions and a supported practice focus. Raw frames,
coordinates and samples stay on this device. It is sanitized by the browser and
server and retained alongside the original issues in the complete journal.
It has no authority over status, target completion, tempo rules or Arduino output.

The final review has three conversational sections: **The takeaway**,
**Practice priorities**, and **Next time**. It draws a useful plan from the
history rather than reading the numeric ledger aloud. Measured hold drift in a
step with another moving body part can support practicing steady feet with moving
hands. Reliable incomplete hand travel can support completing a comfortably
larger path. Slow hands alone do not prove limited range, and unclear tracking
does not establish fear, low confidence or poor coordination. A later target
match does not establish that an earlier timing error was fixed. Tracking,
reference, incomplete-attempt and timing limitations retain their own causes.

Four larger serif numbers show steps reached, reviewed attempts, repeat attempts
and unassessed attempts. These values are computed locally from the journal,
never generated by Factory. Headings and statistics use the landing page's local
Instrument Serif/Manrope fonts and paper/ink palette. Model paragraphs render as
plain text, without HTML or Markdown interpretation. The feedback region has no
buttons, and the existing speech-end retry/advance remains unchanged.

Factory selects complete, evidence-derived paragraph alternatives through a
strict output schema. Unsupported claims fall back to the conversational local
formatter. Pattern-specific advice is intentionally grounded in measured
evidence, rather than unrestricted generated diagnoses.

Software checks: `check-feedback-context.mjs`, `check-conversational-factory.mjs`
and `check-conversational-coaching.mjs`, plus the existing feedback, journal,
speech and summary suites. `node scripts/check-conversational-factory-live.mjs`
explicitly consumes two paid Factory calls with labelled software issues to
verify contextual hand coaching and a coordination-focused final recap; it does
not access a person, camera or USB device.

## Official references

- [TypeScript SDK, authentication, sessions and cancellation](https://docs.factory.com/sdk/typescript)
- [Factory CLI installation](https://github.com/Factory-AI/factory#installation)
- [SDK tool controls](https://github.com/Factory-AI/droid-sdk-typescript/blob/main/examples/node/tool-controls.ts)
- [Structured output example](https://github.com/Factory-AI/droid-sdk-typescript/blob/main/examples/node/structured-output.ts)

Deterministic checks: `node scripts/check-factory-feedback.mjs`.
The separate `node scripts/check-factory-feedback-live.mjs` diagnostic consumes
Factory usage for a labeled software example and never opens a webcam or USB.
Add `--unclear` to verify one real unknown-right-foot response instead of the
default two-hand mismatch example.
`node scripts/check-factory-summary-live.mjs` makes three small paid model calls
with labeled software history to compare cold/prepared response time and verify
the final summary. Ordinary checks in `scripts/check-session-summary.mjs`,
`scripts/check-responsive-feedback.mjs` and `scripts/check-factory-session-summary.mjs`
use software fixtures and consume no Factory usage.
`scripts/check-descriptive-feedback.mjs` and
`scripts/check-uncertainty-feedback-service.mjs` cover full-sentence uncertainty
fallbacks and Factory wording without changing the grader or using real devices.

Checked against the installed SDK and official documentation on 2026-10-18.
