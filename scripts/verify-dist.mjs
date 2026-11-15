import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const files = [];

function walk(directory) {
  for (const name of readdirSync(directory)) {
    const path = resolve(directory, name);
    if (statSync(path).isDirectory()) walk(path);
    else files.push(path);
  }
}

function fail(message) {
  console.error(`dist verification failed: ${message}`);
  process.exitCode = 1;
}

if (!existsSync(dist)) {
  fail('dist/ does not exist. Run the production build first.');
} else {
  walk(dist);
  for (const file of files) {
    const extension = extname(file);
    const source = readFileSync(file, 'utf8');
    if (/^(<<<<<<<|=======|>>>>>>>)$/m.test(source)) {
      fail(`${relative(root, file)} contains an unresolved merge marker.`);
    }
    if (extension === '.js') {
      try {
        execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
      } catch {
        fail(`${relative(root, file)} is not valid JavaScript.`);
      }
    }
    if (extension !== '.html') continue;
    for (const match of source.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)) {
      const reference = match[1].split(/[?#]/, 1)[0];
      if (!reference || /^(?:[a-z]+:|\/|#)/i.test(reference)) continue;
      const target = resolve(dirname(file), reference);
      if (!existsSync(target)) fail(`${relative(root, file)} references missing ${reference}.`);
    }
  }
}

if (process.exitCode) process.exit(process.exitCode);
console.log(`Verified ${files.length} dist files: no merge markers, invalid JavaScript, or missing local assets.`);
