import { BenchmarkError } from './utils.mjs';

// Prompt text is runner-independent by design: every participant receives the
// exact same bytes regardless of whether Codex CLI or Claude Code executes it.
// AGENTS.md and CLAUDE.md in each template are byte-identical copies so that
// each CLI's native workspace-instruction discovery sees the same rules.

export function buildGenerationPrompt(method, prompt, round = prompt.rounds?.[0] ?? prompt) {
  const target = method.id === 'threejs'
    ? 'Build the requested scene in the provided Three.js scaffold.'
    : 'Build the requested visual as the complete Twigl Classic shader in shader.frag.';

  return [
    'You are one participant in a controlled visual-code benchmark.',
    target,
    'Read and obey the workspace rules file (AGENTS.md and CLAUDE.md are identical copies). Work only inside the current workspace.',
    'Do not install or change dependencies, use network services, fetch external assets, or inspect parent directories.',
    'Use your own judgment for composition and implementation. Do not describe what you would build: edit the required file and leave the runnable result in the workspace.',
    '',
    `Benchmark prompt version: ${prompt.version}`,
    `Benchmark prompt set SHA-256: ${prompt.sha256}`,
    `Creative round: 1 of ${prompt.roundCount ?? 1}`,
    `Round id: ${round.id ?? 'initial'}`,
    `Round SHA-256: ${round.sha256 ?? prompt.sha256}`,
    '<benchmark_prompt>',
    round.text.trimEnd(),
    '</benchmark_prompt>',
    '',
  ].join('\n');
}

export function buildFollowupPrompt(round) {
  if (!round || !Number.isInteger(round.index) || round.index < 2) {
    throw new BenchmarkError('A follow-up prompt requires a round with index 2 or greater.', { kind: 'configuration' });
  }
  return round.text;
}

export function buildRepairPrompt(method, verification, round, maximumRounds) {
  const editable = method.allowedModifiedFiles.join(', ');
  return [
    `This is repair round ${round} of ${maximumRounds} for the same benchmark entry.`,
    `Fix only the executable validation failures below. You may edit only: ${editable}.`,
    'Do not redesign the scene, add dependencies, access the network, inspect parent directories, or change protected files.',
    'Leave the corrected runnable result in the workspace.',
    '',
    '<validation_failures>',
    JSON.stringify(verification.failures, null, 2),
    '</validation_failures>',
    '',
  ].join('\n');
}
