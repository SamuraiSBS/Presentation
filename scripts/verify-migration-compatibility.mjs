#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function usage(message) {
  if (message) console.error(`Error: ${message}`);
  console.error('Usage: node scripts/verify-migration-compatibility.mjs --before <sha> --after <sha> [--policy <path>] [--github-output <path>]');
  process.exit(64);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) usage(`unknown argument ${argument}`);
    const key = argument.slice(2);
    if (key === 'before' || key === 'after' || key === 'policy' || key === 'github-output') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) usage(`missing value for --${key}`);
      args[key] = value;
      index += 1;
    } else {
      usage(`unknown argument ${argument}`);
    }
  }
  if (!args.before || !args.after) usage('--before and --after are required');
  return args;
}

const args = parseArgs(process.argv.slice(2));
const policyPath = path.resolve(repo, args.policy ?? 'ops/release/migration-policy.json');
const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));

function git(...gitArgs) {
  return execFileSync('git', ['-C', repo, ...gitArgs], { encoding: 'utf8' }).trim();
}

function gitFile(reference, relativePath) {
  return execFileSync('git', ['-C', repo, 'show', `${reference}:${relativePath}`], { encoding: 'utf8' });
}

function fail(message) {
  throw new Error(message);
}

function writeGithubOutput(values) {
  if (!args['github-output']) return;
  const output = Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n') + '\n';
  fs.appendFileSync(args['github-output'], output, 'utf8');
}

const noSchemaResult = {
  migration_compatibility: 'no-schema-change',
  migration_policy_version: '',
  migration_id: '',
  migration_rollback: '',
  migration_database_rollback: '',
};

const changedMigrations = git('diff', '--name-status', '--no-renames', args.before, args.after, '--', 'prisma/migrations')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const [status, ...fileParts] = line.split('\t');
    return { status, file: fileParts.join('\t') };
  });

let existingMigrationSql;
try {
  existingMigrationSql = gitFile(args.after, policy.migrationPath);
} catch {
  existingMigrationSql = null;
}

if (changedMigrations.length === 0 && existingMigrationSql === null) {
  writeGithubOutput(noSchemaResult);
  console.log('migrationCompatibility=no-schema-change');
  process.exit(0);
}

const migrationIntroducedByRelease = changedMigrations.length > 0;
if (migrationIntroducedByRelease && (changedMigrations.length !== 1 || changedMigrations[0].status !== 'A' || changedMigrations[0].file !== policy.migrationPath)) {
  fail(`Prisma migration changes must be exactly one added migration at ${policy.migrationPath}; got ${JSON.stringify(changedMigrations)}`);
}

const migrationSql = (existingMigrationSql ?? gitFile(args.after, policy.migrationPath)).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();
const expectedSql = 'ALTER TABLE "AiUsageEvent" ADD COLUMN "cacheWriteTokens" INTEGER;';
if (migrationSql !== expectedSql) {
  fail(`Migration ${policy.migrationPath} is not the approved nullable additive change.`);
}

const oldSchema = gitFile(args.before, 'prisma/schema.prisma');
const newSchema = gitFile(args.after, 'prisma/schema.prisma');
const fieldPattern = /^\s*cacheWriteTokens\s+Int\?\s*$/m;
if (migrationIntroducedByRelease && fieldPattern.test(oldSchema)) fail('The previous Prisma schema already contains cacheWriteTokens; update the migration policy instead of reusing this one.');
if (!fieldPattern.test(newSchema)) fail('The current Prisma schema must declare cacheWriteTokens as nullable Int?.');

for (const relativePath of ['apps/api/src/admin/admin.service.ts', 'apps/worker/src/usage-ledger.ts']) {
  if (!gitFile(args.after, relativePath).includes('cacheWriteTokens')) {
    fail(`The new application code does not contain the expected cacheWriteTokens usage: ${relativePath}`);
  }
}

if (policy.policyVersion !== 'expand-only-v1' || policy.migrationCompatibility !== 'expand-only-nullable-additive') {
  fail('The migration policy file has an unsupported compatibility policy.');
}
if (policy.migrationRollback !== 'application-only' || policy.migrationDatabaseRollback !== 'not-required') {
  fail('The additive nullable migration must use application-only rollback without database rollback.');
}
if (policy.oldCodeCompatible !== true || policy.newCodeRequiresMigrationBeforeStart !== true) {
  fail('The migration policy must explicitly prove old-code compatibility and migrate-before-start ordering.');
}

const result = {
  migration_compatibility: policy.migrationCompatibility,
  migration_policy_version: policy.policyVersion,
  migration_id: policy.migrationId,
  migration_rollback: policy.migrationRollback,
  migration_database_rollback: policy.migrationDatabaseRollback,
};
writeGithubOutput(result);
for (const [key, value] of Object.entries(result)) console.log(`${key}=${value}`);
console.log(`${migrationIntroducedByRelease ? 'Forward-compatible migration policy accepted' : 'Existing forward-compatible migration policy accepted for this release'}: old Prisma code ignores the extra nullable column, and new application images migrate before startup.`);
