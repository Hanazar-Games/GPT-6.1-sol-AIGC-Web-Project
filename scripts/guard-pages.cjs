// A branch-based Pages configuration may launch a second, unbuilt publication.
// Cancel only that generated workflow for this exact commit, never custom CI.
module.exports = async function guardPages({ github, context, core }) {
  const runs = await github.paginate(
    github.rest.actions.listWorkflowRunsForRepo,
    {
      ...context.repo,
      head_sha: context.sha,
      per_page: 100,
    },
  );
  for (const run of runs) {
    if (
      run.path !== "dynamic/pages/pages-build-deployment" ||
      run.head_sha !== context.sha ||
      run.status === "completed" ||
      run.id === context.runId
    )
      continue;
    try {
      await github.rest.actions.cancelWorkflowRun({
        ...context.repo,
        run_id: run.id,
      });
      core.info(`Cancelled competing legacy Pages run ${run.id}`);
    } catch (error) {
      // It may have finished between listing and cancellation. Other API failures
      // must remain visible instead of pretending the deployment is protected.
      if (error.status !== 409) throw error;
      const { data: latest } = await github.rest.actions.getWorkflowRun({
        ...context.repo,
        run_id: run.id,
      });
      if (latest.status !== "completed") throw error;
    }
  }
};
