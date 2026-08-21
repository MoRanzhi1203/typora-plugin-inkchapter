#!/usr/bin/env node
// fixture-manager.mjs — Node fixture / sidecar manager for the R58.7 closure gate.
//
// Single source of truth for scenario → fixture/sidecar resolution and the
// legal B1 historical sidecar seed. Reads scenarios.json. Never launches Typora,
// never injects input.

'use strict';

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const VAULT = path.join(ROOT, 'test', 'vault');
const SIDECAR_DIR = path.join(VAULT, '.typora', 'inkchapter', 'paragraph-layout');

const DEFAULT_SCENARIOS_PATH = path.join(SCRIPT_DIR, 'scenarios.json');

function loadScenarios(scenariosPath = DEFAULT_SCENARIOS_PATH) {
  return JSON.parse(fs.readFileSync(scenariosPath, 'utf8'));
}

/** Resolve the scenario mapping (scenario → fixture/parser/sidecarPolicy/type). */
export function resolveScenario(scenario, scenarios = loadScenarios()) {
  const map = scenarios.scenarioMap ?? {};
  const entry = map[scenario];
  if (!entry) return null;
  return {
    scenario,
    ...entry,
    type: entry.type ?? scenario,
  };
}

export function fixturePaths(fixture, vault = VAULT) {
  return {
    fixture: fixture,
    fixturePath: path.join(vault, 'regression', 'r58', fixture),
    sidecarPath: path.join(vault, '.typora', 'inkchapter', 'paragraph-layout', fixture + '.json'),
  };
}

export function verifyFixture(fixture, vault = VAULT) {
  const p = path.join(vault, 'regression', 'r58', fixture);
  if (!fs.existsSync(p)) {
    return { fixture, fixturePath: p, exists: false, bytesHex: null, size: 0 };
  }
  const bytes = fs.readFileSync(p);
  return {
    fixture,
    fixturePath: p,
    exists: true,
    bytesHex: bytes.toString('hex').toUpperCase(),
    size: bytes.length,
  };
}

export function verifySidecar(fixture, vault = VAULT) {
  const p = path.join(vault, '.typora', 'inkchapter', 'paragraph-layout', fixture + '.json');
  if (!fs.existsSync(p)) {
    return { fixture, sidecarPath: p, exists: false, recordCount: 0 };
  }
  let recordCount = 0;
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (Array.isArray(j.paragraphOverrides)) recordCount = j.paragraphOverrides.length;
    else if (Array.isArray(j.records)) recordCount = j.records.length;
    else recordCount = -1;
  } catch {
    recordCount = -1;
  }
  return { fixture, sidecarPath: p, exists: true, recordCount };
}

export function cleanSidecar(fixture, vault = VAULT) {
  const p = path.join(vault, '.typora', 'inkchapter', 'paragraph-layout', fixture + '.json');
  const existed = fs.existsSync(p);
  if (existed) fs.unlinkSync(p);
  return { fixture, sidecarPath: p, removed: existed };
}

/** Remove sidecar + ensure the fixture .md exists (never rewrites existing content). */
export function cleanFixture(fixture, vault = VAULT) {
  const fp = path.join(vault, 'regression', 'r58', fixture);
  const existed = fs.existsSync(fp);
  if (!existed) {
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, '', 'utf8');
  }
  const sidecar = cleanSidecar(fixture, vault);
  return {
    fixture,
    fixturePath: fp,
    fixtureExisted: existed,
    fixtureReady: true,
    sidecarRemoved: sidecar.removed,
    sidecarState: verifySidecar(fixture, vault),
  };
}

/**
 * Seed a legal historical sidecar for a B1 trial.
 * Fixture content: 历史段落 (single paragraph, no BOM). Sidecar schema matches
 * the current real sidecar schema (schemaVersion 1, documentPath, updatedAt,
 * paragraphOverrides with one force-indent record anchored at ordinal 0).
 */
export function seedHistoricalFixture(fixture, vault = VAULT) {
  const fp = path.join(vault, 'regression', 'r58', fixture);
  const sp = path.join(vault, '.typora', 'inkchapter', 'paragraph-layout', fixture + '.json');

  if (!fs.existsSync(fp)) {
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, '\u5386\u53f2\u6bb5\u843d\n', 'utf8'); // 历史段落 + LF, no BOM
  }

  const now = Date.now();
  const doc = {
    schemaVersion: 1,
    documentPath: fp,
    updatedAt: now,
    paragraphOverrides: [
      {
        id: `indent-${now}-0`,
        mode: 'force-indent',
        anchor: { lastKnownOrdinal: 0 },
        temporary: true,
      },
    ],
  };

  fs.mkdirSync(path.dirname(sp), { recursive: true });
  fs.writeFileSync(sp, JSON.stringify(doc, null, 2) + '\n', 'utf8');

  return {
    scenario: 'B1',
    fixture,
    sidecar: sp,
    fixtureExists: true,
    sidecarExists: true,
    fixtureReady: true,
    sidecarReady: true,
    recordCount: 1,
    seedOrigin: 'persisted',
    expectedLoadState: 'PERSISTED_HISTORICAL',
    seedId: doc.paragraphOverrides[0].id,
  };
}

/** Remove the one-shot runtime test hook config (default off). */
export function cleanTestHookConfig(vault = VAULT) {
  const p = path.join(vault, '.typora', 'inkchapter', 'runtime-test-hook.json');
  const existed = fs.existsSync(p);
  if (existed) fs.unlinkSync(p);
  return { hookConfigPath: p, removed: existed };
}

/** Write the one-shot runtime test hook config (consumed by the src hook). */
export function writeTestHookConfig(config, vault = VAULT) {
  const p = path.join(vault, '.typora', 'inkchapter', 'runtime-test-hook.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(config, null, 2) + '\n', 'utf8');
  return { hookConfigPath: p, config };
}

export function sha256Hex(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

export const PATHS = { SCRIPT_DIR, ROOT, VAULT, SIDECAR_DIR };
