// Builds public/catalog.json from ../examples/*.tt: [{ name, title, source }].
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const examples = path.resolve(here, '../../examples');
const out = path.resolve(here, '../public/catalog.json');

const files = (await readdir(examples)).filter((f) => f.endsWith('.tt')).sort();
const catalog = [];
for (const file of files) {
	const source = await readFile(path.join(examples, file), 'utf8');
	const name = file.slice(0, -3);
	const m = /^\s*title\s+(.+?)\s*$/im.exec(source);
	const title = m ? m[1].replace(/^"(.*)"$/, '$1') : name;
	catalog.push({ name, title, source });
}

await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(catalog, null, '\t') + '\n');
console.log(`catalog: ${catalog.length} examples -> ${path.relative(process.cwd(), out)}`);
