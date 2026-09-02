import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const validator = path.join(repository, 'scripts', 'validate-release-manifest.mjs');
const compatibilityVerifier = path.join(repository, 'scripts', 'verify-migration-compatibility.mjs');
const gitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim();
const imageDigest = (service) => `ghcr.io/example/studydeck-${service}@sha256:${'0'.repeat(64)}`;

function writeManifest(manifest) {
  const directory = mkdtempSync(path.join(tmpdir(), 'studydeck-release-policy-'));
  const manifestPath = path.join(directory, 'release-manifest.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { directory, manifestPath };
}

test('accepts the expand-only nullable migration manifest', () => {
  const { directory, manifestPath } = writeManifest({
    gitSha,
    releaseGate: 'passed',
    migrationCompatibility: 'expand-only-nullable-additive',
    migrationPolicyVersion: 'expand-only-v1',
    migrationId: '20260831140000_ai_usage_cache_write_tokens',
    migrationRollback: 'application-only',
    migrationDatabaseRollback: 'not-required',
    images: { api: imageDigest('api'), worker: imageDigest('worker'), web: imageDigest('web') },
  });
  try {
    const output = execFileSync(process.execPath, [validator, '--manifest', manifestPath, '--repository', repository], { encoding: 'utf8' });
    assert.match(output, /expand-only-nullable-additive/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('accepts a manifest with no schema change', () => {
  const { directory, manifestPath } = writeManifest({
    gitSha,
    releaseGate: 'passed',
    migrationCompatibility: 'no-schema-change',
    images: { api: imageDigest('api'), worker: imageDigest('worker'), web: imageDigest('web') },
  });
  try {
    const output = execFileSync(process.execPath, [validator, '--manifest', manifestPath, '--repository', repository], { encoding: 'utf8' });
    assert.match(output, /no-schema-change/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('classifies an already merged approved migration on a follow-up release', () => {
  const output = execFileSync(process.execPath, [
    compatibilityVerifier,
    '--before', gitSha,
    '--after', gitSha,
    '--policy', 'ops/release/migration-policy.json',
  ], { cwd: repository, encoding: 'utf8' });
  assert.match(output, /migration_compatibility=expand-only-nullable-additive/);
});
