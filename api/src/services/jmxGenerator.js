/**
 * Generates a JMeter 5.x JMX test plan from a simple test definition.
 * This is Loadstar's core UX win: users describe intent (mode, users,
 * duration) and never touch JMeter's GUI or raw XML.
 *
 * Modes:
 *  - load  : ramp to N users, hold for duration
 *  - stress: ramp continuously across the whole duration (find the ceiling)
 *  - spike : baseline 20% of users, then a delayed burst of the remaining 80%
 *  - soak  : same shape as load; pair with a long duration to surface leaks
 */

const esc = (s = "") =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** The WHATWG URL parser percent-encodes { and }, which breaks JMeter
 *  ${variable} placeholders in paths — restore them. */
const unbrace = (s = "") => s.replaceAll("%7B", "{").replaceAll("%7D", "}").replaceAll("%24", "$");

/** CSV Data Set Config: header row supplies variable names; each virtual user
 *  reads the next row and loops back to the top when the file ends. */
function csvDataSet(csvPath) {
  return `
      <CSVDataSet guiclass="TestBeanGUI" testclass="CSVDataSet" testname="CSV parameters" enabled="true">
        <stringProp name="filename">${esc(csvPath)}</stringProp>
        <stringProp name="fileEncoding">UTF-8</stringProp>
        <stringProp name="variableNames"></stringProp>
        <boolProp name="ignoreFirstLine">true</boolProp>
        <stringProp name="delimiter">,</stringProp>
        <boolProp name="quotedData">true</boolProp>
        <boolProp name="recycle">true</boolProp>
        <boolProp name="stopThread">false</boolProp>
        <stringProp name="shareMode">shareMode.all</stringProp>
      </CSVDataSet>
      <hashTree/>`;
}

function httpSampler(test, url) {
  const bodyBlock =
    test.method !== "GET" && test.body
      ? `<boolProp name="HTTPSampler.postBodyRaw">true</boolProp>
        <elementProp name="HTTPsampler.Arguments" elementType="Arguments">
          <collectionProp name="Arguments.arguments">
            <elementProp name="" elementType="HTTPArgument">
              <boolProp name="HTTPArgument.always_encode">false</boolProp>
              <stringProp name="Argument.value">${esc(test.body)}</stringProp>
              <stringProp name="Argument.metadata">=</stringProp>
            </elementProp>
          </collectionProp>
        </elementProp>`
      : `<elementProp name="HTTPsampler.Arguments" elementType="Arguments">
          <collectionProp name="Arguments.arguments"/>
        </elementProp>`;

  const headerEntries = Object.entries(test.headers || {})
    .map(
      ([k, v]) => `<elementProp name="" elementType="Header">
              <stringProp name="Header.name">${esc(k)}</stringProp>
              <stringProp name="Header.value">${esc(v)}</stringProp>
            </elementProp>`
    )
    .join("\n            ");

  return `
      <HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy" testname="${esc(test.name)}" enabled="true">
        ${bodyBlock}
        <stringProp name="HTTPSampler.domain">${esc(url.hostname)}</stringProp>
        <stringProp name="HTTPSampler.port">${url.port || (url.protocol === "https:" ? 443 : 80)}</stringProp>
        <stringProp name="HTTPSampler.protocol">${url.protocol.replace(":", "")}</stringProp>
        <stringProp name="HTTPSampler.path">${esc(unbrace(url.pathname + url.search))}</stringProp>
        <stringProp name="HTTPSampler.method">${esc(test.method || "GET")}</stringProp>
        <boolProp name="HTTPSampler.follow_redirects">true</boolProp>
        <boolProp name="HTTPSampler.use_keepalive">true</boolProp>
        <stringProp name="HTTPSampler.connect_timeout">10000</stringProp>
        <stringProp name="HTTPSampler.response_timeout">30000</stringProp>
      </HTTPSamplerProxy>
      <hashTree>
        <HeaderManager guiclass="HeaderPanel" testclass="HeaderManager" testname="Headers" enabled="true">
          <collectionProp name="HeaderManager.headers">
            ${headerEntries}
          </collectionProp>
        </HeaderManager>
        <hashTree/>
      </hashTree>`;
}


/** Build one JMeter HTTP sampler from an explicit request spec against a base URL. */
/** Think time: a Flow Control Action (pause) with a UniformRandomTimer child.
 *  Pause actions emit no sample results, so metrics stay clean. Integers only —
 *  no ${} sequences, which JavaScript template literals would interpolate. */
function thinkTimeAction(req) {
  const base = Number(req.think_time_ms) > 0 ? Number(req.think_time_ms) : 0;
  if (!base) return "";
  const jitPct = Number(req.think_time_jitter_pct) > 0 ? Math.min(Number(req.think_time_jitter_pct), 90) : 0;
  const jit = jitPct / 100;
  const floor = Math.max(0, Math.round(base * (1 - jit)));
  const range = Math.max(0, Math.round(base * 2 * jit));
  return `
      <TestAction guiclass="TestActionGui" testclass="TestAction" testname="Think time" enabled="true">
        <intProp name="ActionProcessor.action">1</intProp>
        <intProp name="ActionProcessor.target">0</intProp>
        <stringProp name="ActionProcessor.duration">0</stringProp>
      </TestAction>
      <hashTree>
        <UniformRandomTimer guiclass="UniformRandomTimerGui" testclass="UniformRandomTimer" testname="Think time jitter" enabled="true">
          <stringProp name="ConstantTimer.delay">${floor}</stringProp>
          <stringProp name="RandomTimer.range">${range}</stringProp>
        </UniformRandomTimer>
        <hashTree/>
      </hashTree>`;
}

function requestSampler(req, baseUrl) {
  const method = req.method || "GET";
  const path = (baseUrl.pathname === "/" ? "" : baseUrl.pathname) + (req.path || "/");
  const name = req.name || (method + " " + (req.path || "/"));
  const bodyBlock =
    method !== "GET" && method !== "HEAD" && req.body
      ? `<boolProp name="HTTPSampler.postBodyRaw">true</boolProp>
        <elementProp name="HTTPsampler.Arguments" elementType="Arguments">
          <collectionProp name="Arguments.arguments">
            <elementProp name="" elementType="HTTPArgument">
              <boolProp name="HTTPArgument.always_encode">false</boolProp>
              <stringProp name="Argument.value">${esc(req.body)}</stringProp>
              <stringProp name="Argument.metadata">=</stringProp>
            </elementProp>
          </collectionProp>
        </elementProp>`
      : `<elementProp name="HTTPsampler.Arguments" elementType="Arguments">
          <collectionProp name="Arguments.arguments"/>
        </elementProp>`;
  const headerEntries = Object.entries(req.headers || {})
    .map(([k, v]) => `<elementProp name="" elementType="Header">
              <stringProp name="Header.name">${esc(k)}</stringProp>
              <stringProp name="Header.value">${esc(v)}</stringProp>
            </elementProp>`).join("\n            ");
  return `
      <HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy" testname="${esc(name)}" enabled="true">
        ${bodyBlock}
        <stringProp name="HTTPSampler.domain">${esc(baseUrl.hostname)}</stringProp>
        <stringProp name="HTTPSampler.port">${baseUrl.port || (baseUrl.protocol === "https:" ? 443 : 80)}</stringProp>
        <stringProp name="HTTPSampler.protocol">${baseUrl.protocol.replace(":", "")}</stringProp>
        <stringProp name="HTTPSampler.path">${esc(unbrace(path))}</stringProp>
        <stringProp name="HTTPSampler.method">${esc(method)}</stringProp>
        <boolProp name="HTTPSampler.follow_redirects">true</boolProp>
        <boolProp name="HTTPSampler.use_keepalive">true</boolProp>
        <stringProp name="HTTPSampler.connect_timeout">10000</stringProp>
        <stringProp name="HTTPSampler.response_timeout">30000</stringProp>
      </HTTPSamplerProxy>
      <hashTree>
        <HeaderManager guiclass="HeaderPanel" testclass="HeaderManager" testname="Headers" enabled="true">
          <collectionProp name="HeaderManager.headers">
            ${headerEntries}
          </collectionProp>
        </HeaderManager>
        <hashTree/>
      </hashTree>`;
}

let COOKIE_MGR = "";
function threadGroup({ name, users, rampUp, duration, delay = 0 }, samplerXml) {
  return `
    <ThreadGroup guiclass="ThreadGroupGui" testclass="ThreadGroup" testname="${esc(name)}" enabled="true">
      <stringProp name="ThreadGroup.on_sample_error">continue</stringProp>
      <elementProp name="ThreadGroup.main_controller" elementType="LoopController" guiclass="LoopControlPanel" testclass="LoopController" testname="Loop Controller" enabled="true">
        <boolProp name="LoopController.continue_forever">false</boolProp>
        <intProp name="LoopController.loops">-1</intProp>
      </elementProp>
      <stringProp name="ThreadGroup.num_threads">${users}</stringProp>
      <stringProp name="ThreadGroup.ramp_time">${rampUp}</stringProp>
      <boolProp name="ThreadGroup.scheduler">true</boolProp>
      <stringProp name="ThreadGroup.duration">${duration}</stringProp>
      <stringProp name="ThreadGroup.delay">${delay}</stringProp>
      <boolProp name="ThreadGroup.same_user_on_next_iteration">true</boolProp>
    </ThreadGroup>
    <hashTree>${COOKIE_MGR}${samplerXml}
    </hashTree>`;
}


/** Phase A: a per-thread cookie jar so Set-Cookie from a login replays automatically. */
function cookieManager() {
  return `
      <CookieManager guiclass="CookiePanel" testclass="CookieManager" testname="Session cookies" enabled="true">
        <boolProp name="CookieManager.clearEachIteration">false</boolProp>
        <stringProp name="CookieManager.policy">standard</stringProp>
        <boolProp name="CookieManager.controlledByThreadGroup">false</boolProp>
      </CookieManager>
      <hashTree/>`;
}

/** Phase B: emit a post-processor that captures a value from a response into \${var}. */
/** JMeter Response Assertion for a request's assert config.
 *  A failed assertion marks the SAMPLE as failed (success=false) with a
 *  responseCode still 2xx — the JTL parser uses that to tell an assertion
 *  failure apart from a network/HTTP error. */
function assertionFor(a) {
  if (!a) return "";
  const parts = [];
  if (a.status != null) {
    parts.push({ field: "Assertion.response_code", type: 8, value: String(a.status), name: "status == " + a.status });
  }
  if (a.body_contains) {
    parts.push({ field: "Assertion.response_data", type: 2, value: String(a.body_contains), name: "body contains" });
  }
  if (a.body_excludes) {
    parts.push({ field: "Assertion.response_data", type: 2 + 32, value: String(a.body_excludes), name: "body excludes" });
  }
  if (a.header_name && a.header_contains) {
    // JMeter matches against the raw header block text, so assert on "Name: value".
    parts.push({ field: "Assertion.response_headers", type: 2, value: String(a.header_name) + ": " + String(a.header_contains), name: "header " + a.header_name });
  }
  return parts.map((p) => `
        <ResponseAssertion guiclass="AssertionGui" testclass="ResponseAssertion" testname="${esc(p.name)}" enabled="true">
          <collectionProp name="Asserion.test_strings">
            <stringProp name="0">${esc(p.value)}</stringProp>
          </collectionProp>
          <stringProp name="Assertion.test_field">${p.field}</stringProp>
          <!-- assume_success tells JMeter to IGNORE the sampler's own verdict and let
               this assertion decide. The HTTP sampler marks a 404 as failed BEFORE any
               assertion runs, so without this a deliberate 404 test inflates error_rate
               — and error_rate feeds the SLA gate.

               IT MUST STAY FALSE FOR BODY AND HEADER ASSERTIONS. Those ADD checks on top
               of an already-successful response. assume_success on a body assertion would
               make a genuine HTTP 500 look SUCCESSFUL if its error page happened to contain
               the matched string. That is a worse lie than the bug being fixed. -->
          <boolProp name="Assertion.assume_success">${p.field === "Assertion.response_code" ? "true" : "false"}</boolProp>
          <intProp name="Assertion.test_type">${p.type}</intProp>
        </ResponseAssertion>
        <hashTree/>`).join("");
}

function extractorFor(ex) {
  if (!ex || !ex.var) return "";
  const v = esc(ex.var);
  if (ex.source === "json") {
    return `
        <JSONPostProcessor guiclass="JSONPostProcessorGui" testclass="JSONPostProcessor" testname="Extract ${v}" enabled="true">
          <stringProp name="JSONPostProcessor.referenceNames">${v}</stringProp>
          <stringProp name="JSONPostProcessor.jsonPathExprs">${esc(ex.path || "$." + ex.var)}</stringProp>
          <stringProp name="JSONPostProcessor.match_numbers">1</stringProp>
        </JSONPostProcessor>
        <hashTree/>`;
  }
  // header or regex → Regex Extractor. For header source, scope to response headers.
  const useHeaders = ex.source === "header";
  const regex = ex.source === "header"
    ? esc((ex.path || ex.var) + ": ([^\\r\\n;]+)")
    : esc(ex.path || "");
  return `
        <RegexExtractor guiclass="RegexExtractorGui" testclass="RegexExtractor" testname="Extract ${v}" enabled="true">
          <stringProp name="RegexExtractor.useHeaders">${useHeaders ? "true" : "false"}</stringProp>
          <stringProp name="RegexExtractor.refname">${v}</stringProp>
          <stringProp name="RegexExtractor.regex">${regex}</stringProp>
          <stringProp name="RegexExtractor.template">$1$</stringProp>
          <stringProp name="RegexExtractor.default">NOTFOUND</stringProp>
          <stringProp name="RegexExtractor.match_number">1</stringProp>
        </RegexExtractor>
        <hashTree/>`;
}

export function generateJmx(test, opts = {}) {
  COOKIE_MGR = test.cookie_manager === false ? "" : cookieManager();
  const url = new URL(test.target_url);
  // csvPath: absolute path supplied by the worker at run time;
  // "data.csv" (relative) when a user downloads the plan to run themselves.
  const csv = test.csv_data ? csvDataSet(opts.csvPath || "data.csv") : "";
  const sampler = csv + (test.requests && test.requests.length
    ? test.requests.map((rq) => requestSampler(rq, url) + assertionFor(rq.assert) + extractorFor(rq.extract) + thinkTimeAction(rq)).join("")
    : httpSampler(test, url));
  const vu = test.virtual_users;
  const dur = test.duration_secs;
  const ramp = test.ramp_up_secs;

  let groups;
  switch (test.mode) {
    case "stress":
      // Ramp across the entire run: pressure keeps rising until the end.
      groups = threadGroup({ name: "Stress ramp", users: vu, rampUp: dur, duration: dur }, sampler);
      break;
    case "spike": {
      const baseline = Math.max(1, Math.round(vu * 0.2));
      const burst = Math.max(1, vu - baseline);
      const burstDelay = Math.floor(dur * 0.4);
      groups =
        threadGroup({ name: "Baseline", users: baseline, rampUp: ramp, duration: dur }, sampler) +
        threadGroup(
          { name: "Spike burst", users: burst, rampUp: 5, duration: dur - burstDelay, delay: burstDelay },
          sampler
        );
      break;
    }
    case "soak": // shape == load; duration carries the meaning
    case "load":
    default:
      groups = threadGroup({ name: "Main load", users: vu, rampUp: ramp, duration: dur }, sampler);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.6.3">
  <hashTree>
    <TestPlan guiclass="TestPlanGui" testclass="TestPlan" testname="${esc(test.name)}" enabled="true">
      <boolProp name="TestPlan.functional_mode">false</boolProp>
      <boolProp name="TestPlan.tearDown_on_shutdown">true</boolProp>
      <elementProp name="TestPlan.user_defined_variables" elementType="Arguments" guiclass="ArgumentsPanel" testclass="Arguments" testname="Variables" enabled="true">
        <collectionProp name="Arguments.arguments"/>
      </elementProp>
    </TestPlan>
    <hashTree>${groups}
    </hashTree>
  </hashTree>
</jmeterTestPlan>
`;
}
