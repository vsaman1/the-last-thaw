// The lossless gain: decode each recording before and after, compare sample by sample, and measure
// the shipped files' loudness with the lab (package B's BS.1770), at el.volume 1.
export default async (b) => {
  await b.load('http://localhost:5199/');
  await b.click();
  await b.wait(500);
  const files = ['mozart-k545-allegro', 'chopin-waltz-a-minor-b150', 'chopin-nocturne-e-minor-op72-1', 'beethoven-moonlight-adagio', 'schumann-the-poet-speaks', 'schumann-traumerei'];
  const steps = { 'chopin-nocturne-e-minor-op72-1': 1, 'beethoven-moonlight-adagio': 7, 'schumann-the-poet-speaks': 4, 'schumann-traumerei': 5 };
  for (const f of files) {
    const r = await b.evaluate(`(async () => {
      const dec = async (u) => { const bytes = await (await fetch(u)).arrayBuffer(); const ctx = new OfflineAudioContext(2, 1, 48000); return ctx.decodeAudioData(bytes); };
      const a = await dec('/__orig/${f}.mp3');
      const g = await dec('/audio/${f}.mp3');
      const want = Math.pow(2, ${steps[f] ?? 0} / 4);
      let maxErr = 0, peakA = 0, peakG = 0, n = 0, sumA = 0, sumG = 0;
      for (let c = 0; c < Math.min(a.numberOfChannels, g.numberOfChannels); c++) {
        const x = a.getChannelData(c), y = g.getChannelData(c);
        for (let i = 0; i < Math.min(x.length, y.length); i++) {
          const e = Math.abs(y[i] - want * x[i]); if (e > maxErr) maxErr = e;
          peakA = Math.max(peakA, Math.abs(x[i])); peakG = Math.max(peakG, Math.abs(y[i])); sumA += x[i]*x[i]; sumG += y[i]*y[i]; n++;
        }
      }
      const lab = await window.__icebergAudio.lab();
      const rec = await lab.recording('/audio/${f}.mp3');
      return { f: '${f}', lenA: a.length, lenG: g.length, want: +(20*Math.log10(want)).toFixed(3), rmsRatioDb: +(10*Math.log10(sumG/sumA)).toFixed(4), maxErrVsPeak: +(maxErr / peakG).toExponential(2), peakDbBefore: +(20*Math.log10(peakA)).toFixed(2), peakDbAfter: +(20*Math.log10(peakG)).toFixed(2), lufsI: +rec.lufsI.toFixed(2), lufsMMax: +rec.lufsMMax.toFixed(2), durationSec: +rec.durationSec.toFixed(1) };
    })()`, 600000);
    b.log(JSON.stringify(r));
  }
};
