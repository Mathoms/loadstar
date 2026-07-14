/**
 * Best-effort version / compatibility detection for uploaded JMeter (.jmx) and
 * k6 (.js) scripts. Advisory only — never blocks a run. Catches common
 * known-old-format markers and removed components so the user gets a heads-up;
 * anything missed surfaces as the engine's own error at run time.
 * Installed engines: JMeter 5.6.3, k6 0.53.
 */
const JMETER_MIN = "5.0";
const K6_MIN = "0.40";

export function detectEngine(script) {
  const s = (script || "").trimStart();
  if (s.startsWith("<?xml") || s.includes("<jmeterTestPlan")) return "jmeter";
  if (/from\s+['"]k6['"]/.test(s) || /export\s+default\s+function/.test(s)) return "k6";
  return null;
}

function jmeterCreatedVersion(script) {
  const created = script.match(/created with (?:Apache )?JMeter\s+([\d.]+)/i);
  return created ? created[1] : null;
}

export function checkScript(script, declaredEngine) {
  const engine = declaredEngine || detectEngine(script);
  const warnings = [];
  if (!script || !script.trim()) {
    return { engine, warnings: ["The uploaded script appears to be empty."] };
  }
  if (engine === "jmeter") {
    const removed = [
      ["MongoDB sampler", /MongoDB(?:Sampler|Source|ScriptSampler)/],
      ["Monitor Results listener", /MonitorHealthVisualizer|MonitorResults/],
      ["Distribution/RespTime Graph", /RespTimeGraphVisualizer|DistributionGraphVisualizer/],
      ["SOAP/XML-RPC Request", /SoapSampler|WebServiceSOAPSampler/],
      ["Mailer Visualizer (old)", /MailerModel/],
    ];
    for (const [name, re] of removed) {
      if (re.test(script)) warnings.push(`Uses "${name}", removed in modern JMeter. May fail on 5.6.3 — consider updating the script.`);
    }
    const created = jmeterCreatedVersion(script);
    if (created && compareVersions(created, JMETER_MIN) < 0) {
      warnings.push(`Script targets JMeter ${created}; installed engine is 5.6.3 (minimum supported ${JMETER_MIN}). It will run, but review results.`);
    }
    if (/<jmeterTestPlan[^>]*version="1\.[01]"/.test(script)) {
      warnings.push("Old test-plan format detected; authored for an older JMeter. Should still load — review before relying on results.");
    }
  } else if (engine === "k6") {
    if (!/import\s+.*from\s+['"]k6\/http['"]/.test(script) && /require\(['"]k6['"]\)/.test(script)) {
      warnings.push("Uses CommonJS require(); modern k6 uses ES modules (import). May need updating.");
    }
    const legacy = [
      ["k6/x extension import", /from\s+['"]k6\/x\//],
    ];
    for (const [name, re] of legacy) {
      if (re.test(script)) warnings.push(`Uses "${name}", which may behave differently on k6 0.53. Review if the run errors.`);
    }
  } else {
    warnings.push("Could not identify this as a JMeter (.jmx) or k6 (.js) script. It will run with the selected engine, but may not work.");
  }
  return { engine, warnings };
}

export function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

export { JMETER_MIN, K6_MIN };
