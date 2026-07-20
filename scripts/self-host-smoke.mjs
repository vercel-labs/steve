import assert from "node:assert/strict";
import { Client } from "eve/client";

const host = (process.env.SELF_HOST_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const username = process.env.ROUTE_AUTH_BASIC_USER?.trim();
const password = process.env.ROUTE_AUTH_BASIC_PASSWORD;
const target = new URL(host);
const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(target.hostname);

assert.equal(
  Boolean(username),
  Boolean(password),
  "Set both ROUTE_AUTH_BASIC_USER and ROUTE_AUTH_BASIC_PASSWORD, or neither for localhost.",
);

const auth = username && password ? { basic: { username, password } } : undefined;
assert.ok(
  !auth || target.protocol === "https:" || isLoopback,
  "Refusing to send Basic credentials over non-loopback HTTP.",
);
const headers = target.protocol === "http:" && isLoopback ? { "x-forwarded-proto": "https" } : undefined;

if (process.env.SELF_HOST_EXPECT_AUTH === "1") {
  const response = await fetch(`${host}/eve/v1/info`, { headers, redirect: "manual" });
  assert.equal(response.status, 401, "Unauthenticated production access must return 401.");
}

const client = new Client({
  host,
  auth,
  headers,
  redirect: "error",
  preserveCompletedSessions: true,
});
const health = await client.health();
assert.equal(health.status, "ready");

const info = await client.info();
assert.equal(info.agent.name, "steve");

const session = client.session();
const first = await (
  await session.send(
    "What year was Inception, and who directed it? Use run_python and cite the dataset result.",
  )
).result();

assert.notEqual(first.status, "failed", "The movie lookup turn failed.");
const firstToolOutput = completedToolOutput(first.events, "run_python");
assert.equal(firstToolOutput.exitCode, 0);
assert.match(firstToolOutput.stdout, /2010/);
assert.match(firstToolOutput.stdout, /Christopher Nolan/i);
assert.match(first.message ?? "", /2010/);
assert.match(first.message ?? "", /Christopher Nolan/i);

const second = await (
  await session.send("What rating does that same dataset give it? Use run_python again.")
).result();

assert.notEqual(second.status, "failed", "The follow-up turn failed.");
assert.equal(second.sessionId, first.sessionId, "The follow-up started a new durable session.");
const secondToolOutput = completedToolOutput(second.events, "run_python");
assert.equal(secondToolOutput.exitCode, 0);
assert.match(secondToolOutput.stdout, /8\.8/);
assert.match(second.message ?? "", /8\.8/);

const cancellationVerified =
  process.env.SELF_HOST_SKIP_CANCELLATION === "1" ? false : await verifyCancellation(client);
const outputLimitVerified =
  process.env.SELF_HOST_SKIP_OUTPUT_LIMIT === "1" ? false : await verifyOutputLimit(client);

console.log(
  JSON.stringify(
    {
      agent: info.agent.name,
      health: health.status,
      model: info.agent.model.id,
      sessionId: first.sessionId,
      turns: 2 + Number(cancellationVerified) + Number(outputLimitVerified),
      cancellationVerified,
      outputLimitVerified,
    },
    null,
    2,
  ),
);

function completedToolOutput(events, toolName) {
  for (const event of events) {
    if (
      event.type === "action.result" &&
      event.data.status === "completed" &&
      event.data.result.kind === "tool-result" &&
      event.data.result.toolName === toolName
    ) {
      return event.data.result.output;
    }
  }
  throw new Error(`${toolName} did not return a completed action result.`);
}

async function verifyCancellation(eveClient) {
  const startedAt = Date.now();
  const session = eveClient.session();
  const response = await session.send({
    message: "Use run_python to execute `import time; time.sleep(60); print('finished')` now.",
    signal: AbortSignal.timeout(90_000),
  });
  const events = [];
  let cancellationStatus;

  for await (const event of response) {
    events.push(event);
    if (!cancellationStatus && event.type === "actions.requested") {
      if (JSON.stringify(event).includes('"toolName":"run_python"')) {
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        cancellationStatus = (await session.cancel()).status;
      }
    }
  }

  assert.equal(cancellationStatus, "accepted", "The active Python turn did not accept cancellation.");
  assert.ok(events.some((event) => event.type === "turn.cancelled"));
  assert.ok(events.some((event) => event.type === "session.waiting"));
  assert.ok(Date.now() - startedAt < 30_000, "Cancellation waited for the 60-second process.");
  return true;
}

async function verifyOutputLimit(eveClient) {
  const session = eveClient.session();
  const result = await (
    await session.send(
      "Deployment verification: use run_python to execute `print('x' * 300000)` and report the tool's exit code.",
    )
  ).result();
  const output = completedToolOutput(result.events, "run_python");

  assert.equal(output.exitCode, 125);
  assert.match(output.stderr, /output exceeded 262144 bytes/i);
  return true;
}
