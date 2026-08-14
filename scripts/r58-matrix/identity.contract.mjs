// identity.contract.mjs — IDENTITY-1..7 static contract for the Strict Startup
// / Preflight expected identity (single authority). Runs WITHOUT launching Typora.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const gateSrc = readFileSync(path.join(SCRIPT_DIR, 'run-empty-special-gate.mjs'), 'utf8');
const scenarios = JSON.parse(readFileSync(path.join(SCRIPT_DIR, 'scenarios.json'), 'utf8'));

const EXPECTED_BUILD_ID = 'inkchapter-r58-7-evc1-phase-b-observability-ts1';
const EXPECTED_MAIN_SHA = 'CDC9C206028B6B406DE692D41A876FB66932A95DE9F7A2B1FE372B47FC107AF1';
const EXPECTED_STYLE_SHA = '3B9F8AEE699925428770283E1DEAF0FE7A71B041B7A530BD583CFB60B4682B31';

const OLD_BUILD_ID = 'inkchapter-r58-7-p0-empty-caret-atomic-evc1';
const OLD_MAIN_SHA = 'C3963F7094B5C5EC0E348D84C59F40BED5433B807D35331E364FE6DCF70D11C1';
const OLD_STYLE_SHA = 'F163883946FD4FB7448110D0E7A8EB48CD5D52AFC3380BC0E466F7F3378470C0';

// IDENTITY-1: expected Build = evc1
assert.ok(gateSrc.includes(`'${EXPECTED_BUILD_ID}'`), 'IDENTITY-1 FAIL: BUILD_ID is not evc1');

// IDENTITY-2: expected Main SHA = C396...D11C1
assert.ok(gateSrc.includes(EXPECTED_MAIN_SHA), 'IDENTITY-2 FAIL: EXPECTED_MAIN_SHA mismatch');

// IDENTITY-3: expected Style SHA = 3B9F...2B31
assert.ok(gateSrc.includes(EXPECTED_STYLE_SHA), 'IDENTITY-3 FAIL: EXPECTED_STYLE_SHA mismatch');

// IDENTITY-4: Strict Startup 与 Preflight 使用同一 identity authority（同一 gate 文件），
//             且 scenarios.json 与 gate 保持一致（单一 authority）。
assert.equal(scenarios.buildId, EXPECTED_BUILD_ID, 'IDENTITY-4 FAIL: scenarios.buildId mismatch');
assert.equal(scenarios.expectedMainSha, EXPECTED_MAIN_SHA, 'IDENTITY-4 FAIL: scenarios.expectedMainSha mismatch');
assert.equal(scenarios.expectedStyleSha, EXPECTED_STYLE_SHA, 'IDENTITY-4 FAIL: scenarios.expectedStyleSha mismatch');

// IDENTITY-5: 旧 rfocus Build 不再作为 current expected value
assert.ok(!gateSrc.includes(OLD_BUILD_ID), 'IDENTITY-5 FAIL: old rfocus buildId still present');

// IDENTITY-6: 旧 Main SHA 不再作为 current expected value
assert.ok(!gateSrc.includes(OLD_MAIN_SHA), 'IDENTITY-6 FAIL: old main SHA still present');

// IDENTITY-7: 旧 Style SHA 不再作为 current expected value
assert.ok(!gateSrc.includes(OLD_STYLE_SHA), 'IDENTITY-7 FAIL: old style SHA still present');

console.log('IDENTITY-1..7 PASS');
