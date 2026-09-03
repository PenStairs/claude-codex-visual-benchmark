import process from 'node:process';
import { BenchmarkError } from '../lib/utils.mjs';
import { runProcess } from '../lib/process.mjs';

function assert(condition, message) {
  if (!condition) throw new BenchmarkError(message, { kind: 'configuration' });
}

const progress = [];
const active = await runProcess({
  command: process.execPath,
  args: ['-e', 'let n=0;const t=setInterval(()=>{console.log(++n);if(n===8)clearInterval(t)},50)'],
  timeoutMs: 1000,
  idleTimeoutMs: 200,
  softTimeoutMs: 60,
  progressIntervalMs: 35,
  onProgress: (snapshot) => progress.push(snapshot),
});
assert(active.exitCode === 0, 'Active child should complete successfully.');
assert(!active.idleTimedOut && !active.hardTimedOut, 'Active output must reset the idle timer.');
assert(active.softTimeoutReached, 'Soft timeout should warn without terminating the child.');
assert(progress.length > 0, 'Progress callback should receive heartbeat or soft-timeout events.');

const idle = await runProcess({
  command: process.execPath,
  args: ['-e', 'setTimeout(()=>{},500)'],
  timeoutMs: 1000,
  idleTimeoutMs: 70,
});
assert(idle.idleTimedOut && idle.terminationReason === 'idle-timeout', 'Silent child should hit the idle timeout.');

const hard = await runProcess({
  command: process.execPath,
  args: ['-e', 'setInterval(()=>console.log("active"),20)'],
  timeoutMs: 110,
  idleTimeoutMs: 500,
});
assert(hard.hardTimedOut && hard.terminationReason === 'hard-timeout', 'Continuously active child should still hit the hard timeout.');

console.log(JSON.stringify({ ok: true, tests: ['activity-resets-idle', 'soft-warning-only', 'idle-timeout', 'hard-timeout'] }));
