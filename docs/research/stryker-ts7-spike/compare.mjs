// Compare the Stryker plan dump (real mutants) with the Oxc estimate.
// Usage: node compare.mjs <plan.json> <estimate.json> <root>
import { readFileSync } from "node:fs";
import path from "node:path";

const [planPath, estPath, root] = process.argv.slice(2);
const { plans, timeSpentAllTests } = JSON.parse(readFileSync(planPath, "utf8"));
const est = JSON.parse(readFileSync(estPath, "utf8"));

const real = {};
const realByMutator = {};
let statics = 0, staticTime = 0, runtimeTime = 0, runPlans = 0, early = {};
for (const p of plans) {
  const f = path.relative(root, p.file);
  real[f] = (real[f] ?? 0) + 1;
  realByMutator[p.mutator] = (realByMutator[p.mutator] ?? 0) + 1;
  if (p.plan === "Run") {
    runPlans++;
    if (p.static) { statics++; staticTime += p.netTime; } else runtimeTime += p.netTime;
  } else {
    const k = `${p.plan}:${p.status}${p.static ? ":static" : ""}`;
    early[k] = (early[k] ?? 0) + 1;
  }
}
const allStatic = plans.filter((p) => p.static).length;
console.log(`mutants ${plans.length}; run plans ${runPlans}; early results ${JSON.stringify(early)}`);
console.log(`static (all plans) ${allStatic} = ${(100 * allStatic / plans.length).toFixed(1)}%; static run plans ${statics} = ${(100 * statics / runPlans).toFixed(1)}% of run plans`);
console.log(`dry run all-tests time ${(timeSpentAllTests / 1000).toFixed(1)} s; planner estimate: static ${(staticTime / 1000 / 3600).toFixed(2)} h (${(staticTime / statics / 1000).toFixed(1)} s each), runtime ${(runtimeTime / 1000 / 3600).toFixed(2)} h; static share of time ${(100 * staticTime / (staticTime + runtimeTime)).toFixed(1)}%`);

const files = [...new Set([...Object.keys(real), ...Object.keys(est)])];
let sumReal = 0, sumEst = 0, exact = 0;
const errs = [];
for (const f of files) {
  const r = real[f] ?? 0, e = est[f]?.total ?? 0;
  sumReal += r; sumEst += e;
  if (r === e) exact++;
  errs.push({ f, r, e, abs: Math.abs(e - r), pct: r ? Math.abs(e - r) / r : e ? 1 : 0 });
}
const pcts = errs.map((x) => x.pct).sort((a, b) => a - b);
const q = (p) => (100 * pcts[Math.min(pcts.length - 1, Math.floor(p * pcts.length))]).toFixed(1);
console.log(`files ${files.length}; total real ${sumReal}, estimate ${sumEst} (${(100 * (sumEst - sumReal) / sumReal).toFixed(2)}%)`);
console.log(`per-file exact ${exact}/${files.length}; abs % error median ${q(0.5)}%, p90 ${q(0.9)}%, max ${q(1)}%`);
console.log(`files within ±5%: ${errs.filter((x) => x.pct <= 0.05).length}, within ±10%: ${errs.filter((x) => x.pct <= 0.1).length}`);
console.log("worst files:", errs.sort((a, b) => b.abs - a.abs).slice(0, 5).map((x) => `${x.f} real ${x.r} est ${x.e}`).join("; "));
const estByMutator = {};
for (const v of Object.values(est)) for (const [m, n] of Object.entries(v.byMutator)) estByMutator[m] = (estByMutator[m] ?? 0) + n;
console.log("per mutator (real/est):", [...new Set([...Object.keys(realByMutator), ...Object.keys(estByMutator)])]
  .sort().map((m) => `${m} ${realByMutator[m] ?? 0}/${estByMutator[m] ?? 0}`).join(", "));
