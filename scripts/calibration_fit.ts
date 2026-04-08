import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

type Row = { confidence: number; label: 0 | 1 };

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function clamp(p: number): number {
  return Math.min(1 - 1e-6, Math.max(1e-6, p));
}

function toLogit(conf: number): number {
  const p = clamp(conf / 100);
  return Math.log(p / (1 - p));
}

function calibrate(conf: number, temperature: number): number {
  const logit = toLogit(conf) / temperature;
  return sigmoid(logit) * 100;
}

function nll(rows: Row[], temperature: number): number {
  let loss = 0;
  for (const r of rows) {
    const p = clamp(calibrate(r.confidence, temperature) / 100);
    loss += -(r.label * Math.log(p) + (1 - r.label) * Math.log(1 - p));
  }
  return loss / Math.max(1, rows.length);
}

function ece(rows: Row[], temperature: number, bins = 10): number {
  let total = 0;
  for (let b = 0; b < bins; b++) {
    const lo = b / bins;
    const hi = (b + 1) / bins;
    const bucket = rows.filter((r) => {
      const p = calibrate(r.confidence, temperature) / 100;
      return p >= lo && p < hi;
    });
    if (bucket.length === 0) continue;
    const acc = bucket.reduce((a, r) => a + r.label, 0) / bucket.length;
    const conf = bucket.reduce((a, r) => a + calibrate(r.confidence, temperature) / 100, 0) / bucket.length;
    total += (bucket.length / rows.length) * Math.abs(acc - conf);
  }
  return total;
}

function main() {
  const input = join(process.cwd(), "research", "calibration", "confidence_samples.jsonl");
  const lines = readFileSync(input, "utf-8")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
  const rows: Row[] = lines.map((l) => {
    const o = JSON.parse(l);
    return { confidence: Number(o.confidence), label: Number(o.label) === 1 ? 1 : 0 };
  });

  let bestT = 1;
  let best = Number.POSITIVE_INFINITY;
  for (let t = 0.6; t <= 3.0; t += 0.02) {
    const loss = nll(rows, t);
    if (loss < best) {
      best = loss;
      bestT = Number(t.toFixed(2));
    }
  }

  const beforeECE = ece(rows, 1.0);
  const afterECE = ece(rows, bestT);
  const finalT = afterECE <= beforeECE ? bestT : 1.0;
  const finalECE = ece(rows, finalT);

  const out = {
    method: "temperature_scaling",
    temperature: finalT,
    samples: rows.length,
    ece_before: Number(beforeECE.toFixed(4)),
    ece_after: Number(finalECE.toFixed(4)),
    improved: finalECE <= beforeECE,
    fitted_at: new Date().toISOString(),
  };

  const outPath = join(process.cwd(), "decision_manager", "confidence_calibration.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`[fit] wrote calibration -> ${outPath}`);
  console.log(out);
}

main();

