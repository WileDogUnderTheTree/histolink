// ============================================================================
// 史脉 HistoLink · 鸿门宴 — ORIGINAL SCORE (44.6 s, synthesized in code)
// Key: D gong-mode pentatonic — D E F# A B (midi 50 52 54 57 59 / 62..71 / 74..83)
// Bus law: percussion, impacts, transition whooshes, bells, accent plucks -> dest
//          pads, flute, arpeggios, muted plucks, subs, air                  -> bed
// The player engine owns beat-synced sidechain ducking and the final fade, so
// this body adds neither. It also never uses an early-exit statement: every
// buffer builder fills the buffer that was passed in, and every voice helper is
// a sink that schedules its own nodes and envelopes.
// HARD BAN observed: no low-frequency sine frequency sweeps anywhere. Every low
// sine (55/62/73.42/110 Hz) is fixed-pitch; low-end impact comes from envelopes.
// ============================================================================

const SR = ctx.sampleRate;
const T0 = ctx.currentTime;              // 0 for an OfflineAudioContext
const at = (r) => T0 + r;                // seconds-from-start -> ctx time, never quantised

// ---------------------------------------------------------------- output trims
// Only a small headroom trim: no ducking, no master fade (engine's job).
const acc = ctx.createGain(); acc.gain.value = 0.94; acc.connect(dest);   // accents -> dest
const mus = ctx.createGain(); mus.gain.value = 0.95; mus.connect(bed);    // music bed -> bed

// ---------------------------------------------------------------- shared hall
// ~1.6 s stereo IR, exponentially decaying seeded noise, energy-normalised so
// the wet level is predictable instead of "whatever convolver normalisation".
const IRB = ctx.createBuffer(2, Math.floor(1.6 * SR), SR);
const fillIR = (buf, decay) => {
  const n = buf.length, ch = buf.numberOfChannels;
  let ss = 0;
  for (let c = 0; c < ch; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const x = i / n;
      const envl = Math.pow(1 - x, decay) * (i < n * 0.006 ? i / (n * 0.006) : 1);
      lp += 0.5 * ((rand() * 2 - 1) - lp);    // one-pole damping keeps the tail papery, not hissy
      d[i] = lp * envl;
      ss += d[i] * d[i];
    }
  }
  const g = 0.9 / Math.sqrt(ss / ch + 1e-9);
  for (let c = 0; c < ch; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] *= g;
  }
};
fillIR(IRB, 3.4);
const verb = ctx.createConvolver(); verb.normalize = false; verb.buffer = IRB;
const verbIn = ctx.createGain(); verbIn.gain.value = 1;
const verbLP = ctx.createBiquadFilter(); verbLP.type = 'lowpass'; verbLP.frequency.value = 5200;
const verbOut = ctx.createGain(); verbOut.gain.value = 0.5;
verbIn.connect(verb); verb.connect(verbLP); verbLP.connect(verbOut); verbOut.connect(acc);
const sendTo = (node, amt) => {                       // reverb send (dest side = un-ducked)
  const s = ctx.createGain(); s.gain.value = amt; node.connect(s); s.connect(verbIn);
};

// ---------------------------------------------------------------- noise source
// ONE 3.2 s white-noise buffer is shared by every noise voice (offsets vary),
// so no per-voice buffer generation and no long per-sample JS loops.
const NOISE = ctx.createBuffer(1, Math.floor(3.2 * SR), SR);
const fillNoise = (buf) => {
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = rand() * 2 - 1;
};
fillNoise(NOISE);

// ---------------------------------------------------------------- envelopes
// Every envelope starts and ends at exactly 0 -> no clicks at either edge.
const env = (g, t, peak, atk, dec) => {
  const a = Math.max(0.0015, atk), d = Math.max(0.015, dec);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  g.gain.linearRampToValueAtTime(0, t + a + d + 0.012);
};
// attack -> sustain -> exponential release that lands exactly on `end`
const sus = (g, t, peak, atk, rel, end) => {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + atk);
  g.gain.setValueAtTime(peak, Math.max(t + atk + 0.01, end - rel));
  g.gain.exponentialRampToValueAtTime(0.0001, end);
  g.gain.linearRampToValueAtTime(0, end + 0.015);
};
// rise / hold / fall, total = atk + hold + rel
const swell = (g, t, peak, atk, hold, rel) => {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + atk);
  g.gain.setValueAtTime(peak, t + atk + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + atk + hold + rel);
  g.gain.linearRampToValueAtTime(0, t + atk + hold + rel + 0.015);
};

// ============================================================================
// 1. INSTRUMENTS
// ============================================================================

// ---- 古筝 / guzheng pluck (Karplus-Strong, cached per pitch / length / damping)
const PLO = {};
const fillPluck = (buf, freq, fb) => {
  const d = buf.getChannelData(0);
  const n = d.length;
  const period = Math.max(2, Math.round(SR / freq));
  const line = new Float32Array(period);
  for (let i = 0; i < period; i++) line[i] = rand() * 2 - 1;
  let prev = 0, idx = 0, peak = 1e-6;
  const fadeFrom = Math.floor(n * 0.86);
  const fadeLen = Math.max(1, n - fadeFrom);
  for (let i = 0; i < n; i++) {
    const cur = line[idx];
    line[idx] = 0.5 * (cur + prev) * fb;      // each lap loses a little brightness
    prev = cur;
    idx = (idx + 1) % period;
    const s = i > fadeFrom ? cur * (1 - (i - fadeFrom) / fadeLen) : cur;
    d[i] = s;
    if (s > peak) peak = s; else if (-s > peak) peak = -s;
  }
  const g = 0.86 / peak;
  for (let i = 0; i < n; i++) d[i] *= g;
};
const pluck = (t, midi, lvl, o) => {
  const opt = o || {};
  const tail = opt.tail || 0.8;
  const fb = opt.mute ? 0.982 : 0.9975;            // muted = 清音 pluck, fast decay
  const key = midi + ':' + Math.round(tail * 20) + ':' + fb;
  if (!PLO[key]) {
    const b = ctx.createBuffer(1, Math.max(64, Math.round(tail * 1.06 * SR)), SR);
    fillPluck(b, hz(midi), fb);
    PLO[key] = b;
  }
  const s = ctx.createBufferSource();
  s.buffer = PLO[key];
  s.playbackRate.value = 1 + (rand() - 0.5) * 0.0016;
  const g = ctx.createGain(); g.gain.value = lvl;
  let head = s;
  if (opt.lp) {
    const f = ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.value = opt.lp; f.Q.value = 0.8;
    s.connect(f); head = f;
  }
  if (opt.pk) {                                     // resonant accent (S6)
    const f = ctx.createBiquadFilter(); f.type = 'peaking';
    f.frequency.value = opt.pk; f.gain.value = 6; f.Q.value = 1.6;
    head.connect(f); head = f;
  }
  const pn = ctx.createStereoPanner(); pn.pan.value = opt.pan || 0;
  head.connect(g); g.connect(pn); pn.connect(opt.bus || acc);
  if (opt.send) sendTo(g, opt.send);
  s.start(t);
};

// ---- 竹笛 bamboo flute: sine + 0.4 % vibrato + 2400 Hz breath, 60 ms attack
const flute = (t, midi, dur, lvl, panv) => {
  const f = hz(midi);
  const end = t + dur;
  const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
  const vib = ctx.createOscillator(); vib.type = 'sine'; vib.frequency.value = 4.3 + rand() * 0.9;
  const vg = ctx.createGain(); vg.gain.value = f * 0.004;
  vib.connect(vg); vg.connect(o.frequency);
  const breath = ctx.createBufferSource(); breath.buffer = NOISE; breath.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 0.9;
  const bg = ctx.createGain(); bg.gain.value = 0.34;
  breath.connect(bp); bp.connect(bg);
  const tone = ctx.createGain(); tone.gain.value = 1;
  o.connect(tone); bg.connect(tone);
  const g = ctx.createGain();
  sus(g, t, lvl, 0.06, 0.38, end);
  const pn = ctx.createStereoPanner(); pn.pan.value = panv || 0;
  tone.connect(g); g.connect(pn); pn.connect(mus);
  sendTo(g, 0.3);
  o.start(t); o.stop(end + 0.2); vib.start(t); vib.stop(end + 0.2);
  breath.start(t, 0); breath.stop(end + 0.2);
};

// ---- 弦乐/铺底 pad: 3 detuned saws + octave, lowpass, slow attack
const pad = (t, midis, end, totalPeak, o) => {
  const opt = o || {};
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
  lp.frequency.value = opt.lp || 1400; lp.Q.value = 0.5;
  const g = ctx.createGain();
  sus(g, t, totalPeak, opt.atk || 0.35, opt.rel || 0.6, end);
  const pn = ctx.createStereoPanner(); pn.pan.value = 0;
  lp.connect(g); g.connect(pn); pn.connect(mus);
  sendTo(g, 0.32);
  const det = [-7, 0, 7];
  // per-oscillator gain is normalised to 1 across the whole chord, so the shared
  // envelope stays the real peak of the pad (this used to be double-scaled).
  const unit = 1 / (3.2 * Math.max(1, midis.length));
  for (let i = 0; i < midis.length; i++) {
    const m = midis[i];
    for (let k = 0; k < 3; k++) {
      const osc = ctx.createOscillator(); osc.type = 'sawtooth';
      osc.frequency.value = hz(m);
      osc.detune.value = det[k];
      const og = ctx.createGain(); og.gain.value = unit;
      osc.connect(og); og.connect(lp);
      osc.start(t); osc.stop(end + 0.25);
    }
    const oct = ctx.createOscillator(); oct.type = 'sine';
    oct.frequency.value = hz(m) * 2;
    const og2 = ctx.createGain(); og2.gain.value = unit * 0.55;
    oct.connect(og2); og2.connect(lp);
    oct.start(t); oct.stop(end + 0.25);
  }
};

// ---- 大堂鼓 kick: FIXED 62 Hz sine (no sweep) + 220 Hz skin noise
const kick = (t, lvl, dec) => {
  const d = dec || 0.15;
  const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 62;
  const g = ctx.createGain(); env(g, t, lvl, 0.004, d);
  o.connect(g); g.connect(acc);
  o.start(t); o.stop(t + d + 0.08);
  const s = ctx.createBufferSource(); s.buffer = NOISE;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
  bp.frequency.value = 220; bp.Q.value = 1.1;
  const sg = ctx.createGain(); env(sg, t, lvl * 0.5, 0.002, 0.05);
  s.connect(bp); bp.connect(sg); sg.connect(acc);
  s.start(t, rand() * 1.8); s.stop(t + 0.12);
};

// ---- 军鼓-ish snare: 2200 Hz BP noise + short 190/330 Hz body
const snare = (t, lvl) => {
  const s = ctx.createBufferSource(); s.buffer = NOISE;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
  bp.frequency.value = 2200; bp.Q.value = 0.9;
  const g = ctx.createGain(); env(g, t, lvl, 0.002, 0.07);
  s.connect(bp); bp.connect(g); g.connect(acc);
  s.start(t, rand() * 1.6); s.stop(t + 0.14);
  const bs = [190, 330];
  for (let i = 0; i < 2; i++) {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = bs[i];
    const og = ctx.createGain(); env(og, t, lvl * 0.32, 0.002, 0.05 + i * 0.012);
    o.connect(og); og.connect(acc);
    o.start(t); o.stop(t + 0.11);
  }
};

// ---- 落重音 impact: 52 Hz FIXED sine + 240 Hz wood + 2600 Hz HP smack + hall
const impact = (t, lvl, o) => {
  const opt = o || {};
  const lowDec = opt.lowDec || 0.5;
  const hub = ctx.createGain(); hub.gain.value = 1; hub.connect(acc);
  sendTo(hub, opt.snd === undefined ? 0.34 : opt.snd);
  const lo = ctx.createOscillator(); lo.type = 'sine'; lo.frequency.value = 52;
  const loG = ctx.createGain(); env(loG, t, lvl, 0.006, lowDec);
  lo.connect(loG); loG.connect(hub);
  lo.start(t); lo.stop(t + lowDec + 0.1);
  const wd = ctx.createOscillator(); wd.type = 'triangle'; wd.frequency.value = 240;
  const wdG = ctx.createGain(); env(wdG, t, lvl * 0.30, 0.002, 0.075);
  wd.connect(wdG); wdG.connect(hub);
  wd.start(t); wd.stop(t + 0.16);
  const s = ctx.createBufferSource(); s.buffer = NOISE;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass';
  hp.frequency.value = 2600; hp.Q.value = 0.6;
  const sm = ctx.createGain(); env(sm, t, lvl * 0.20, 0.0015, 0.22);
  s.connect(hp); hp.connect(sm); sm.connect(hub);
  s.start(t, rand() * 1.6); s.stop(t + 0.3);
};

// ---- 吊镲 crash: 4200 Hz HP noise with an inharmonic resonance, long tail
const cymbal = (t, lvl, dec) => {
  const d = dec || 0.42;
  const s = ctx.createBufferSource(); s.buffer = NOISE;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4200;
  const pk = ctx.createBiquadFilter(); pk.type = 'peaking';
  pk.frequency.value = 7800; pk.Q.value = 3; pk.gain.value = 9;
  const g = ctx.createGain(); env(g, t, lvl, 0.004, d);
  s.connect(hp); hp.connect(pk); pk.connect(g); g.connect(acc);
  s.start(t, rand() * 1.6); s.stop(t + d + 0.1);
  sendTo(g, 0.28);
};

// ---- 钟 bell: FM, inharmonic 3.51 ratio, index decays exponentially
const bell = (t, midi, lvl, dec, idx) => {
  const f = hz(midi);
  const car = ctx.createOscillator(); car.type = 'sine'; car.frequency.value = f;
  const mod = ctx.createOscillator(); mod.type = 'sine'; mod.frequency.value = f * 3.51;
  const mg = ctx.createGain();
  const dev = f * 3.51 * (idx === undefined ? 1.2 : idx);
  mg.gain.setValueAtTime(dev, t);
  mg.gain.exponentialRampToValueAtTime(Math.max(0.6, dev * 0.004), t + dec * 0.7);
  mg.gain.linearRampToValueAtTime(0, t + dec * 0.95);
  mod.connect(mg); mg.connect(car.frequency);
  const g = ctx.createGain(); env(g, t, lvl, 0.004, dec);
  car.connect(g); g.connect(acc);
  sendTo(g, 0.26);
  car.start(t); car.stop(t + dec + 0.12);
  mod.start(t); mod.stop(t + dec + 0.12);
};

// ---- 马林巴 marimba: 1x + 4x + 9.2x partials (two pitched node pulses)
const marimba = (t, midi, lvl) => {
  const f = hz(midi);
  const rat = [1, 4, 9.2];
  const dec = [0.22, 0.06, 0.02];
  const amp = [1, 0.4, 0.2];
  for (let i = 0; i < 3; i++) {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * rat[i];
    const g = ctx.createGain(); env(g, t, lvl * amp[i], 0.003, dec[i]);
    o.connect(g); g.connect(acc);
    o.start(t); o.stop(t + dec[i] + 0.09);
  }
};

// ---- transition whoosh: band-passed noise sweep (mid/high only)
const whoosh = (t, dur, f0, f1, lvl, q) => {
  const s = ctx.createBufferSource(); s.buffer = NOISE;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = q || 1.2;
  bp.frequency.setValueAtTime(f0, t);
  bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(lvl, t + dur * 0.72);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.gain.linearRampToValueAtTime(0, t + dur + 0.02);
  s.connect(bp); bp.connect(g); g.connect(acc);
  s.start(t, rand() * 1.4); s.stop(t + dur + 0.08);
  sendTo(g, 0.22);
};

// ---- riser: brightness climbs (noise LP sweep) + optional upward sine (300->1200)
const riser = (t, dur, f0, f1, lvl, withTone) => {
  const s = ctx.createBufferSource(); s.buffer = NOISE;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 5;
  lp.frequency.setValueAtTime(f0, t);
  lp.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(lvl, t + dur * 0.88);
  g.gain.linearRampToValueAtTime(lvl * 0.5, t + dur);
  g.gain.linearRampToValueAtTime(0, t + dur + 0.03);
  s.connect(lp); lp.connect(g); g.connect(acc);
  s.start(t, rand() * 1.4); s.stop(t + dur + 0.1);
  if (withTone) {
    const o = ctx.createOscillator(); o.type = 'sine';       // upward only, never a low sweep
    o.frequency.setValueAtTime(300, t);
    o.frequency.exponentialRampToValueAtTime(1200, t + dur);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.linearRampToValueAtTime(lvl * 0.5, t + dur * 0.9);
    og.gain.linearRampToValueAtTime(0.0001, t + dur);
    og.gain.linearRampToValueAtTime(0, t + dur + 0.02);
    o.connect(og); og.connect(acc);
    o.start(t); o.stop(t + dur + 0.08);
  }
};

// ---- downlifter: brightness falls, pitch never moves (ban-safe)
const downLifter = (t, dur, f0, f1, lvl) => {
  const s = ctx.createBufferSource(); s.buffer = NOISE;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.9;
  lp.frequency.setValueAtTime(f0, t);
  lp.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(lvl, t + 0.07);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.gain.linearRampToValueAtTime(0, t + dur + 0.02);
  s.connect(lp); lp.connect(g); g.connect(acc);
  s.start(t, rand() * 1.4); s.stop(t + dur + 0.08);
};

// ---- tick: typewriter key / UI blip / closed hat
const tick = (t, lvl, kind) => {
  const s = ctx.createBufferSource(); s.buffer = NOISE;
  const f = ctx.createBiquadFilter();
  let dec = 0.03;
  if (kind === 'hat') { f.type = 'highpass'; f.frequency.value = 7000; dec = 0.012; }
  else if (kind === 'ui') { f.type = 'bandpass'; f.frequency.value = 2100; f.Q.value = 2.0; dec = 0.024; }
  else { f.type = 'bandpass'; f.frequency.value = 1380; f.Q.value = 1.4; dec = 0.032; }
  const g = ctx.createGain(); env(g, t, lvl, 0.0015, dec);
  s.connect(f); f.connect(g); g.connect(acc);
  s.start(t, rand() * 2.2); s.stop(t + dec + 0.08);
};

// ---- air wash (rice-paper breath), used for cuts and transitions
const airWash = (t, dur, lvl, panv) => {
  const s = ctx.createBufferSource(); s.buffer = NOISE; s.loop = true;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 220;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500; lp.Q.value = 0.6;
  const g = ctx.createGain();
  swell(g, t, lvl, dur * 0.35, dur * 0.2, dur * 0.45);
  const pn = ctx.createStereoPanner(); pn.pan.value = panv || 0;
  s.connect(hp); hp.connect(lp); lp.connect(g); g.connect(pn); pn.connect(mus);
  sendTo(g, 0.3);
  s.start(t, rand() * 1.2); s.stop(t + dur + 0.1);
};

// ---- paper-noise floor (-42 dB) and room tone (-46 dB), both looped
const floorLoop = (t, dur, lvl, cut, bus) => {
  const s = ctx.createBufferSource(); s.buffer = NOISE; s.loop = true;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 130;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cut; lp.Q.value = 0.5;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(lvl, t + 0.28);
  g.gain.setValueAtTime(lvl, Math.max(t + 0.3, t + dur - 0.4));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.gain.linearRampToValueAtTime(0, t + dur + 0.02);
  s.connect(hp); hp.connect(lp); lp.connect(g); g.connect(bus);
  s.start(t, rand() * 1.0); s.stop(t + dur + 0.06);
};

// ---- steady sine sub (55 / 73.42 / 110 Hz) — pitch never moves
const sub = (t, freq, end, lvl, atk, rel) => {
  const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
  const h = ctx.createOscillator(); h.type = 'sine'; h.frequency.value = freq * 2;
  const hg = ctx.createGain(); hg.gain.value = 0.25;
  const g = ctx.createGain();
  sus(g, t, lvl, atk || 0.4, rel || 0.6, end);
  o.connect(g); h.connect(hg); hg.connect(g); g.connect(mus);
  o.start(t); o.stop(end + 0.25); h.start(t); h.stop(end + 0.25);
};

// ---- metallic shimmer (tape/air + partials), always on the accent bus
const shimmer = (t, dur, lvl, base) => {
  const rat = [2, 3.02, 4.7];
  for (let i = 0; i < 3; i++) {
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.value = (base || 660) * rat[i] * (1 + (rand() - 0.5) * 0.005);
    const g = ctx.createGain();
    env(g, t, lvl / (i + 2), 0.02 + i * 0.012, dur * (0.85 - i * 0.15));
    o.connect(g); g.connect(acc);
    sendTo(g, 0.34);
    o.start(t); o.stop(t + dur + 0.12);
  }
  const s = ctx.createBufferSource(); s.buffer = NOISE;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5200;
  const g2 = ctx.createGain(); env(g2, t, lvl * 0.6, 0.03, dur * 0.7);
  s.connect(hp); hp.connect(g2); g2.connect(acc);
  s.start(t, rand() * 1.4); s.stop(t + dur + 0.1);
};

// ---- ink brush / 墨晕 spread: band-passed noise sweep downward
const brush = (t, dur, lvl, f0, f1) => {
  const s = ctx.createBufferSource(); s.buffer = NOISE;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8;
  bp.frequency.setValueAtTime(f0, t);
  bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(lvl, t + 0.035);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.gain.linearRampToValueAtTime(0, t + dur + 0.02);
  s.connect(bp); bp.connect(g); g.connect(acc);
  s.start(t, rand() * 1.4); s.stop(t + dur + 0.08);
  sendTo(g, 0.35);
};

// ============================================================================
// 2. SECTION MATERIAL (non-beat glue). Beat onsets live in the loop at the end.
// ============================================================================

// ---- 1) 0.0–4.1 悬念 ------------------------------------------------------
floorLoop(at(0.04), 3.66, 0.008, 1100, mus);                       // -42 dB paper floor
pluck(at(0.30), 50, 0.075, { tail: 1.5, bus: mus, send: 0.42, pan: -0.22 });  // D3
pluck(at(1.85), 57, 0.062, { tail: 1.15, bus: mus, send: 0.42, pan: 0.18 });  // A3
pluck(at(2.90), 62, 0.05, { tail: 0.75, bus: mus, send: 0.4, pan: -0.1 });    // D4
// (typing ticks 0.55/1.05/1.55/2.05/2.55 come from the beat loop, -30 dBFS)

// ---- 2) 4.1–8.9 时间轴 ---------------------------------------------------
flute(at(4.60), 62, 3.95, 0.048, -0.16);        // D4, 0.6 s swell in
flute(at(4.75), 69, 3.75, 0.043, 0.16);          // A4 (fifth, modal — no pop 4-3)
sub(at(7.40), 73.42, at(8.86), 0.028, 0.9, 0.3); // D2 ink drone under the timeline

// ---- 3) 8.9–15.2 关系网 --------------------------------------------------
airWash(at(9.05), 2.4, 0.006, 0.25);            // paper air under the network
const PULSE = [50, 57, 62, 66, 69, 66, 62, 57]; // muted 8th pluck pattern, 100 BPM
for (let i = 0; i < 9; i++) {
  const tt = at(12.2 + i * 0.3);
  const fade = i > 6 ? (9 - i) / 3 : 1;         // breathe out by 14.9
  pluck(tt, PULSE[i % 8], 0.026 * fade, { tail: 0.42, mute: true, lp: 1500, pan: i % 2 ? 0.14 : -0.14, bus: mus, send: 0.15 });
}
flute(at(12.30), 62, 2.25, 0.045, -0.2);
flute(at(12.45), 69, 2.1, 0.04, 0.2);

// ---- 4) 15.2–16.9 墨晕转场 -----------------------------------------------
kick(at(15.95), 0.16, 0.22);                    // 15.95 paper lands: single deep drum
impact(at(15.95), 0.3, { lowDec: 0.3, snd: 0.2 }); // short so 16.2 stays breathable

// ---- 5) 16.9–24.45 产品对话（轻电子律动）---------------------------------
const ARP_S5 = [50, 57, 62, 66, 69, 66, 62, 57];
for (let i = 0; i < 24; i++) {                  // eighth-note grid, 100 BPM, ends 23.8
  const tt = at(16.9 + i * 0.3);
  pluck(tt, ARP_S5[i % 8], (i % 4 === 0 ? 0.032 : 0.024), { tail: 0.36, mute: true, lp: 1700, pan: i % 2 ? 0.12 : -0.12, bus: mus, send: 0.16 });
}
for (let i = 0; i < 22; i++) tick(at(17.2 + i * 0.3), 0.016, 'hat');   // light closed hats
sub(at(16.95), 110, at(24.08), 0.028, 0.5, 0.4);                       // warm, steady, no sweep
sub(at(16.95), 55, at(24.08), 0.042, 0.6, 0.4);
airWash(at(21.40), 2.55, 0.005, 0);              // "searching" high air, out by 23.95
riser(at(23.50), 0.62, 300, 1200, 0.075, true);  // mid-high only, peaks 24.05 -> 0.3 s gap

// ---- 6) 24.45–27.2 据史记作答 --------------------------------------------
pad(at(24.55), [50, 57, 62, 66], at(27.15), 0.09, { atk: 0.35, rel: 0.7, lp: 1400 });
pluck(at(24.95), 62, 0.115, { tail: 1.25, pk: 1050, send: 0.45, bus: acc });  // resonant guzheng accent

// ---- 7) 27.2–34.6 史引面板 / 联动 ----------------------------------------
pad(at(27.30), [50, 57, 62, 69], at(34.55), 0.085, { atk: 0.5, rel: 0.9, lp: 1300 });
sub(at(27.30), 73.42, at(35.30), 0.024, 0.9, 0.7);            // low sub gone by 35.3
for (let i = 0; i < 21; i++) {                                // 27.5 -> 33.5 eighths
  const tt = at(27.5 + i * 0.3);
  const m = [50, 57, 62, 69, 74, 69, 62, 66][i % 8];
  pluck(tt, m, i > 17 ? 0.014 : 0.022, { tail: 0.4, lp: 3200, pan: i % 2 ? 0.16 : -0.16, bus: mus, send: 0.2 });
}
for (let k = 0; k < 3; k++) {                                 // light groove, 1 & 3 / 2 & 4
  const bar = at(27.5 + k * 2.4);
  kick(bar, 0.17, 0.16);
  if (k < 2) {
    kick(at(27.5 + k * 2.4 + 1.2), 0.14, 0.16);
    snare(at(27.5 + k * 2.4 + 0.6), 0.055);
    snare(at(27.5 + k * 2.4 + 1.8), 0.05);
  } else {
    kick(bar + 1.2, 0.11, 0.14);                             // 33.5, last kick
  }
}

// ---- 8) 34.6–36.0 转暗 ---------------------------------------------------
// drums stop; pad + sub decay on their own tails; 35.4–36.0 keeps only air.
airWash(at(35.45), 0.5, 0.003, 0);                            // near-silence breath

// ---- 9) 36.0–39.0 落印 ---------------------------------------------------
// 36.85 impact is dispatched by the beat loop (biggest moment of the film).

// ---- 10) 39.0–44.6 片尾 --------------------------------------------------
floorLoop(at(37.90), 6.62, 0.0045, 900, mus);                 // very quiet room tone
pad(at(39.00), [50, 57, 62, 66, 71], at(duration - 0.10), 0.105, { atk: 1.5, rel: 1.3, lp: 1200 });
pad(at(39.20), [62, 69, 74], at(42.40), 0.045, { atk: 2.0, rel: 1.4, lp: 2600 });

// ---- sub-beat visual cues (`cues`) that are not already in `beats`
// Guarded against doubling: anything within 12 ms of a beat is left to the loop.
for (let i = 0; i < cues.length; i++) {
  const c = cues[i];
  let dup = false;
  for (let j = 0; j < beats.length; j++) if (Math.abs(beats[j].time - c.time) < 0.012) dup = true;
  if (!dup && c.time < duration - 0.5) tick(at(c.time), 0.018, c.type === 'rise' ? 'ui' : 'type');
}

// ---- cuts: a barely-there paper breath at each edit, so no cut is ever "soft"
for (let i = 1; i < cuts.length; i++) airWash(at(cuts[i]), 0.45, 0.005, i % 2 ? 0.3 : -0.3);

// ============================================================================
// 3. BEAT DISPATCH — runs last so accents win over the bed.
// Every entry in `beats` is dispatched here at exactly b.time (no grid, no
// rounding, no lookahead offset). Each type has a final else, so no beat can
// fall through silently.
// ============================================================================
const NET = [62, 66, 69, 71, 69];        // 9.45 -> 11.45 network nodes, climb then ease down
const ARP_TAG = [62, 66, 69, 71, 74];    // 38.4 tagline arpeggio

for (let i = 0; i < beats.length; i++) {
  const bt = beats[i];
  const t = at(bt.time);                 // exact onset
  const p = bt.power;
  const ty = bt.type;

  if (ty === 'impact') {
    if (bt.time < 7.0) {
      // 6.55 光点定格鸿门宴 — big hall drum, climax bus fill
      impact(t, 0.29 + 0.08 * p, { lowDec: 0.55, snd: 0.36 });
      cymbal(t, 0.07 + 0.03 * p, 0.5);
      bell(t, 81, 0.045, 1.3, 1.0);
    } else if (bt.time < 9.0) {
      // 8.9 刘邦中心登场 — drum + pluck unison
      impact(t, 0.24 + 0.08 * p, { lowDec: 0.42, snd: 0.3 });
      pluck(t, 50, 0.115, { tail: 1.15, send: 0.35, bus: acc });
      pluck(t, 62, 0.08, { tail: 1.15, send: 0.35, bus: acc, pan: 0.12 });
      marimba(t, 69, 0.018);
    } else if (bt.time < 25.0) {
      // 24.45 据史记作答 — big low drum + air burst + cymbal
      impact(t, 0.26 + 0.14 * p, { lowDec: 0.62, snd: 0.4 });
      cymbal(t, 0.10, 0.7);
      bell(t, 62, 0.04, 1.4, 0.9);
    } else if (bt.time < 29.0) {
      // 28.25 面板落位 — solid, shorter than 24.45
      impact(t, 0.24 + 0.13 * p, { lowDec: 0.5, snd: 0.34 });
      cymbal(t, 0.06, 0.45);
    } else {
      // 36.85 印章落印 — the biggest moment of the film
      impact(t, 0.30 + 0.17 * p, { lowDec: 0.85, snd: 0.5 });
      cymbal(t, 0.10 + 0.05 * p, 0.85);
      bell(t, 57, 0.075, 2.5, 1.6);      // 编钟: 220 Hz carrier, 3.51 ratio, ~2.5 s ring
      bell(t, 45, 0.035, 1.8, 1.1);      // sub-octave body under the bell
    }
  } else if (ty === 'rise') {
    if (bt.time < 3.4) {
      // 0.55 第一个字落下 — text lands: key tick + a sliver of air
      tick(t, 0.03 + 0.04 * p, 'type');
      airWash(t, 0.42, 0.016, -0.12);
    } else if (bt.time < 6.0) {
      // 4.1 毛笔金线生长 — ascending guzheng glissando (A3 -> B5)
      for (let k = 0; k < 12; k++) {
        const m = [57, 59, 62, 64, 66, 69, 71, 74, 76, 78, 81, 83][k];
        pluck(t + k * 0.028, m, 0.024 + k * 0.0026, { tail: 0.55, send: 0.42, pan: -0.35 + k * 0.06, bus: acc });
      }
      tick(t, 0.03, 'ui');
      airWash(t, 0.55, 0.02, 0);
    } else if (bt.time < 16.0) {
      // 12.2 关系网连线成网 — fast pentatonic run + light air whoosh
      for (let k = 0; k < 9; k++) {
        pluck(t + k * 0.03, [62, 64, 66, 69, 71, 74, 76, 78, 81][k], 0.038 + k * 0.0035, { tail: 0.5, send: 0.4, bus: acc });
      }
      whoosh(t, 0.42, 700, 5200, 0.08, 0.9);
      cymbal(t, 0.035, 0.5);
    } else if (bt.time < 21.0) {
      // 18.35 史令开口 — single pluck
      pluck(t, 62, 0.085, { tail: 0.85, send: 0.32, bus: acc });
      tick(t, 0.02, 'ui');
    } else if (bt.time < 24.0) {
      // 21.35 检索开始 — sparse "searching" ticks (riser is scheduled at 23.50)
      const offs = [0.4, 0.8, 1.7, 2.1, 2.55];
      for (let k = 0; k < offs.length; k++) tick(t + offs[k], 0.012, 'ui');
      tick(t, 0.02, 'ui');
    } else if (bt.time < 30.0) {
      // 27.2 史引面板滑出 — panel whoosh rising into 28.25
      whoosh(t, 0.55, 420, 3600, 0.28, 1.4);
      for (let k = 0; k < 4; k++) pluck(t + k * 0.045, [62, 66, 69, 71][k], 0.02, { tail: 0.4, mute: true, bus: acc });
    } else {
      // 36.1 印章浮现 — soft rising shimmer (brightness only, no low end)
      riser(t, 0.55, 1200, 7000, 0.07, false);
      pluck(t, 81, 0.03, { tail: 0.5, send: 0.4, bus: acc });
    }
  } else if (ty === 'hit') {
    if (bt.time < 3.4) {
      // 1.05 / 1.55 / 2.05 / 2.55 — typewriter key, about -30 dBFS
      tick(t, 0.022 + 0.05 * p, 'type');
    } else if (bt.time < 6.4) {
      // 5.05 光点启程 — soft drum heart (fixed 62 Hz + skin), no sweep
      kick(t, 0.15, 0.16);
      pluck(t, 57, 0.05, { tail: 0.7, send: 0.3, bus: acc, pan: -0.15 });
    } else if (bt.time < 7.05) {
      // 6.9 节点标注浮现 — airy bell
      bell(t, 81, 0.08, 1.5, 1.1);
      bell(t, 76, 0.04, 1.1, 0.7);
    } else if (bt.time < 7.5) {
      // 7.2 介绍文字浮现 — shimmer
      shimmer(t, 0.9, 0.055, 660);
    } else if (bt.time < 15.2) {
      // 9.45…11.45 关系网节点 — one pluck per node, climbing then easing down
      const k = Math.max(0, Math.min(4, Math.round((bt.time - 9.45) / 0.5)));
      pluck(t, NET[k], 0.15 + 0.06 * p, { tail: 1.0, send: 0.38, bus: acc, pan: k % 2 ? 0.2 : -0.2 });
      tick(t, 0.012, 'ui');
    } else if (bt.time < 17.0) {
      // 16.55 聊天界面落位 — dry, short, so the 16.35–16.85 breath survives
      pluck(t, 57, 0.07, { tail: 0.34, mute: true, send: 0.1, bus: acc });
      tick(t, 0.018, 'ui');
    } else if (bt.time < 21.4) {
      if (bt.time > 19.4 && bt.time < 19.8) {
        // 19.55 第一条引文 — small citation bell
        bell(t, 74, 0.07, 1.1, 0.9);
      } else {
        // 17.05 用户第一问 / 19.95 用户第二问 — soft UI tick + pluck
        tick(t, 0.022, 'ui');
        pluck(t, bt.time < 19 ? 62 : 71, 0.08, { tail: 0.6, mute: true, lp: 2600, send: 0.2, bus: acc });
      }
    } else if (bt.time < 24.0) {
      tick(t, 0.02, 'ui');
    } else if (bt.time < 27.0) {
      // 25.95 引文徽章 — citation bell
      bell(t, 74, 0.085, 1.6, 1.0);
      pluck(t, 62, 0.035, { tail: 0.7, send: 0.25, bus: acc });
    } else if (bt.time < 30.0) {
      // 29.9 问答联动高亮 — metallic shimmer: tape/air + bell
      shimmer(t, 1.1, 0.065, 880);
      bell(t, 78, 0.05, 1.0, 1.3);
    } else if (bt.time < 34.6) {
      // 31.6 / 32.6 节点脉冲 — two different pitched mallets
      marimba(t, bt.time < 32 ? 69 : 74, 0.085);
      tick(t, 0.01, 'hat');
    } else if (bt.time < 38.0) {
      // 37.15 印泥晕开 — ink-spread brush (0.4 s)
      brush(t, 0.4, 0.07, 3000, 700);
    } else if (bt.time < 39.5) {
      // 38.4 标语落定 — guzheng arpeggio
      for (let k = 0; k < 5; k++) {
        pluck(t + k * 0.055, ARP_TAG[k], 0.1 - k * 0.007, { tail: 1.1, send: 0.36, bus: acc, pan: -0.2 + k * 0.1 });
      }
      tick(t, 0.014, 'ui');
    } else {
      // 40.0 地址浮现 — soft high bell
      bell(t, 83, 0.058, 1.8, 0.7);
      bell(t, 78, 0.028, 1.2, 0.5);
    }
  } else if (ty === 'drop') {
    if (bt.time < 4.0) {
      // 3.3 文字淡出 — soft exhale, brightness falls only
      downLifter(t, 0.4, 5200, 900, 0.085);
      tick(t, 0.022, 'type');
    } else if (bt.time < 30.0) {
      // 22.55 Toast 弹出 — soft bell "ding"
      bell(t, 78, 0.055, 0.9, 0.6);
      tick(t, 0.016, 'ui');
    } else {
      // 43.6 收束淡出 — closing marker only; nothing new after this instant
      airWash(t, 0.82, 0.018, 0);
      pluck(t, 50, 0.03, { tail: 0.82, mute: true, lp: 900, bus: mus, send: 0.3 });
      sub(t, 73.42, at(44.42), 0.02, 0.05, 0.4);
    }
  } else if (ty === 'whoosh') {
    if (bt.time < 30.0) {
      // 15.3 墨晕转场 — mid/high band-pass sweep 500 -> 6000 (never low)
      whoosh(t, 0.35, 500, 6000, 0.24, 1.3);
    } else {
      // 34.7 转暗下沉 — downlifter, brightness only, no pitch drop
      downLifter(t, 0.65, 6000, 400, 0.19);
    }
  } else if (ty === 'swell') {
    airWash(t, 0.9, 0.028, 0);
  } else {
    // catch-all: an unknown type still gets a real onset at exactly t
    tick(t, 0.03, 'ui');
  }
}


// end of score — last scheduled sound decays by ~44.5 s