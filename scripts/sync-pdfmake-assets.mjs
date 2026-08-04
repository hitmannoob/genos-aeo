import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDirectory = resolve(projectRoot, 'node_modules/pdfmake/build');
const targetDirectory = resolve(projectRoot, 'public/vendor/pdfmake');

await mkdir(targetDirectory, { recursive: true });
await Promise.all([
  copyFile(resolve(sourceDirectory, 'pdfmake.min.js'), resolve(targetDirectory, 'pdfmake.min.js')),
  copyFile(resolve(sourceDirectory, 'vfs_fonts.js'), resolve(targetDirectory, 'vfs_fonts.js')),
]);

console.log('Synced local pdfmake browser assets.');
