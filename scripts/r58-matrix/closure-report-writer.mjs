#!/usr/bin/env node
// closure-report-writer.mjs — final R58.7 practical closure report writer.
//
// Consumes a list of TrialAuthority + TrialVerdict and writes exactly one pair:
//   docs/audits/inkchapter-r58-7-final-practical-closure-2026-08-14.md
//   artifacts/project-audit/inkchapter-r58-7-final-practical-closure-2026-08-14.json

'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..', '..');

export function buildClosureSummary(trials, meta) {
  const byScenario = {};
  for (const t of trials) {
    byScenario[t.scenario] = {
      verdict: t.verdict,
      firstFail: t.firstFail ?? null,
      failedChecks: t.failedChecks ?? [],
    };
  }

  const required = [
    'E1', 'E2', 'E3', 'FAILURE-PATH',
    'A1-01', 'A1-02', 'A1-03', 'A2-01', 'A3-01', 'B1-01', 'B1-02',
  ];

  const matrixScenarios = ['A1-01', 'A1-02', 'A1-03', 'A2-01', 'A3-01', 'B1-01', 'B1-02'];
  const matrixPass = matrixScenarios.filter((s) => byScenario[s]?.verdict === 'PASS').length;

  const allRequiredPass = required.every((s) => byScenario[s]?.verdict === 'PASS');
  const reducedMatrixPass = matrixPass === 7;

  return {
    buildId: meta.buildId ?? null,
    mainSHA: meta.mainSHA ?? null,
    styleSHA: meta.styleSHA ?? null,
    strictStartup: meta.strictStartup ?? null,
    phaseB: meta.phaseB ?? 'CLOSED',
    trials: byScenario,
    reducedMatrixPass,
    reducedMatrixPassCount: matrixPass,
    reducedMatrixPassTotal: 7,
    finalClosure: allRequiredPass && reducedMatrixPass ? 'PASS' : 'NOT_PASSED',
  };
}

export function renderClosureMarkdown(summary) {
  const lines = [
    '# InkChapter R58.7 Final Practical Closure',
    '',
    '- 日期：2026-08-14',
    '- 项目根目录：`D:\\TyporaPluginProjects\\typora-plugin-inkchapter`',
    '',
    '## Build / SHA',
    '',
    '```text',
    `buildId = ${summary.buildId}`,
    `mainSHA = ${summary.mainSHA}`,
    `styleSHA = ${summary.styleSHA}`,
    `strictStartup = ${summary.strictStartup}`,
    '```',
    '',
    '## Trials',
    '',
    '| scenario | verdict |',
    '|---|---|',
  ];
  const order = ['E1', 'E2', 'E3', 'FAILURE-PATH', 'A1-01', 'A1-02', 'A1-03', 'A2-01', 'A3-01', 'B1-01', 'B1-02'];
  for (const s of order) {
    const t = summary.trials[s] ?? { verdict: 'NOT_RUN' };
    lines.push(`| ${s} | ${t.verdict} |`);
  }
  lines.push('');
  lines.push('```text');
  lines.push(`Reduced Matrix = ${summary.reducedMatrixPassCount}/7 ${summary.reducedMatrixPass ? 'PASS' : 'NOT_PASSED'}`);
  lines.push(`R58.7 PRACTICAL CLOSURE = ${summary.finalClosure}`);
  lines.push('Extended Stress Matrix = WAIVED / NOT EXECUTED');
  lines.push('```');
  lines.push('');
  return lines.join('\n');
}

export function writeClosureReport(summary, outMd, outJson) {
  const mdPath = outMd ?? path.join(ROOT, 'docs', 'audits', 'inkchapter-r58-7-final-practical-closure-2026-08-14.md');
  const jsonPath = outJson ?? path.join(ROOT, 'artifacts', 'project-audit', 'inkchapter-r58-7-final-practical-closure-2026-08-14.json');

  fs.mkdirSync(path.dirname(mdPath), { recursive: true });
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(mdPath, renderClosureMarkdown(summary) + '\n', 'utf8');
  fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');
  return { mdPath, jsonPath };
}
