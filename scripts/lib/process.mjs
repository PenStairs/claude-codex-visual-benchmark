import { spawn } from 'node:child_process';
import { accessSync, constants as fsConstants } from 'node:fs';
import { basename, delimiter, dirname, extname, isAbsolute, join } from 'node:path';
import process from 'node:process';
import { BenchmarkError, redactText } from './utils.mjs';

const commandCache = new Map();

function isExecutable(target) {
  try {
    accessSync(target, process.platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveWindowsCommandScript(command) {
  if (process.platform !== 'win32') return null;
  const pathParts = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  for (const directory of pathParts) {
    const candidate = join(directory.replace(/^"|"$/g, ''), `${command}.cmd`);
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

function hasNativeExecutable(command) {
  if (process.platform !== 'win32') return true;
  const pathParts = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  for (const directory of pathParts) {
    for (const extension of ['.exe', '.com']) {
      if (isExecutable(join(directory.replace(/^"|"$/g, ''), `${command}${extension}`))) return true;
    }
  }
  return false;
}

export function resolveCommand(command) {
  if (commandCache.has(command)) return commandCache.get(command);
  if (isAbsolute(command) && isExecutable(command)) return command;

  const pathParts = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  const extensions = process.platform === 'win32'
    ? ['.exe', '.com', '.cmd', '.bat', '']
    : [''];

  for (const extension of extensions) {
    for (const directory of pathParts) {
      const candidate = join(directory.replace(/^"|"$/g, ''), `${command}${extension}`);
      if (isExecutable(candidate)) {
        commandCache.set(command, candidate);
        return candidate;
      }
    }
  }

  throw new BenchmarkError(`Required command was not found on PATH: ${command}`, { kind: 'infrastructure' });
}

function executablePlan(command, args) {
  // Prefer a native executable when one exists (e.g. the Claude Code native
  // installer ships claude.exe); fall back to the npm-generated .cmd shim.
  const preferScript = ['npm', 'codex'].includes(command)
    || (command === 'claude' && !hasNativeExecutable(command));
  const knownScript = preferScript ? resolveWindowsCommandScript(command) : null;
  const resolved = knownScript ?? resolveCommand(command);
  const extension = extname(resolved).toLowerCase();
  if (process.platform !== 'win32' || !['.cmd', '.bat'].includes(extension)) {
    return { executable: resolved, args };
  }

  if (basename(resolved).toLowerCase() === 'npm.cmd') {
    const npmCli = join(dirname(resolved), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (isExecutable(npmCli)) return { executable: process.execPath, args: [npmCli, ...args] };
  }

  if (basename(resolved).toLowerCase() === 'codex.cmd') {
    const codexCli = join(dirname(resolved), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    if (isExecutable(codexCli)) return { executable: process.execPath, args: [codexCli, ...args] };
  }

  if (basename(resolved).toLowerCase() === 'claude.cmd') {
    const packageRoot = join(dirname(resolved), 'node_modules', '@anthropic-ai', 'claude-code');
    const nativeClaude = join(packageRoot, 'bin', 'claude.exe');
    if (isExecutable(nativeClaude)) return { executable: nativeClaude, args };
    const claudeCli = join(packageRoot, 'cli.js');
    if (isExecutable(claudeCli)) return { executable: process.execPath, args: [claudeCli, ...args] };
  }

  throw new BenchmarkError(`Refusing to launch Windows command script through a shell: ${resolved}`, {
    kind: 'infrastructure',
    details: 'Install or expose a native executable on PATH.',
  });
}

function spawnOptions(options) {
  return {
    cwd: options.cwd,
    env: options.env,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
  };
}

export async function runProcess({
  command,
  args = [],
  cwd,
  env = process.env,
  stdin = '',
  timeoutMs = 0,
  secrets = [],
  maxCaptureBytes = 20 * 1024 * 1024,
  signal = null,
  idleTimeoutMs = 0,
  softTimeoutMs = 0,
  progressIntervalMs = 0,
  onProgress = null,
}) {
  if (signal?.aborted) {
    throw new BenchmarkError(`Refusing to start ${command}: the run was already aborted.`, { kind: 'infrastructure' });
  }
  const plan = executablePlan(command, args);
  const executable = plan.executable;
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();

  return await new Promise((resolve, reject) => {
    const child = spawn(executable, plan.args, spawnOptions({ cwd, env }));
    const stdoutChunks = [];
    const stderrChunks = [];
    let capturedBytes = 0;
    let timedOut = false;
    let hardTimedOut = false;
    let idleTimedOut = false;
    let softTimeoutReached = false;
    let aborted = false;
    let terminationReason = null;
    let lastActivityMs = startedAtMs;
    let hardTimer;
    let idleTimer;
    let softTimer;
    let progressTimer;

    const clearTimers = () => {
      if (hardTimer) clearTimeout(hardTimer);
      if (idleTimer) clearTimeout(idleTimer);
      if (softTimer) clearTimeout(softTimer);
      if (progressTimer) clearInterval(progressTimer);
    };

    const progressSnapshot = (reason = 'heartbeat') => ({
      reason,
      elapsedMs: Date.now() - startedAtMs,
      idleMs: Date.now() - lastActivityMs,
      softTimeoutReached,
      stdout: redactText(Buffer.concat(stdoutChunks).toString('utf8'), secrets),
      stderr: redactText(Buffer.concat(stderrChunks).toString('utf8'), secrets),
    });

    const emitProgress = (reason) => {
      if (typeof onProgress !== 'function') return;
      try {
        onProgress(progressSnapshot(reason));
      } catch {
        // Progress reporting must never change the benchmark outcome.
      }
    };

    const terminate = (reason) => {
      if (terminationReason) return;
      terminationReason = reason;
      timedOut = reason === 'hard-timeout' || reason === 'idle-timeout';
      hardTimedOut = reason === 'hard-timeout';
      idleTimedOut = reason === 'idle-timeout';
      aborted = reason === 'peer-aborted';
      emitProgress(reason);
      if (process.platform === 'win32' && child.pid) {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
          shell: false,
        }).on('error', () => child.kill());
      } else {
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 3000).unref();
      }
    };

    const scheduleIdleTimeout = () => {
      if (idleTimeoutMs <= 0) return;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => terminate('idle-timeout'), idleTimeoutMs);
      idleTimer.unref();
    };

    const noteActivity = () => {
      lastActivityMs = Date.now();
      scheduleIdleTimeout();
    };

    const onAbort = () => {
      terminate('peer-aborted');
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    const capture = (bucket) => (chunk) => {
      noteActivity();
      if (capturedBytes >= maxCaptureBytes) return;
      const remaining = maxCaptureBytes - capturedBytes;
      const slice = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
      capturedBytes += slice.length;
      bucket.push(slice);
    };

    child.stdout.on('data', capture(stdoutChunks));
    child.stderr.on('data', capture(stderrChunks));
    child.stdin.on('error', () => {
      // The process exit result below carries the actionable FFmpeg/tool error.
    });
    child.once('error', (error) => {
      clearTimers();
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(new BenchmarkError(`Failed to start ${command}`, {
        kind: 'infrastructure',
        details: error.message,
      }));
    });
    child.once('close', (exitCode, exitSignal) => {
      clearTimers();
      if (signal) signal.removeEventListener('abort', onAbort);
      const finishedAtMs = Date.now();
      resolve({
        command: executable,
        exitCode,
        signal: exitSignal,
        timedOut,
        hardTimedOut,
        idleTimedOut,
        softTimeoutReached,
        terminationReason,
        aborted,
        startedAt,
        finishedAt: new Date(finishedAtMs).toISOString(),
        durationMs: finishedAtMs - startedAtMs,
        lastActivityAt: new Date(lastActivityMs).toISOString(),
        stdout: redactText(Buffer.concat(stdoutChunks).toString('utf8'), secrets),
        stderr: redactText(Buffer.concat(stderrChunks).toString('utf8'), secrets),
        captureTruncated: capturedBytes >= maxCaptureBytes,
      });
    });

    if (timeoutMs > 0) {
      hardTimer = setTimeout(() => terminate('hard-timeout'), timeoutMs);
      hardTimer.unref();
    }
    if (softTimeoutMs > 0) {
      softTimer = setTimeout(() => {
        softTimeoutReached = true;
        emitProgress('soft-timeout');
      }, softTimeoutMs);
      softTimer.unref();
    }
    if (progressIntervalMs > 0) {
      progressTimer = setInterval(() => emitProgress('heartbeat'), progressIntervalMs);
      progressTimer.unref();
    }
    scheduleIdleTimeout();

    if (stdin) child.stdin.end(stdin, 'utf8');
    else child.stdin.end();
  });
}

export function startManagedProcess({ command, args = [], cwd, env = process.env }) {
  const plan = executablePlan(command, args);
  const executable = plan.executable;
  const child = spawn(executable, plan.args, spawnOptions({ cwd, env }));
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });

  const exited = new Promise((resolve) => {
    child.once('close', (exitCode, signal) => resolve({ exitCode, signal }));
  });

  return {
    child,
    exited,
    output: () => ({ stdout, stderr }),
    async stop() {
      if (child.exitCode !== null) return await exited;
      child.kill('SIGTERM');
      const forced = new Promise((resolve) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          resolve(null);
        }, 3000);
        timer.unref();
      });
      return await Promise.race([exited, forced]);
    },
  };
}
