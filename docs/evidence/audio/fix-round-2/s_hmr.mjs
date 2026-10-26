// HMR of the engine module (dev only): three updates of src/audio/manager.ts as an edit would cause
// them (server.reloadModule), each followed by a click. Counts the AudioContexts in the document, how
// many still run, and whether the page reloaded (a marker on window survives only a hot update).
import { fileURLToPath } from 'node:url';

const FILE = process.env.HMR_FILE ?? fileURLToPath(new URL('../../../../src/audio/manager.ts', import.meta.url));
export default async (b) => {
  await b.load('http://localhost:5199/');
  await b.click(640, 700);
  await b.wait(1500);
  const read = () => b.evaluate(`JSON.stringify({ marker: window.__fix2Marker ?? null, contexts: (window.__audioProbe?.ctxs ?? []).map((c) => c.state), status: window.__icebergAudio?.state().status })`);
  b.log('before:', await read());
  for (let k = 1; k <= 3; k++) {
    await b.evaluate(`window.__fix2Marker = ${k}; true`);
    const r = await b.evaluate(`fetch('/__fix2_hmr?file=' + encodeURIComponent(${JSON.stringify(FILE)})).then((x) => x.text())`);
    await b.wait(3000);
    await b.until('document.querySelector(".app") !== null', 30000);
    await b.click(640, 700);
    await b.wait(1500);
    b.log(`after update ${k} (${r}):`, await read());
  }
  await b.wait(5000);
  b.log('5 s later:', await read());
};
