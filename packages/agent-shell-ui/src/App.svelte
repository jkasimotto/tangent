<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import {
    artifactUrl,
    createWorkApiClient,
    diffUrl,
    type AgentBinding,
    type AgentProvider,
    type GoalSummary,
    type ProgramView,
    type ReviewedRun,
    type SessionChoice,
    type StepDefinition,
    type StepState,
    type WorkApiClient
  } from "./client.js";

  export let client: WorkApiClient = createWorkApiClient();

  let section: "goals" | "programs" = "goals";
  let goals: GoalSummary[] = [];
  let runs: ReviewedRun[] = [];
  let selectedGoalPath = "";
  let selectedRunId = "";
  let runDetail: ReviewedRun | undefined;
  let latestOutput = "";
  let program: ProgramView | undefined;
  let draftBindings: Record<string, AgentBinding> = {};
  let draftSessions: Record<string, SessionChoice> = {};
  let setupOpen = false;
  let loading = true;
  let busy = false;
  let error = "";
  let notice = "";
  let decision = "";
  let pollTimer: ReturnType<typeof setInterval> | undefined;

  $: selectedGoal = goals.find((goal) => goal.path === selectedGoalPath);
  $: goalRuns = runs.filter((run) => run.goalPath === selectedGoalPath);
  $: visibleRun = runDetail?.id === selectedRunId ? runDetail : runs.find((run) => run.id === selectedRunId);

  onMount(() => {
    void loadInitial();
    pollTimer = setInterval(() => { void poll(); }, 1500);
  });

  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer);
  });

  /** Loads Goals, recent Runs, and the selected Area's Program defaults. */
  async function loadInitial(): Promise<void> {
    loading = true;
    try {
      const [goalList, runList] = await Promise.all([client.listGoals(), client.listRuns()]);
      goals = goalList.goals;
      runs = runList.runs;
      const active = runs.find((run) => run.status === "running" || run.status === "needs_attention" || run.status === "stopped");
      selectedGoalPath = active?.goalPath || goals.find((goal) => !["done", "dropped"].includes(goal.status))?.path || goals[0]?.path || "";
      selectedRunId = active?.id || runs.find((run) => run.goalPath === selectedGoalPath)?.id || "";
      const initialGoal = goals.find((goal) => goal.path === selectedGoalPath);
      await Promise.all([loadProgram(initialGoal?.areaPath), selectedRunId ? loadRun(selectedRunId) : Promise.resolve()]);
    } catch (caught) {
      error = message(caught);
    } finally {
      loading = false;
    }
  }

  /** Polls active Run state without moving the user's Goal selection. */
  async function poll(): Promise<void> {
    if (!selectedRunId) return;
    const current = runDetail?.id === selectedRunId ? runDetail : undefined;
    if (current?.status === "complete") return;
    try {
      const [{ run, latestOutput: output }, list] = await Promise.all([client.getRun(selectedRunId), client.listRuns()]);
      runDetail = run;
      latestOutput = output;
      runs = list.runs;
    } catch { /* A later manual refresh reports persistent errors. */ }
  }

  /** Selects a Goal and restores its newest Run. */
  async function selectGoal(goal: GoalSummary): Promise<void> {
    selectedGoalPath = goal.path;
    const recent = runs.find((run) => run.goalPath === goal.path);
    selectedRunId = recent?.id || "";
    runDetail = undefined;
    latestOutput = "";
    setupOpen = false;
    error = "";
    await Promise.all([loadProgram(goal.areaPath), recent ? loadRun(recent.id) : Promise.resolve()]);
  }

  /** Loads display defaults for the selected Area. */
  async function loadProgram(areaPath = selectedGoal?.areaPath): Promise<void> {
    const view = await client.getProgram(areaPath);
    program = view;
    draftBindings = clone(view.bindings);
    draftSessions = clone(view.sessions);
  }

  /** Selects and loads one durable Run. */
  async function loadRun(runId: string): Promise<void> {
    selectedRunId = runId;
    const detail = await client.getRun(runId);
    runDetail = detail.run;
    latestOutput = detail.latestOutput;
    decision = "";
  }

  /** Starts the common path with no required setup form. */
  async function startRun(): Promise<void> {
    if (!selectedGoal || !program || busy) return;
    busy = true;
    error = "";
    notice = "";
    try {
      const { run } = await client.startRun({
        goalPath: selectedGoal.path,
        bindings: draftBindings,
        sessions: draftSessions
      });
      runs = [run, ...runs.filter((item) => item.id !== run.id)];
      selectedRunId = run.id;
      runDetail = run;
      setupOpen = false;
      notice = "Reviewed build started. Tangent will stop only for a decision, an error, or completion.";
      await poll();
    } catch (caught) {
      error = message(caught);
    } finally {
      busy = false;
    }
  }

  /** Saves the visible choices as the Area's next-run defaults. */
  async function saveDefaults(): Promise<void> {
    if (!selectedGoal || busy) return;
    busy = true;
    error = "";
    try {
      await client.saveDefaults(selectedGoal.areaPath, { bindings: draftBindings, sessions: draftSessions });
      notice = `Saved Reviewed build defaults for ${selectedGoal.areaPath}.`;
      await loadProgram();
    } catch (caught) {
      error = message(caught);
    } finally {
      busy = false;
    }
  }

  /** Sends one stop, resume, or retry control to the durable Run. */
  async function control(action: "stop" | "resume" | "retry"): Promise<void> {
    if (!visibleRun || busy) return;
    busy = true;
    error = "";
    try {
      const response = await client.controlRun(visibleRun.id, { action, ...(decision.trim() ? { decision: decision.trim() } : {}) });
      runDetail = response.run;
      decision = "";
      await poll();
    } catch (caught) {
      error = message(caught);
    } finally {
      busy = false;
    }
  }

  /** Applies an edited agent or session choice to one pending Run step. */
  async function applyPendingStep(step: StepState): Promise<void> {
    if (!visibleRun || busy) return;
    busy = true;
    error = "";
    try {
      const response = await client.updateStep(visibleRun.id, step.id, { binding: step.binding, session: step.session });
      runDetail = response.run;
      notice = `${step.label} will use ${step.binding.label}.`;
    } catch (caught) {
      error = message(caught);
    } finally {
      busy = false;
    }
  }

  /** Replaces a launch-draft provider while retaining a useful visible label. */
  function setDraftProvider(stepId: string, provider: AgentProvider): void {
    const prior = draftBindings[stepId];
    draftBindings = {
      ...draftBindings,
      [stepId]: providerBinding(provider, prior)
    };
    const session = draftSessions[stepId];
    if (session?.mode === "continue" && !compatibleDraftSource(stepId, session.fromStepId)) {
      draftSessions = { ...draftSessions, [stepId]: { mode: "fresh" } };
    }
  }

  /** Replaces a pending Run provider. */
  function setRunProvider(step: StepState, provider: AgentProvider): void {
    step.binding = providerBinding(provider, step.binding);
    if (step.session.mode === "continue" && !compatibleRunSource(step, step.session.fromStepId)) step.session = { mode: "fresh" };
    runDetail = runDetail ? { ...runDetail, steps: [...runDetail.steps] } : runDetail;
  }

  /** Changes one launch-draft model. */
  function setDraftModel(stepId: string, model: string): void {
    draftBindings = { ...draftBindings, [stepId]: { ...draftBindings[stepId], model: model || undefined } };
  }

  /** Changes one launch-draft effort. */
  function setDraftEffort(stepId: string, effort: string): void {
    draftBindings = { ...draftBindings, [stepId]: { ...draftBindings[stepId], effort: effort || undefined } };
  }

  /** Changes one launch-draft session choice from a select value. */
  function setDraftSession(stepId: string, value: string): void {
    draftSessions = { ...draftSessions, [stepId]: sessionFromValue(value) };
  }

  /** Changes one pending Run session choice from a select value. */
  function setRunSession(step: StepState, value: string): void {
    step.session = sessionFromValue(value);
    runDetail = runDetail ? { ...runDetail, steps: [...runDetail.steps] } : runDetail;
  }

  /** Lists earlier compatible launch-draft sessions. */
  function draftContinuationSteps(step: StepDefinition): StepDefinition[] {
    if (!program) return [];
    return program.steps.filter((source) => source.order < step.order && compatibleDraftSource(step.id, source.id));
  }

  /** Tests one launch-draft continuation source. */
  function compatibleDraftSource(stepId: string, sourceId: string): boolean {
    return Boolean(draftBindings[stepId] && draftBindings[sourceId] && draftBindings[stepId].provider === draftBindings[sourceId].provider);
  }

  /** Lists earlier compatible sessions for a pending Run step. */
  function runContinuationSteps(step: StepState): StepState[] {
    return visibleRun?.steps.filter((source) => source.order < step.order && compatibleRunSource(step, source.id)) || [];
  }

  /** Tests one pending Run continuation source. */
  function compatibleRunSource(step: StepState, sourceId: string): boolean {
    const source = visibleRun?.steps.find((item) => item.id === sourceId);
    return Boolean(source && source.binding.provider === step.binding.provider);
  }

  /** Converts a select value into a durable session choice. */
  function sessionFromValue(value: string): SessionChoice {
    return value === "fresh" ? { mode: "fresh" } : { mode: "continue", fromStepId: value.replace(/^continue:/, "") };
  }

  /** Converts a session choice into a select value. */
  function sessionValue(session: SessionChoice): string {
    return session.mode === "fresh" ? "fresh" : `continue:${session.fromStepId}`;
  }

  /** Creates useful binding defaults when the provider changes. */
  function providerBinding(provider: AgentProvider, prior: AgentBinding): AgentBinding {
    if (provider === prior.provider) return prior;
    if (provider === "claude") return { id: "claude-custom", label: "Claude", provider, command: "claude", model: "fable", permissionMode: "bypassPermissions" };
    if (provider === "codex") return { id: "codex-custom", label: "Codex", provider, command: "codex", effort: "max" };
    return { id: "gemini-custom", label: "Gemini", provider, command: "gemini" };
  }

  /** Returns the latest attempt for one step. */
  function latestAttempt(step: StepState) {
    return step.attempts.at(-1);
  }

  /** Formats a compact relative Area label. */
  function areaLabel(area: string): string {
    return area || "Root";
  }

  /** Formats one durable status for display. */
  function statusLabel(status: string): string {
    return status.replaceAll("_", " ");
  }

  /** Formats a timestamp for the local browser locale. */
  function dateLabel(value: string): string {
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
  }

  /** Deep-clones API state before editing it as a draft. */
  function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  /** Formats an unknown caught value. */
  function message(value: unknown): string {
    return value instanceof Error ? value.message : String(value);
  }
</script>

<div class="work-app">
  <aside class="work-sidebar" aria-label="Work navigation">
    <div class="sidebar-brand">
      <span class="brand-mark" aria-hidden="true">T</span>
      <div><strong>Work</strong><span>Goals and durable runs</span></div>
    </div>

    <nav class="section-tabs" aria-label="Work sections">
      <button class:active={section === "goals"} on:click={() => section = "goals"}>Goals</button>
      <button class:active={section === "programs"} on:click={() => section = "programs"}>Programs</button>
    </nav>

    {#if section === "goals"}
      <div class="sidebar-heading"><span>Open work</span><span>{goals.filter((goal) => !["done", "dropped"].includes(goal.status)).length}</span></div>
      <div class="goal-list">
        {#each goals.filter((goal) => !["done", "dropped"].includes(goal.status)) as goal (goal.path)}
          <button class="goal-item" class:selected={goal.path === selectedGoalPath} on:click={() => void selectGoal(goal)}>
            <span class="goal-title">{goal.title}</span>
            <span class="goal-meta">{areaLabel(goal.areaPath)}{runs.some((run) => run.goalPath === goal.path && run.status === "running") ? " · running" : ""}</span>
          </button>
        {/each}
      </div>
    {:else}
      <div class="sidebar-heading"><span>Recent runs</span><span>{runs.length}</span></div>
      <div class="goal-list">
        {#each runs.slice(0, 12) as run (run.id)}
          <button class="goal-item" class:selected={run.id === selectedRunId} on:click={() => void loadRun(run.id)}>
            <span class="goal-title">{run.goalTitle}</span>
            <span class="goal-meta"><i class={`status-dot ${run.status}`}></i>{statusLabel(run.status)} · {dateLabel(run.createdAt)}</span>
          </button>
        {/each}
      </div>
    {/if}
  </aside>

  <main class="work-main">
    {#if loading}
      <div class="empty-state">Loading work…</div>
    {:else if error && !selectedGoal && !visibleRun}
      <div class="empty-state error-state">{error}</div>
    {:else if section === "programs"}
      <header class="page-header">
        <div><span class="eyebrow">Built-in program</span><h1>Reviewed build</h1></div>
        <span class="version-tag">v1 · 8 steps</span>
      </header>
      <section class="program-intro">
        <p>{program?.description || "A design-to-implementation sequence with independent reviews and one final fix pass."}</p>
        <div class="promise"><span aria-hidden="true">↳</span><p>Start once. Tangent returns with a decision, an error, or the finished implementation and proof.</p></div>
      </section>
      {#if program}
        <section class="step-editor always-open" aria-label="Reviewed build definition">
          {#each program.steps as step (step.id)}
            <div class="setup-step">
              <span class="step-number">{step.order}</span>
              <div class="setup-copy"><strong>{step.label}</strong><span>{draftBindings[step.id]?.label} · {draftBindings[step.id]?.model || "default model"} · {draftSessions[step.id]?.mode === "fresh" ? "fresh session" : "continued session"}</span></div>
            </div>
          {/each}
        </section>
      {/if}
      <section class="recent-grid">
        <h2>Recent runs</h2>
        {#if runs.length}
          {#each runs.slice(0, 6) as run (run.id)}
            <button class="recent-card" on:click={() => { section = "goals"; selectedGoalPath = run.goalPath; void loadRun(run.id); }}>
              <span class={`run-status ${run.status}`}>{statusLabel(run.status)}</span>
              <strong>{run.goalTitle}</strong>
              <span>{run.steps.filter((step) => step.status === "complete").length}/8 steps · {dateLabel(run.updatedAt)}</span>
            </button>
          {/each}
        {:else}<p class="muted">No Reviewed build has started yet.</p>{/if}
      </section>
    {:else if selectedGoal}
      <header class="page-header goal-header">
        <div>
          <span class="eyebrow">{areaLabel(selectedGoal.areaPath)}</span>
          <h1>{selectedGoal.title}</h1>
          {#if selectedGoal.doneWhen}<p class="done-when"><span>Done when</span>{selectedGoal.doneWhen}</p>{/if}
        </div>
        <span class={`goal-state ${selectedGoal.status}`}>{selectedGoal.status}</span>
      </header>

      {#if error}<div class="banner error-banner" role="alert">{error}<button aria-label="Dismiss error" on:click={() => error = ""}>×</button></div>{/if}
      {#if notice}<div class="banner notice-banner">{notice}<button aria-label="Dismiss notice" on:click={() => notice = ""}>×</button></div>{/if}

      {#if visibleRun}
        <section class="run-card" aria-label="Reviewed build run">
          <div class="run-card-header">
            <div>
              <span class="eyebrow">Reviewed build · {dateLabel(visibleRun.createdAt)}</span>
              <h2>{visibleRun.status === "complete" ? "Implementation complete" : visibleRun.status === "needs_attention" ? "Your attention is needed" : visibleRun.status === "stopped" ? "Run stopped" : "Agents are working"}</h2>
            </div>
            <span class={`run-status large ${visibleRun.status}`}><i class="status-dot"></i>{statusLabel(visibleRun.status)}</span>
          </div>

          {#if visibleRun.attention}
            <div class={`attention ${visibleRun.attention.kind}`}>
              <span class="attention-icon" aria-hidden="true">{visibleRun.attention.kind === "judgment" ? "?" : "!"}</span>
              <div>
                <strong>{visibleRun.attention.question || visibleRun.attention.message}</strong>
                {#if visibleRun.attention.question}<p>{visibleRun.attention.message}</p>{/if}
                {#if visibleRun.attention.kind === "judgment"}
                  <label>Decision<textarea bind:value={decision} rows="3" placeholder="Give the decision once; Tangent will return it to the responsible agent."></textarea></label>
                  <button class="primary small" disabled={!decision.trim() || busy} on:click={() => void control("resume")}>Answer and resume</button>
                {:else}
                  <button class="primary small" disabled={busy} on:click={() => void control("retry")}>Retry step</button>
                {/if}
              </div>
            </div>
          {/if}

          <div class="run-steps">
            {#each visibleRun.steps as step (step.id)}
              <div class:current={step.id === visibleRun.currentStepId} class:complete={step.status === "complete"} class="run-step">
                <div class="step-rail"><span>{step.status === "complete" ? "✓" : step.order}</span></div>
                <div class="step-body">
                  <div class="step-line">
                    <div><strong>{step.label}</strong><span>{step.binding.label}{step.binding.model ? ` · ${step.binding.model}` : ""} · {step.session.mode === "fresh" ? "fresh" : `continues ${step.session.fromStepId}`}</span></div>
                    <span class={`step-status ${step.status}`}>{statusLabel(step.status)}</span>
                  </div>

                  {#if step.id === visibleRun.currentStepId && (step.status === "running" || step.status === "stopped")}
                    <pre class="live-output" aria-label="Latest agent output">{latestOutput || "Waiting for agent output…"}</pre>
                  {/if}

                  {#if latestAttempt(step)?.artifacts.length}
                    <div class="artifact-row">
                      {#each latestAttempt(step)?.artifacts || [] as artifact, index}
                        <a href={artifactUrl(visibleRun.id, step.id, latestAttempt(step)!.number, index)} target="_blank" rel="noreferrer"><span>{artifact.purpose}</span>{artifact.path}</a>
                      {/each}
                    </div>
                  {/if}

                  {#if latestAttempt(step)?.proof.length}
                    <details class="proof"><summary>Proof · {latestAttempt(step)?.proof.length} checks</summary>
                      {#each latestAttempt(step)?.proof || [] as item}<div><code>{item.command}</code><span>{item.result}</span></div>{/each}
                    </details>
                  {/if}

                  {#if step.status === "pending"}
                    <details class="pending-editor">
                      <summary>Change agent or session</summary>
                      <div class="pending-fields">
                        <label>Agent<select value={step.binding.provider} on:change={(event) => setRunProvider(step, event.currentTarget.value as AgentProvider)}><option value="claude">Claude</option><option value="codex">Codex</option><option value="gemini">Gemini</option></select></label>
                        <label>Model<input value={step.binding.model || ""} on:input={(event) => { step.binding.model = event.currentTarget.value || undefined; }} placeholder="Provider default" /></label>
                        <label>Effort<input value={step.binding.effort || ""} on:input={(event) => { step.binding.effort = event.currentTarget.value || undefined; }} placeholder="default" /></label>
                        <label>Session<select value={sessionValue(step.session)} on:change={(event) => setRunSession(step, event.currentTarget.value)}><option value="fresh">Fresh session</option>{#each runContinuationSteps(step) as source}<option value={`continue:${source.id}`}>Continue step {source.order}</option>{/each}</select></label>
                        <button class="secondary small" disabled={busy} on:click={() => void applyPendingStep(step)}>Apply to this run</button>
                      </div>
                    </details>
                  {/if}
                </div>
              </div>
            {/each}
          </div>

          <footer class="run-actions">
            <div>
              <span>{visibleRun.repository.root}</span>
              <code>{visibleRun.repository.head.slice(0, 8)}</code>
            </div>
            <div>
              {#if visibleRun.status === "running" || visibleRun.status === "queued"}<button class="danger-quiet" disabled={busy} on:click={() => void control("stop")}>Stop</button>{/if}
              {#if visibleRun.status === "stopped"}<button class="primary" disabled={busy} on:click={() => void control("resume")}>Resume</button>{/if}
              {#if visibleRun.status === "complete"}<a class="primary link-button" href={diffUrl(visibleRun.id)} target="_blank" rel="noreferrer">Open final diff</a>{/if}
            </div>
          </footer>
        </section>

        {#if goalRuns.length > 1}
          <section class="run-history"><h2>Earlier runs</h2>{#each goalRuns.filter((run) => run.id !== visibleRun?.id) as run}<button on:click={() => void loadRun(run.id)}><span class={`run-status ${run.status}`}>{statusLabel(run.status)}</span><span>{dateLabel(run.createdAt)}</span></button>{/each}</section>
        {/if}
      {:else}
        <section class="launch-card">
          <div class="launch-mark" aria-hidden="true">↗</div>
          <div class="launch-copy">
            <span class="eyebrow">Durable program</span>
            <h2>Run reviewed build</h2>
            <p>One design agent, one independent reviewer, implementation, review, and one response-and-fix pass.</p>
            <div class="launch-actions">
              <button class="primary" disabled={busy || !program} on:click={() => void startRun()}>{busy ? "Starting…" : "Run reviewed build"}</button>
              <button class="detail-toggle" aria-expanded={setupOpen} on:click={() => setupOpen = !setupOpen}>{setupOpen ? "Hide steps" : "Review 8 steps"}<span aria-hidden="true">⌄</span></button>
            </div>
            <p class="authority">Starting authorizes repository documents, code changes, and checks. It does not authorize merge, deploy, publication, commits, or Goal completion.</p>
          </div>
        </section>

        {#if setupOpen && program}
          <section class="step-editor" aria-label="Reviewed build step choices">
            <div class="editor-header"><div><h2>Run choices</h2><p>Fresh sessions are the default. Change only the steps that need different capacity.</p></div><button class="secondary small" disabled={busy} on:click={() => void saveDefaults()}>Save as Area defaults</button></div>
            {#each program.steps as step (step.id)}
              <div class="setup-step editable">
                <span class="step-number">{step.order}</span>
                <div class="setup-copy"><strong>{step.label}</strong><span>{step.instruction}</span></div>
                <label>Agent<select value={draftBindings[step.id]?.provider} on:change={(event) => setDraftProvider(step.id, event.currentTarget.value as AgentProvider)}><option value="claude">Claude</option><option value="codex">Codex</option><option value="gemini">Gemini</option></select></label>
                <label>Model<input value={draftBindings[step.id]?.model || ""} on:input={(event) => setDraftModel(step.id, event.currentTarget.value)} placeholder="Provider default" /></label>
                <label>Effort<input value={draftBindings[step.id]?.effort || ""} on:input={(event) => setDraftEffort(step.id, event.currentTarget.value)} placeholder="default" /></label>
                <label>Session<select value={sessionValue(draftSessions[step.id] || { mode: "fresh" })} on:change={(event) => setDraftSession(step.id, event.currentTarget.value)}><option value="fresh">Fresh</option>{#each draftContinuationSteps(step) as source}<option value={`continue:${source.id}`}>Continue {source.order}</option>{/each}</select></label>
              </div>
            {/each}
          </section>
        {/if}
      {/if}
    {:else}
      <div class="empty-state"><h1>No open Goals</h1><p>Create a Goal in the Tangent tree before starting Reviewed build.</p></div>
    {/if}
  </main>
</div>
