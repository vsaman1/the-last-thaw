// True peak of the input vs the output for white and 16 kHz band-limited full-scale noise.
export default async ({ evaluate, wait, log }) => {
  await wait(1500);
  const r = await evaluate(`(async () => {
    const an = await import('/src/audio/analysis.ts');
    const rate = 48000, n = rate;
    let s = 42; const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    const white = new Float32Array(n); for (let i = 0; i < n; i++) white[i] = rnd() * 2 - 1;
    // band-limit offline at 16 kHz (two 2nd-order sections), then normalise to a 0 dBFS sample peak
    const lp = async (x) => { const c = new OfflineAudioContext(1, n, rate); const b = c.createBuffer(1, n, rate); b.copyToChannel(x, 0); const src = c.createBufferSource(); src.buffer = b; const f1 = c.createBiquadFilter(); f1.frequency.value = 16000; f1.Q.value = 0.5412; const f2 = c.createBiquadFilter(); f2.frequency.value = 16000; f2.Q.value = 1.3066; src.connect(f1).connect(f2).connect(c.destination); src.start(); const o = await c.startRendering(); const y = o.getChannelData(0).slice(); let p = 0; for (const v of y) p = Math.max(p, Math.abs(v)); for (let i = 0; i < n; i++) y[i] /= p; return y; };
    const band = await lp(white);
    const out = [];
    for (const [name, x] of [['white', white], ['16 kHz', band]]) {
      const inTp = an.truePeak(x);
      const ctx = new OfflineAudioContext(2, rate * 1.6, rate);
      const b = ctx.createBuffer(1, n, rate); b.copyToChannel(x, 0);
      const c = ctx.createDynamicsCompressor(); c.threshold.value = -3; c.ratio.value = 20; c.attack.value = 0.001; c.release.value = 0.12; c.knee.value = 0;
      const g = ctx.createGain(); g.gain.value = Math.pow(10, -1.71 / 20);
      const src = ctx.createBufferSource(); src.buffer = b; src.connect(c).connect(g).connect(ctx.destination); src.start(0.5);
      const o = await ctx.startRendering();
      const y = o.getChannelData(0).subarray(rate * 0.5);
      let pk = 0; for (const v of y) pk = Math.max(pk, Math.abs(v));
      out.push({ name, inSamplePeakDb: 0, inTruePeakDb: +(20 * Math.log10(inTp)).toFixed(2), outSamplePeakDb: +(20 * Math.log10(pk)).toFixed(2), outTruePeakDb: +(20 * Math.log10(an.truePeak(y))).toFixed(2) });
    }
    return out;
  })()`);
  for (const x of r) log(JSON.stringify(x));
};
