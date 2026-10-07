// `npm run preview:ui`: the dev server with the browser preview, and the address to open.
//   npm run preview:ui [-- --port 1430]
import { parseArgs } from 'node:util';
import { startDevServer } from './server.mjs';

const { values } = parseArgs({ options: { port: { type: 'string' } } });
const { server, url } = await startDevServer({ port: values.port ? Number(values.port) : undefined });

let scenes = [];
try {
  const module = await server.ssrLoadModule('/src/preview/scenes.ts');
  scenes = module.SCENES.map((scene) => scene.name);
} catch {
  // the hint works without the list
}

console.log('');
console.log(`  Просмотр интерфейса: ${url}/preview.html?scene=panel`);
if (scenes.length > 0) console.log(`  Сцены: ${scenes.join(', ')} (выбор сцены и монитора на служебной полосе страницы)`);
console.log('  Снимок сцены в PNG: npm run preview:shot -- --scene panel');
console.log('');
