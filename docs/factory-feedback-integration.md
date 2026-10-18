# Factory Droid feedback integration

The current five-step player finishes an attempt when all active ending targets
are reached with fresh tracking. Its local evaluator supplies measured issues,
and its compact formatter names the affected hand or foot. Factory is not yet
installed or connected. The following is an optional server integration plan.

## Data flow

After the local review, send one request to a Node endpoint such as
`POST /api/practice-feedback`. For this static player, add the endpoint to the
existing loopback server in `scripts/serve-dual-view.mjs` when implementing it.
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

The Node APIs are imported from `@factory/droid-sdk/node`, require Node 18 or
later, and start the `droid` executable from PATH. Configure `FACTORY_API_KEY`
only in the server environment or authenticate the local CLI as supported by
Factory. Keep the key out of browser files, URLs and Git.

## Server sketch

This example is a proposed adapter, not an installed or executed integration.
Provide an isolated working directory and validate the result before displaying
it. Request an output schema and disable all discovered tools for this wording
task; disabling only shell execution does not disable other agent tools.

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

## Official references

- [TypeScript SDK, authentication, sessions and cancellation](https://docs.factory.com/sdk/typescript)
- [Factory CLI installation](https://github.com/Factory-AI/factory#installation)
- [SDK tool controls](https://github.com/Factory-AI/droid-sdk-typescript/blob/main/examples/node/tool-controls.ts)
- [Structured output example](https://github.com/Factory-AI/droid-sdk-typescript/blob/main/examples/node/structured-output.ts)

Checked against the official documentation on 2026-10-17.
