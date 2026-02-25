import "./App.css";
// ─── Grid Constants ─────────────────────────────────────────────────────────
const COL_PX = 36;
const ROW_PX = 25;
const GRID_COLS = 24;
const GRID_ROWS = 60;

const NATURE_MAP = {
  Text: "Text",
  LED: "LED",
  IGauge: "IGauge",
  BGauge: "BGauge",
  Gauge: "Gauge",
  Select: "Select",
};

// ─── App ──────────────────────────────────────────────────────────────────────
import { useState, useCallback, useRef, useEffect } from "react";

// ─── XML Parser ────────────────────────────────────────────────────────────────
function parseXML(text) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "application/xml");
  const err = doc.querySelector("parsererror");
  if (err) throw new Error("XML parse error");
  return doc;
}

function serializeXML(doc) {
  return new XMLSerializer().serializeToString(doc);
}

function getTextContent(node, tag) {
  const el = node.querySelector(tag);
  return el ? el.textContent.trim() : "";
}

function setOrCreateChild(doc, parent, tag, value) {
  let el = parent.querySelector(`:scope > ${tag}`);
  if (!el) {
    el = doc.createElement(tag);
    parent.appendChild(el);
  }
  el.textContent = value;
}

function extractLayout(paramNode) {
  return {
    rowStart: parseInt(getTextContent(paramNode, "rowStart")) || 1,
    colStart: parseInt(getTextContent(paramNode, "colStart")) || 1,
    rowSpan: parseInt(getTextContent(paramNode, "rowSpan")) || 4,
    colSpan: parseInt(getTextContent(paramNode, "colSpan")) || 4,
  };
}

function buildParamData(paramNode, idx, tabName) {
  return {
    id: `param_${idx}_${Date.now()}`,
    node: paramNode,
    nature: getTextContent(paramNode, "PARAM_NATURE"),
    label: getTextContent(paramNode, "label"),
    unit: getTextContent(paramNode, "unit"),
    layout: extractLayout(paramNode),
    tabName: tabName,
  };
}

function parseFile(xmlText) {
  const doc = parseXML(xmlText);

  // Look for FILE tag, fallback to the root element (e.g., ABC)
  const fileEl = doc.querySelector("FILE") || doc.documentElement;
  const fileName =
    fileEl?.getAttribute("name") || fileEl?.tagName || "Untitled";

  const tabs = [];

  // Look for TABorSection OR any direct children of the root that aren't params
  let tabEls = doc.querySelectorAll("TABorSection");
  if (tabEls.length === 0) {
    // Fallback: treat direct children of the root as tabs (like <TAB1>)
    tabEls = Array.from(fileEl.children).filter((el) => el.tagName !== "PARAM");
  }

  tabEls.forEach((tabEl, ti) => {
    const tabName =
      tabEl.getAttribute("name") || tabEl.tagName || `Tab ${ti + 1}`;
    const params = [];

    tabEl.querySelectorAll("PARAM").forEach((p, pi) => {
      setOrCreateChild(doc, p, "TAB_NAME", tabName);
      params.push(buildParamData(p, `${ti}_${pi}`));
    });

    tabs.push({ name: tabName, params });
  });

  return { doc, fileName, tabs };
}

// ─── Collision detection ─────────────────────────────────────────────────────
function overlaps(a, b) {
  if (a.id === b.id) return false;
  const aR2 = a.layout.rowStart + a.layout.rowSpan;
  const bR2 = b.layout.rowStart + b.layout.rowSpan;
  const aC2 = a.layout.colStart + a.layout.colSpan;
  const bC2 = b.layout.colStart + b.layout.colSpan;
  return (
    a.layout.rowStart < bR2 &&
    aR2 > b.layout.rowStart &&
    a.layout.colStart < bC2 &&
    aC2 > b.layout.colStart
  );
}

function hasCollision(params, moving, newLayout) {
  const candidate = { ...moving, layout: newLayout };
  return params.some((p) => p.id !== moving.id && overlaps(candidate, p));
}

function clampLayout(layout) {
  const rs = Math.max(1, Math.min(layout.rowStart, GRID_ROWS));
  const cs = Math.max(1, Math.min(layout.colStart, GRID_COLS));
  const rsp = Math.max(1, Math.min(layout.rowSpan, GRID_ROWS - rs + 1));
  const csp = Math.max(1, Math.min(layout.colSpan, GRID_COLS - cs + 1));
  return { rowStart: rs, colStart: cs, rowSpan: rsp, colSpan: csp };
}

// ─── Default XML ─────────────────────────────────────────────────────────────
const DEFAULT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<FILE name="TelemetryModal">
  <TABorSection name="Overview">
    <PARAM>
      <PARAM_NATURE>2</PARAM_NATURE>
      <label>Speed</label>
      <unit>km/h</unit>
    </PARAM>
    <PARAM>
      <PARAM_NATURE>1</PARAM_NATURE>
      <label>Altitude</label>
      <unit>m</unit>
    </PARAM>
  </TABorSection>
  <TABorSection name="Power">
    <PARAM>
      <PARAM_NATURE>3</PARAM_NATURE>
      <label>Battery Level</label>
      <unit>%</unit>
    </PARAM>
  </TABorSection>
</FILE>`;

// ─── XML Pretty Printer ──────────────────────────────────────────────────────
const LAYOUT_TAGS = new Set(["rowStart", "colStart", "rowSpan", "colSpan"]);
const SPECIAL_TAGS = new Set(["PARAM_NATURE","TAB_NAME"])

function prettyPrintXML(xmlString) {
  let indent = 0;
  const lines = [];
  
  // Only split between adjacent tags (e.g., > <), 
  // keeping <tag>value</tag> on one line.
  const tokens = xmlString
    .replace(/>\s*</g, ">\n<") 
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const token of tokens) {
    if (token.startsWith("</")) {
      indent = Math.max(0, indent - 1);
      lines.push({ indent, token });
    } else if (token.startsWith("<?") || token.startsWith("<!")) {
      lines.push({ indent, token });
    } else if (token.endsWith("/>")) {
      lines.push({ indent, token });
    } else if (token.startsWith("<")) {
      lines.push({ indent, token });
      // Only indent if it's an opening tag that DOES NOT close on the same line
      if (!token.includes("</") && !token.endsWith("/>")) {
        indent++;
      }
    } else {
      lines.push({ indent, token });
    }
  }
  return lines;
} 

function highlightToken(token) {
  // Handle full inline tags: <tag>value</tag>
  const inlineMatch = token.match(/^<([^\s>]+)>(.*)<\/\1>$/);
  if (inlineMatch) {
    const [, name, value] = inlineMatch;
    const isLayout = LAYOUT_TAGS.has(name);
    const isSpecial = SPECIAL_TAGS.has(name);
    const tagClass = isSpecial? "xs": isLayout ? "xl" : "xk";
    
    return (
      `<span class="xc">&lt;</span><span class="${tagClass}">${name}</span><span class="xc">&gt;</span>` +
      `<span class="xv">${escHtml(value)}</span>` +
      `<span class="xc">&lt;/</span><span class="${tagClass}">${name}</span><span class="xc">&gt;</span>`
    );
  }

  // Handle standard Opening Tags: <tag>
  if (token.startsWith("<") && !token.startsWith("</")) {
    return token.replace(
      /^<([^\s/>]+)((?:\s+[^=]+="[^"]*")*)\s*(\/?)>$/,
      (_, name, attrs, selfClose) => {
        const isLayout = LAYOUT_TAGS.has(name);
        const tagClass = isLayout ? "xl" : "xk";
        const attrHtml = attrs.replace(
          /(\s+)([^=]+)="([^"]*)"/g,
          (__, sp, k, v) =>
            `${sp}<span class="xa">${k}</span>=<span class="xc">"</span><span class="xav">${escHtml(v)}</span><span class="xc">"</span>`
        );
        return `<span class="xc">&lt;</span><span class="${tagClass}">${name}</span>${attrHtml}<span class="xc">${selfClose ? " /" : ""}&gt;</span>`;
      }
    );
  }

  // Handle standard Closing Tags: </tag>
  if (token.startsWith("</")) {
    const name = token.slice(2, -1);
    const isLayout = LAYOUT_TAGS.has(name);
    return `<span class="xc">&lt;/</span><span class="${isLayout ? "xl" : "xk"}">${name}</span><span class="xc">&gt;</span>`;
  }

  // Fallback for plain text
  return `<span class="xv">${escHtml(token)}</span>`;
}

function escHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildHighlightedXML(tabs, xmlDoc) {
  if (!xmlDoc) return [];
  
  tabs.forEach((tab) => {
    tab.params.forEach((p) => {
      if (p.node) {
        // Core data
        setOrCreateChild(xmlDoc, p.node, "PARAM_NATURE", p.nature);
        setOrCreateChild(xmlDoc, p.node, "label", p.label);
        setOrCreateChild(xmlDoc, p.node, "unit", p.unit || "");
        setOrCreateChild(xmlDoc, p.node, "TAB_NAME", tab.name);
        
        // Layout data
        setOrCreateChild(xmlDoc, p.node, "rowStart", p.layout.rowStart);
        setOrCreateChild(xmlDoc, p.node, "colStart", p.layout.colStart);
        setOrCreateChild(xmlDoc, p.node, "rowSpan", p.layout.rowSpan);
        setOrCreateChild(xmlDoc, p.node, "colSpan", p.layout.colSpan);
      }
    });
  });

  const raw = serializeXML(xmlDoc);
  return prettyPrintXML(raw);
}
// ─── XMLViewerTab ─────────────────────────────────────────────────────────────
function XMLViewerTab({ tabs, xmlDoc }) {
  const [copied, setCopied] = useState(false);
  const lines = buildHighlightedXML(tabs, xmlDoc);

  // Generate the string for clipboard
  const rawXml = lines.map((l) => "  ".repeat(l.indent) + l.token).join("\n");

  function handleCopy() {
    navigator.clipboard.writeText(rawXml).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="xml-viewer-wrap">
      <div className="xml-viewer-toolbar">
        <span className="xml-viewer-label">Live XML Preview</span>
        <button className={`xml-copy-btn${copied ? " copied" : ""}`} onClick={handleCopy}>
          {copied ? "✓ Copied!" : "Copy XML"}
        </button>
      </div>
      <div className="xml-full-preview">
        <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
          {lines.map((l, idx) => (
            <div key={idx} className="xml-line">
              <span className="xml-line-num">{String(idx + 1).padStart(3, " ")}</span>
              <span dangerouslySetInnerHTML={{ 
                __html: "  ".repeat(l.indent) + highlightToken(l.token) 
              }} />
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}

function GridCanvas({ params, selectedId, onSelect, onLayoutChange }) {
  const canvasRef = useRef(null);
  const draggingRef = useRef(null);
  const resizingRef = useRef(null);

  const W = GRID_COLS * COL_PX;
  const H = GRID_ROWS * ROW_PX;

  // Track collisions
  const collisionSet = new Set();
  for (let i = 0; i < params.length; i++) {
    for (let j = i + 1; j < params.length; j++) {
      if (overlaps(params[i], params[j])) {
        collisionSet.add(params[i].id);
        collisionSet.add(params[j].id);
      }
    }
  }

  const snapCol = (px) => Math.max(1, Math.round(px / COL_PX) + 1);
  const snapRow = (px) => Math.max(1, Math.round(px / ROW_PX) + 1);
  const snapSpanCol = (px) => Math.max(1, Math.round(px / COL_PX));
  const snapSpanRow = (px) => Math.max(1, Math.round(px / ROW_PX));

  const handleMouseDown = (e, param, mode) => {
    e.stopPropagation();
    onSelect(param.id);
    const startX = e.clientX;
    const startY = e.clientY;
    const origLayout = { ...param.layout };

    const ref = mode === "drag" ? draggingRef : resizingRef;
    ref.current = { param, startX, startY, origLayout, mode };

    const onMove = (me) => {
      const dx = me.clientX - startX;
      const dy = me.clientY - startY;
      let newLayout;
      if (mode === "drag") {
        const newColStart = origLayout.colStart + Math.round(dx / COL_PX);
        const newRowStart = origLayout.rowStart + Math.round(dy / ROW_PX);
        newLayout = clampLayout({
          ...origLayout,
          colStart: newColStart,
          rowStart: newRowStart,
        });
      } else {
        const newColSpan = origLayout.colSpan + Math.round(dx / COL_PX);
        const newRowSpan = origLayout.rowSpan + Math.round(dy / ROW_PX);
        newLayout = clampLayout({
          ...origLayout,
          colSpan: newColSpan,
          rowSpan: newRowSpan,
        });
      }
      onLayoutChange(param.id, newLayout, true); // preview only
    };

    const onUp = (me) => {
      const dx = me.clientX - startX;
      const dy = me.clientY - startY;
      let newLayout;
      if (mode === "drag") {
        newLayout = clampLayout({
          ...origLayout,
          colStart: origLayout.colStart + Math.round(dx / COL_PX),
          rowStart: origLayout.rowStart + Math.round(dy / ROW_PX),
        });
      } else {
        newLayout = clampLayout({
          ...origLayout,
          colSpan: origLayout.colSpan + Math.round(dx / COL_PX),
          rowSpan: origLayout.rowSpan + Math.round(dy / ROW_PX),
        });
      }
      onLayoutChange(param.id, newLayout, false);
      ref.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Draw grid lines via canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, W, H);

    // row lines (blue)
    ctx.strokeStyle = "rgba(80,120,200,0.18)";
    ctx.lineWidth = 0.5;
    for (let r = 0; r <= GRID_ROWS; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * ROW_PX);
      ctx.lineTo(W, r * ROW_PX);
      ctx.stroke();
    }

    // col lines (yellow)
    ctx.strokeStyle = "rgba(200,180,60,0.18)";
    for (let c = 0; c <= GRID_COLS; c++) {
      ctx.beginPath();
      ctx.moveTo(c * COL_PX, 0);
      ctx.lineTo(c * COL_PX, H);
      ctx.stroke();
    }
  }, [W, H]);

  return (
    <div className="grid-canvas" style={{ width: W, height: H }}>
      <canvas ref={canvasRef} width={W} height={H} className="grid-lines" />
      {params.map((param) => {
        const { rowStart, colStart, rowSpan, colSpan } = param.layout;
        const left = (colStart - 1) * COL_PX;
        const top = (rowStart - 1) * ROW_PX;
        const width = colSpan * COL_PX;
        const height = rowSpan * ROW_PX;
        const isSelected = param.id === selectedId;
        const isCollision = collisionSet.has(param.id);

        return (
          <div
            key={param.id}
            className={`param-block${isSelected ? " selected" : ""}${isCollision ? " collision" : ""}`}
            style={{ left, top, width, height }}
            onMouseDown={(e) => handleMouseDown(e, param, "drag")}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="param-inner">
              <div className="param-label">{param.label || "(no label)"}</div>
              <div className="param-nature">N{param.nature}</div>
              {param.unit && <div className="param-unit">{param.unit}</div>}
            </div>
            <div
              className="resize-handle"
              onMouseDown={(e) => {
                e.stopPropagation();
                handleMouseDown(e, param, "resize");
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

// ─── Layout Inputs — local draft state so typing is never interrupted ────────
function LayoutInputs({ selectedParam, onLayoutChange }) {
  // Draft holds the raw string the user is typing; committed value is the integer
  const [drafts, setDrafts] = useState({
    rowStart: String(selectedParam.layout.rowStart),
    colStart: String(selectedParam.layout.colStart),
    rowSpan: String(selectedParam.layout.rowSpan),
    colSpan: String(selectedParam.layout.colSpan),
  });

  // When the selected param changes externally (drag/resize), sync drafts
  useEffect(() => {
    setDrafts({
      rowStart: String(selectedParam.layout.rowStart),
      colStart: String(selectedParam.layout.colStart),
      rowSpan: String(selectedParam.layout.rowSpan),
      colSpan: String(selectedParam.layout.colSpan),
    });
  }, [
    selectedParam.id,
    selectedParam.layout.rowStart,
    selectedParam.layout.colStart,
    selectedParam.layout.rowSpan,
    selectedParam.layout.colSpan,
  ]);

  const commit = (field, raw) => {
    const num = parseInt(raw, 10);
    if (!isNaN(num) && num >= 1) {
      onLayoutChange(
        selectedParam.id,
        { ...selectedParam.layout, [field]: num },
        false,
      );
    } else {
      // Revert draft to last valid value
      setDrafts((d) => ({
        ...d,
        [field]: String(selectedParam.layout[field]),
      }));
    }
  };

  return (
    <div className="cp-grid">
      {[
        ["rowStart", "Row Start"],
        ["colStart", "Col Start"],
        ["rowSpan", "Row Span"],
        ["colSpan", "Col Span"],
      ].map(([field, label]) => (
        <div className="cp-field" key={field}>
          <div className="cp-label">{label}</div>
          <input
            className="cp-input"
            type="number"
            min="1"
            value={drafts[field]}
            onChange={(e) =>
              setDrafts((d) => ({ ...d, [field]: e.target.value }))
            }
            onBlur={(e) => commit(field, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.target.blur();
              }
              if (e.key === "Escape") {
                setDrafts((d) => ({
                  ...d,
                  [field]: String(selectedParam.layout[field]),
                }));
                e.target.blur();
              }
            }}
          />
        </div>
      ))}
    </div>
  );
}

// ─── Control Panel ────────────────────────────────────────────────────────────
function ControlPanel({
  selectedParam,
  allParams,
  onLayoutChange,
  xmlText,
  onExport,
  onUpload,
  tabs,
  xmlDoc,
  onNatureChange,
}) {
  const [cpTab, setCpTab] = useState("config"); // "config" | "xml"

  const hasCollision =
    selectedParam &&
    allParams.some(
      (p) => p.id !== selectedParam.id && overlaps(selectedParam, p),
    );

  return (
    <div className="control-panel">
      {/* ── Tab switcher ── */}
      <div className="cp-tabs-bar">
        <button
          className={`cp-tab-btn${cpTab === "config" ? " cp-tab-active" : ""}`}
          onClick={() => setCpTab("config")}
        >
          Config
        </button>
        <button
          className={`cp-tab-btn${cpTab === "xml" ? " cp-tab-active" : ""}`}
          onClick={() => setCpTab("xml")}
        >
          XML
        </button>
      </div>

      {/* ── Config tab body ── */}
      {cpTab === "config" && (
        <div className="cp-tab-body">
          <div className="cp-section">
            <div className="cp-section-title">File</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label
                className="btn btn-secondary"
                style={{ textAlign: "center", cursor: "pointer" }}
              >
                Upload XML
                <input
                  type="file"
                  accept=".xml"
                  style={{ display: "none" }}
                  onChange={onUpload}
                />
              </label>
              <button className="btn btn-primary" onClick={onExport}>
                Export XML
              </button>
            </div>
          </div>

          <div className="cp-section">
            <div className="cp-section-title">Legend</div>
            <div className="legend">
              <div className="legend-item">
                <div
                  className="legend-dot"
                  style={{ background: "rgba(80,120,200,0.6)" }}
                />
                row lines
              </div>
              <div className="legend-item">
                <div
                  className="legend-dot"
                  style={{ background: "rgba(200,180,60,0.6)" }}
                />
                col lines
              </div>
              <div className="legend-item">
                <div className="legend-dot" style={{ background: "#7cf2c8" }} />
                selected
              </div>
              <div className="legend-item">
                <div className="legend-dot" style={{ background: "#ff4466" }} />
                collision
              </div>
            </div>
            <div
              style={{
                marginTop: 8,
                fontSize: 10,
                color: "#444",
                fontFamily: "'JetBrains Mono',monospace",
              }}
            >
              1 col = {COL_PX}px · 1 row = {ROW_PX}px
              <br />
              Grid: {GRID_COLS}c × {GRID_ROWS}r
            </div>
          </div>

          {selectedParam ? (
            <>
              <div className="cp-section">
                <div className="cp-section-title">Selected Param</div>
              
                {/* Label and Unit Info */}
                <div className="cp-info-row">
                  <span className="cp-info-key">Belongs To</span>
                  <span className="cp-info-val" style={{ color: "#888" }}>
                    {selectedParam.tabName}
                  </span>
                </div>

                {/* New Nature Dropdown */}
                <div className="cp-field" style={{ marginTop: "10px" }}>
                  <div className="cp-label">Nature</div>
                  <select
                    className="cp-input"
                    value={selectedParam.nature}
                    onChange={(e) =>{

                      debugger
                      onNatureChange(selectedParam.id, e.target.value)
                    }
                    }
                  >
                    {Object.entries(NATURE_MAP).map(([val, label]) => (
                      <option key={val} value={val}>
                        {label} ({val})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="cp-info-row">
                  <span className="cp-info-key">Unit</span>
                  <span className="cp-info-val">
                    {selectedParam.unit || "N/A"}
                  </span>
                </div>
              </div>

              <div className="cp-section">
                <div className="cp-section-title">Layout</div>
                <LayoutInputs
                  selectedParam={selectedParam}
                  onLayoutChange={onLayoutChange}
                />
              </div>
            </>
          ) : (
            <div className="cp-section">
              <div className="cp-no-sel">Click a param block to select it</div>
            </div>
          )}
        </div>
      )}

      {/* ── XML tab body ── */}
      {cpTab === "xml" && (
        <div className="cp-tab-body">
          <XMLViewerTab tabs={tabs} xmlDoc={xmlDoc} />
        </div>
      )}
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [xmlDoc, setXmlDoc] = useState(null);
  const [fileName, setFileName] = useState("TelemetryModal.xml");
  const [tabs, setTabs] = useState([]);
  const [activeTab, setActiveTab] = useState(0);
  const [selectedId, setSelectedId] = useState(null);

  // Init with default XML
  useEffect(() => {
    load(DEFAULT_XML, "TelemetryModal.xml");
  }, []);
  function handleNatureChange(paramId, newNature) {
    setTabs((prev) =>
      prev.map((tab) => ({
        ...tab,
        params: tab.params.map((p) => {
          if (p.id !== paramId) return p;

          // Update the actual XML node in the DOM tree
          if (p.node && xmlDoc) {
            setOrCreateChild(xmlDoc, p.node, "PARAM_NATURE", newNature);
          }

          return { ...p, nature: newNature };
        }),
      })),
    );
  }
  function load(text, name) {
    try {
      const { doc, fileName: parsedName, tabs: t } = parseFile(text);
      const fn = name || parsedName;
      // Assign default layouts where missing
      let paramIdx = 0;
      t.forEach((tab) => {
        tab.params.forEach((p) => {
          const hasLayout =
            !!p.node.querySelector("rowStart") ||
            !!p.node.querySelector("colStart");
          if (!hasLayout) {
            // stagger defaults
            const col = (paramIdx % 4) * 4 + 1;
            const row = Math.floor(paramIdx / 4) * 6 + 1;
            p.layout = { rowStart: row, colStart: col, rowSpan: 4, colSpan: 4 };
          }
          paramIdx++;
        });
      });
      setXmlDoc(doc);
      setFileName(name);
      setTabs(t);
      setActiveTab(0);
      setSelectedId(null);
    } catch (e) {
      alert("Failed to parse XML: " + e.message);
    }
  }

  function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => load(ev.target.result, file.name);
    reader.readAsText(file);
  }

  function handleLayoutChange(paramId, newLayout, preview) {
    setTabs((prev) => {
      const next = prev.map((tab) => ({
        ...tab,
        params: tab.params.map((p, tabName) => {
          if (p.id !== paramId) return p;
          const clamped = clampLayout(newLayout);
          // Update XML node
          if (!preview && p.node && xmlDoc) {
            setOrCreateChild(xmlDoc, p.node, "rowStart", clamped.rowStart);
            setOrCreateChild(xmlDoc, p.node, "colStart", clamped.colStart);
            setOrCreateChild(xmlDoc, p.node, "rowSpan", clamped.rowSpan);
            setOrCreateChild(xmlDoc, p.node, "colSpan", clamped.colSpan);
            setOrCreateChild(xmlDoc, p.node, "TAB_NAME", tabName);
          }
          return { ...p, layout: clamped };
        }),
      }));
      return next;
    });
  }

  function handleExport() {
    if (!xmlDoc) return;
    // Ensure all XML nodes are updated
    tabs.forEach((tab) => {
      tab.params.forEach((p) => {
        setOrCreateChild(xmlDoc, p.node, "rowStart", p.layout.rowStart);
        setOrCreateChild(xmlDoc, p.node, "colStart", p.layout.colStart);
        setOrCreateChild(xmlDoc, p.node, "rowSpan", p.layout.rowSpan);
        setOrCreateChild(xmlDoc, p.node, "colSpan", p.layout.colSpan);
      });
    });
    const xml = serializeXML(xmlDoc);
    const blob = new Blob([xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName.endsWith(".xml") ? fileName : fileName + ".xml";
    a.click();
    URL.revokeObjectURL(url);
  }

  const currentTab = tabs[activeTab];
  const selectedParam =
    currentTab?.params.find((p) => p.id === selectedId) || null;

  return (
    <>
      <div className="app">
        <div className="topbar">
          <div className="topbar-title">XML Layout Editor</div>
          <div className="topbar-filename">{fileName}</div>
        </div>
        <div className="main">
          <div className="preview-panel">
            <div className="tabs-bar">
              {tabs.map((tab, i) => (
                <button
                  key={i}
                  className={`tab-btn${activeTab === i ? " active" : ""}`}
                  onClick={() => {
                    setActiveTab(i);
                    setSelectedId(null);
                  }}
                >
                  {tab.name}
                </button>
              ))}
            </div>
            <div className="canvas-wrap" onClick={() => setSelectedId(null)}>
              {currentTab && (
                <GridCanvas
                  params={currentTab.params}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onLayoutChange={handleLayoutChange}
                />
              )}
            </div>
          </div>
          <ControlPanel
            selectedParam={selectedParam}
            allParams={currentTab?.params || []}
            onLayoutChange={handleLayoutChange}
            xmlText={xmlDoc ? serializeXML(xmlDoc) : ""}
            onNatureChange={handleNatureChange}
            onExport={handleExport}
            onUpload={handleUpload}
            tabs={tabs}
            xmlDoc={xmlDoc}
          />
        </div>
      </div>
    </>
  );
}
