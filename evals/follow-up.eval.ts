import { defineEval } from "eve/evals";
import { equals } from "eve/evals/expect";

export default defineEval({
  description: "Keeps the same durable session across a follow-up turn.",
  tags: ["live", "durability"],
  async test(t) {
    const first = await t.send("Use run_python to look up Inception in movies.csv.");
    first.calledTool("run_python");

    const second = await t.send("Use run_python again and tell me its dataset rating.");
    await t.require(second.sessionId, equals(first.sessionId));
    second.calledTool("run_python");
    second.messageIncludes("8.8");
    t.succeeded();
  },
});
