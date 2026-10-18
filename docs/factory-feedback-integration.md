# Factory Droid feedback integration

The current five-step player finishes an attempt when all active ending targets
are reached with fresh tracking. Its local evaluator supplies measured issues,
and its compact formatter names the affected hand or foot. Factory is installed
and integrated as optional wording in `scripts/factory-practice-feedback.mjs`.
Local feedback appears immediately and remains available if Factory fails.

## Data flow

After the local review, the browser sends one background request to
`POST /api/practice-feedback` on the existing loopback server in
`scripts/serve-dual-view.mjs`. Only supported measured mismatch issues invoke AI.
Matched and uncertain attempts keep the local wording. A valid applied response
is labeled **AI wording** in the centered practice feedback.
Send the attempt and step IDs, actual issue codes and affected limb names, plus
supported per-limb timing/position metrics. A long wait for another limb is not
itself evidence that an already completed limb moved slowly.

Ask Droid to rewrite only those issues into brief feedback. Local code continues
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

The centered feedback uses the landing page's paper and ink style. For supported
errors, the controller waits at most 12 seconds for final wording, then speaks
the selected local or AI message once. Successful feedback advances after the
utterance ends; mismatch or unknown retries the current clip. If speech is off,
unavailable, fails or times out, a three-second reading pause keeps automatic
continuation available. Pausing cancels the old completion callback; resuming
reads the current text again without starting another Factory request. Starting
squares and self-paced triangle completion still use the existing local rules.

## Official references

- [TypeScript SDK, authentication, sessions and cancellation](https://docs.factory.com/sdk/typescript)
- [Factory CLI installation](https://github.com/Factory-AI/factory#installation)
- [SDK tool controls](https://github.com/Factory-AI/droid-sdk-typescript/blob/main/examples/node/tool-controls.ts)
- [Structured output example](https://github.com/Factory-AI/droid-sdk-typescript/blob/main/examples/node/structured-output.ts)

Deterministic checks: `node scripts/check-factory-feedback.mjs`.
The separate `node scripts/check-factory-feedback-live.mjs` diagnostic consumes
Factory usage for a labeled software example and never opens a webcam or USB.

Checked against the installed SDK and official documentation on 2026-10-18.
