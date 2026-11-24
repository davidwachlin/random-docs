#!/usr/bin/env node
// Run agent-efficiency evals for a CLI with Claude Code in headless mode.
// Usage:
//   node run-evals.mjs --tasks tasks.json --allow "Bash(acme:*)" [--runs 3] [--only id1,id2] [--held-out include|exclude|only]
// Each task: { "id": "...", "prompt": "...", "verify": "shell command that exits 0 on success", "heldOut": false }
// Requires the `claude` CLI on PATH. Uses: claude -p <prompt> --allowedTools <allow> --output-format stream-json --verbose
// Field names in the stream are read defensively; check them against your Claude Code version.

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values: opt } = parseArgs({
  options: {
    tasks: { type: 'string' },
    allow: { type: 'string' },
    runs: { type: 'string', default: '1' },
    only: { type: 'string' },
    'held-out': { type: 'string', default: 'include' },
    out: { type: 'string', default: 'eval-results' },
    timeout: { type: 'string', default: '600' },
  },
  strict: true,
});
if (!opt.tasks || !opt.allow) {
  console.error('usage: run-evals.mjs --tasks tasks.json --allow "Bash(<cli>:*)" [--runs N] [--only ids] [--held-out include|exclude|only]');
  process.exit(2);
}

let tasks = JSON.parse(readFileSync(opt.tasks, 'utf8'));
if (opt.only) { const ids = new Set(opt.only.split(',')); tasks = tasks.filter(t => ids.has(t.id)); }
if (opt['held-out'] === 'exclude') tasks = tasks.filter(t => !t.heldOut);
if (opt['held-out'] === 'only') tasks = tasks.filter(t => t.heldOut);
const runs = Number(opt.runs);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = `${opt.out}/${stamp}`;
mkdirSync(`${outDir}/transcripts`, { recursive: true });

function runClaude(prompt) {
  return new Promise((resolve) => {
    const args = ['-p', prompt, '--allowedTools', opt.allow, '--output-format', 'stream-json', '--verbose'];
    const child = spawn('claude', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let raw = '', err = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), Number(opt.timeout) * 1000);
    child.stdout.on('data', d => { raw += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('close', code => { clearTimeout(timer); resolve({ raw, err, code }); });
  });
}

function analyze(raw) {
  const m = { toolCalls: 0, toolErrors: 0, bashCalls: 0, helpCalls: 0, toolResultChars: 0, turns: null, costUsd: null, inputTokens: null, outputTokens: null, durationMs: null, isError: null, result: null };
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let ev; try { ev = JSON.parse(line); } catch { continue; }
    const content = ev?.message?.content;
    if (ev.type === 'assistant' && Array.isArray(content)) {
      for (const c of content) if (c?.type === 'tool_use') {
        m.toolCalls++;
        if (c.name === 'Bash') {
          m.bashCalls++;
          const cmd = String(c.input?.command ?? '');
          if (/(^|\s)(--help|-h)(\s|$)|\shelp\s|\sschema\s/.test(cmd)) m.helpCalls++;
        }
      }
    }
    if (ev.type === 'user' && Array.isArray(content)) {
      for (const c of content) if (c?.type === 'tool_result') {
        if (c.is_error) m.toolErrors++;
        const text = typeof c.content === 'string' ? c.content : JSON.stringify(c.content ?? '');
        m.toolResultChars += text.length;
      }
    }
    if (ev.type === 'result') {
      m.turns = ev.num_turns ?? null;
      m.costUsd = ev.total_cost_usd ?? null;
      m.durationMs = ev.duration_ms ?? null;
      m.isError = ev.is_error ?? null;
      m.result = typeof ev.result === 'string' ? ev.result.slice(0, 2000) : null;
      const u = ev.usage ?? {};
      m.inputTokens = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      m.outputTokens = u.output_tokens ?? null;
    }
  }
  return m;
}

const results = [];
for (const task of tasks) {
  for (let r = 1; r <= runs; r++) {
    process.stderr.write(`[${task.id} run ${r}/${runs}] `);
    const t0 = Date.now();
    const { raw, err, code } = await runClaude(task.prompt);
    writeFileSync(`${outDir}/transcripts/${task.id}.run${r}.jsonl`, raw);
    if (err.trim()) writeFileSync(`${outDir}/transcripts/${task.id}.run${r}.stderr.txt`, err);
    const m = analyze(raw);
    let pass = null;
    if (task.verify) pass = spawnSync('bash', ['-c', task.verify], { stdio: 'ignore', timeout: 120000 }).status === 0;
    const row = { id: task.id, run: r, heldOut: !!task.heldOut, pass, claudeExit: code, wallMs: Date.now() - t0, ...m };
    results.push(row);
    process.stderr.write(`${pass === null ? 'no-verify' : pass ? 'PASS' : 'FAIL'} turns=${m.turns} tools=${m.toolCalls} errors=${m.toolErrors} in=${m.inputTokens} out=${m.outputTokens}\n`);
  }
}

function summarize(rows) {
  const n = rows.length || 1;
  const avg = k => rows.reduce((s, x) => s + (Number(x[k]) || 0), 0) / n;
  const verified = rows.filter(x => x.pass !== null);
  return {
    runs: rows.length,
    passRate: verified.length ? verified.filter(x => x.pass).length / verified.length : null,
    avgTurns: avg('turns'), avgToolCalls: avg('toolCalls'), avgToolErrors: avg('toolErrors'),
    avgHelpCalls: avg('helpCalls'), avgToolResultChars: avg('toolResultChars'),
    avgInputTokens: avg('inputTokens'), avgOutputTokens: avg('outputTokens'),
    avgCostUsd: avg('costUsd'), avgWallMs: avg('wallMs'),
  };
}

const summary = {
  all: summarize(results),
  tuning: summarize(results.filter(x => !x.heldOut)),
  heldOut: summarize(results.filter(x => x.heldOut)),
};
writeFileSync(`${outDir}/results.json`, JSON.stringify({ tasksFile: opt.tasks, allow: opt.allow, runs, summary, results }, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.error(`\nSaved: ${outDir}/results.json and ${outDir}/transcripts/`);
