import { defineTool } from "eve/tools";
import { z } from "zod";

const PYTHON_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_BYTES = 256 * 1024;

// Executes model-authored Python INSIDE the sandbox (Docker container),
// never in the host Node process. This is the isolation boundary: the host's
// process.env, filesystem, and network are unreachable from this code.
export default defineTool({
  description:
    "Execute a Python 3 program inside the isolated sandbox and return its " +
    "stdout, stderr, and exit code. Use this for ALL computation: generating " +
    "data, reading files under /workspace, and computing statistics. Never " +
    "compute or guess numbers yourself — always run code here. Files written " +
    "to /workspace persist across calls within the same session. Programs have " +
    "a 15-second execution limit.",
  inputSchema: z.object({
    code: z.string().min(1).describe("Python 3 source to execute."),
  }),
  outputSchema: z.object({
    stdout: z.string(),
    stderr: z.string(),
    exitCode: z.number(),
  }),
  async execute({ code }, ctx) {
    const sandbox = await ctx.getSandbox();
    const timeoutSignal = AbortSignal.timeout(PYTHON_TIMEOUT_MS);
    const executionSignal = AbortSignal.any([ctx.abortSignal, timeoutSignal]);
    const callId = ctx.callId.replaceAll(/[^a-zA-Z0-9_-]/g, "_");
    const filename = `.eve/${callId}.py`;
    await sandbox.writeTextFile({
      path: filename,
      content: code,
      abortSignal: executionSignal,
    });
    const process = await sandbox.spawn({
      command:
        "sudo -u vercel-sandbox bash -lc " +
        `'ulimit -v 524288 -u 64 -f 10240 -n 64; exec python3 ${sandbox.resolvePath(filename)}'`,
      abortSignal: executionSignal,
    });
    const stopProcess = () => void process.kill();
    executionSignal.addEventListener("abort", stopProcess, { once: true });

    try {
      const outputBudget = { exceeded: false, remaining: MAX_OUTPUT_BYTES };
      const [stdoutResult, stderrResult, waitResult] = await Promise.allSettled([
        readTextWithLimit(process.stdout, outputBudget),
        readTextWithLimit(process.stderr, outputBudget),
        process.wait(),
      ]);

      if (outputBudget.exceeded) {
        return {
          stdout: settledValue(stdoutResult) ?? "",
          stderr: [
            settledValue(stderrResult) ?? "",
            `Python output exceeded ${MAX_OUTPUT_BYTES} bytes.`,
          ]
            .filter(Boolean)
            .join("\n"),
          exitCode: 125,
        };
      }

      const stdout = requiredSettledValue(stdoutResult);
      const stderr = requiredSettledValue(stderrResult);
      const result = requiredSettledValue(waitResult);
      return {
        stdout,
        stderr,
        exitCode: result.exitCode,
      };
    } catch (error) {
      if (timeoutSignal.aborted && !ctx.abortSignal.aborted) {
        return {
          stdout: "",
          stderr: `Python execution exceeded ${PYTHON_TIMEOUT_MS / 1000} seconds.`,
          exitCode: 124,
        };
      }
      throw error;
    } finally {
      executionSignal.removeEventListener("abort", stopProcess);
    }
  },
});

async function readTextWithLimit(
  stream: ReadableStream<Uint8Array>,
  budget: { exceeded: boolean; remaining: number },
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (budget.remaining > 0) {
        const accepted = Math.min(value.byteLength, budget.remaining);
        text += decoder.decode(value.subarray(0, accepted), { stream: true });
        budget.remaining -= accepted;
        if (accepted < value.byteLength) budget.exceeded = true;
      } else if (value.byteLength > 0) {
        budget.exceeded = true;
      }
    }
  } finally {
    reader.releaseLock();
  }

  return text + decoder.decode();
}

function settledValue<T>(result: PromiseSettledResult<T>): T | undefined {
  return result.status === "fulfilled" ? result.value : undefined;
}

function requiredSettledValue<T>(result: PromiseSettledResult<T>): T {
  if (result.status === "rejected") throw result.reason;
  return result.value;
}
