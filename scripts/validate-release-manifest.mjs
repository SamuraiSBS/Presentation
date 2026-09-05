#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function usage(message) {
  if (message) console.error(`Error: ${message}`);
  console.error('Usage: node scripts/validate-release-manifest.mjs --manifest <path> [--repository <path>]');
  process.exit(64);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument !== '--manifest' && argument !== '--repository') usage(`unknown argument ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) usage(`missing value for ${argument}`);
    args[argument.slice(2)] = value;
    index += 1;
  }
  if (!args.manifest) usage('--manifest is required');
  return args;
}

const args = parseArgs(process.argv.slice(2));
const manifestPath = path.resolve(args.manifest);
const repositoryPath = path.resolve(args.repository ?? path.dirname(manifestPath));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const imagePattern = /^[a-z0-9][a-z0-9._/-]*(?::[0-9]+)?\/[a-z0-9][a-z0-9._/-]*@sha256:[0-9a-f]{64}$/;

if (!/^[0-9a-f]{40}$/i.test(manifest.gitSha || '')) throw new Error('manifest gitSha must be a commit SHA');
if (manifest.releaseGate !== 'passed') throw new Error('manifest does not prove a passed release gate');

const compatibility = manifest.migrationCompatibility;
if (compatibility !== 'no-schema-change') {
  const policyPath = path.join(repositoryPath, 'ops', 'release', 'migration-policy.json');
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  const expectedFields = {
    migrationCompatibility: policy.migrationCompatibility,
    migrationPolicyVersion: policy.policyVersion,
    migrationId: policy.migrationId,
    migrationRollback: policy.migrationRollback,
    migrationDatabaseRollback: policy.migrationDatabaseRollback,
  };
  for (const [field, expected] of Object.entries(expectedFields)) {
    if (manifest[field] !== expected) throw new Error(`manifest ${field} must equal the checked-in migration policy (${expected})`);
  }
  if (compatibility !== 'expand-only-nullable-additive') throw new Error(`unsupported migration compatibility policy: ${compatibility}`);
} else if (manifest.migrationPolicyVersion || manifest.migrationId || manifest.migrationRollback || manifest.migrationDatabaseRollback) {
  throw new Error('no-schema-change manifest must not claim a migration policy or rollback mode');
}

for (const service of ['api', 'worker', 'web']) {
  if (!imagePattern.test(manifest.images?.[service] || '')) throw new Error(`manifest image ${service} is not an immutable digest reference`);
}

console.log(`Release manifest accepted: ${manifest.gitSha} (${compatibility})`);
