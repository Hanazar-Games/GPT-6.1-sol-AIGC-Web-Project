import test from "node:test";
import assert from "node:assert/strict";
import guardPages from "../scripts/guard-pages.cjs";
function fixture(
  runs,
  cancel = async () => {},
  get = async () => ({ data: { status: "completed" } }),
) {
  const cancelled = [],
    context = {
      repo: { owner: "owner", repo: "game" },
      sha: "current",
      runId: 10,
    };
  const github = {
    paginate: async () => runs,
    rest: {
      actions: {
        listWorkflowRunsForRepo() {},
        cancelWorkflowRun: async (args) => {
          cancelled.push(args.run_id);
          await cancel(args);
        },
        getWorkflowRun: get,
      },
    },
  };
  return { github, context, core: { info() {} }, cancelled };
}
test("publication guard cancels only active generated Pages runs for the same commit", async () => {
  const run = {
    id: 1,
    path: "dynamic/pages/pages-build-deployment",
    head_sha: "current",
    status: "queued",
  };
  const env = fixture([
    run,
    { ...run, id: 2, status: "completed" },
    { ...run, id: 3, head_sha: "older" },
    { ...run, id: 4, path: ".github/workflows/pages.yml" },
    { ...run, id: 10 },
  ]);
  await guardPages(env);
  assert.deepEqual(env.cancelled, [1]);
});
test("publication guard tolerates completion races and reports real permission failures", async () => {
  const run = {
    id: 1,
    path: "dynamic/pages/pages-build-deployment",
    head_sha: "current",
    status: "in_progress",
  };
  const conflict = Object.assign(new Error("already finished"), {
    status: 409,
  });
  await guardPages(
    fixture([run], async () => {
      throw conflict;
    }),
  );
  const denied = Object.assign(new Error("denied"), { status: 403 });
  await assert.rejects(
    guardPages(
      fixture([run], async () => {
        throw denied;
      }),
    ),
    /denied/,
  );
});
