import { defineEval } from "eve/evals";

export default defineEval({
  description: "Looks up a known movie through the sandboxed Python tool.",
  tags: ["live", "smoke"],
  async test(t) {
    await t.send(
      "What year was Inception, and who directed it? Use run_python and cite the dataset result.",
    );

    t.succeeded();
    t.calledTool("run_python");
    t.noFailedActions();
    t.messageIncludes("2010");
    t.messageIncludes(/Christopher Nolan/i);
  },
});
