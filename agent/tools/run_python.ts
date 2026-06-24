import { defineTool } from "eve/tools";
import { z } from "zod";

// Executes model-authored Python INSIDE the sandbox (Docker container),
// never in the host Node process. This is the isolation boundary: the host's
// process.env, filesystem, and network are unreachable from this code.
//
// The agent uses this to (1) generate a synthetic dataset, then
// (2) analyze it — each call is a durable step in the Postgres event log.
export default defineTool({
  description:
    "Execute a Python 3 program inside the isolated sandbox and return its " +
    "stdout, stderr, and exit code. Use this for ALL computation: generating " +
    "data, reading files under /workspace, and computing statistics. Never " +
    "compute or guess numbers yourself — always run code here. Files written " +
    "to /workspace persist across calls within the same session.",
  inputSchema: z.object({
    code: z.string().min(1).describe("Python 3 source to execute."),
    filename: z
      .string()
      .default("program.py")
      .describe("Path under /workspace to write the code to before running."),
  }),
  outputSchema: z.object({
    stdout: z.string(),
    stderr: z.string(),
    exitCode: z.number(),
  }),
  async execute({ code, filename }, ctx) {
    const sandbox = await ctx.getSandbox();
    await sandbox.writeTextFile({ path: filename, content: code });
    const result = await sandbox.run({
      command: `python3 ${sandbox.resolvePath(filename)}`,
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  },
});
