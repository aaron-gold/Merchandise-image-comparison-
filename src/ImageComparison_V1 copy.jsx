import React, { useEffect, useMemo, useState } from "react";
import {
  Upload,
  ZoomIn,
  ZoomOut,
  FileText,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Sun,
  Moon,
} from "lucide-react";

// HARDCODED API CONFIGURATION
const API_CONFIG = {
  url: "http://localhost:8080/api/get-uvpaint-inspections",
};

// ---------- Aggregated Metrics (Table A + Table D) ----------
const sumActionMap = (m) => {
  if (!m || typeof m !== "object") return 0;
  return Object.values(m).reduce((a, b) => a + (Number(b) || 0), 0);
};

const parseUv360CategoryToSimCamSide = (category) => {
  if (!category) return { simulatedCamera: "N/A", simulatedCameraSide: "N/A" };
  const parts = String(category).split("_");
  const cam = parts[0] ? parts[0].charAt(0) + parts[0].slice(1).toLowerCase() : "N/A";
  const side = parts[1] ? parts[1].charAt(0) + parts[1].slice(1).toLowerCase() : "N/A";
  return { simulatedCamera: cam, simulatedCameraSide: side };
};

const computeAggregatedMetrics = (processedInspections) => {
  const tableA = [];
  const aggD = new Map();

  const addToTableD = ({ imageType, simulatedCamera, simulatedCameraSide, originalCameraId, actions }) => {
    const key = [imageType || "N/A", simulatedCamera || "N/A", simulatedCameraSide || "N/A", originalCameraId || "N/A"].join("|");

    if (!aggD.has(key)) {
      aggD.set(key, {
        imageType: imageType || "N/A",
        simulatedCamera: simulatedCamera || "N/A",
        simulatedCameraSide: simulatedCameraSide || "N/A",
        originalCameraId: originalCameraId || "N/A",
        images: 0,
        totalActions: 0,
      });
    }

    const row = aggD.get(key);
    row.images += 1;
    row.totalActions += Number(actions) || 0;
  };

  processedInspections.forEach((insp, idx) => {
    const uvpaintData = insp.rawInspection?.uvpaintData;

    const publishedUvpaint = (uvpaintData?.images || []).filter(
      (img) => img?.isActive && img?.activeImage && img?.pov && img.imageType !== "Artemis"
    );

    const publishedUv360 = (uvpaintData?.uv360Images || []).filter((img) => !!img?.Uv360ProcessedImage);

    const publishedCount = publishedUvpaint.length + publishedUv360.length;

    let totalActions = 0;
    let imagesWithActions = 0;

    publishedUvpaint.forEach((img) => {
      const actions = sumActionMap(img.actionsCounterMap);
      totalActions += actions;
      if (actions > 0) imagesWithActions += 1;
    });

    const avgActionsPerImage = publishedCount > 0 ? totalActions / publishedCount : 0;

    const label = insp.vehicle
      ? `${insp.vehicle.year || ""} ${insp.vehicle.make || ""} ${insp.vehicle.model || ""}`.trim()
      : `Inspection ${idx + 1}`;

    tableA.push({
      inspectionIndex: idx + 1,
      inspectionId: insp.inspectionId,
      label,
      publishedCount,
      imagesWithActions,
      avgActionsPerImage,
    });

    publishedUvpaint.forEach((img) => {
      addToTableD({
        imageType: img.imageType,
        simulatedCamera: img.pov?.simulatedCamera,
        simulatedCameraSide: img.pov?.simulatedCameraSide,
        originalCameraId: img.pov?.originalCameraId || "N/A",
        actions: sumActionMap(img.actionsCounterMap),
      });
    });

    publishedUv360.forEach((img) => {
      const category = img?.pov?.category;
      const { simulatedCamera, simulatedCameraSide } = parseUv360CategoryToSimCamSide(category);

      addToTableD({
        imageType: "UV360",
        simulatedCamera,
        simulatedCameraSide,
        originalCameraId: "N/A",
        actions: 0,
      });
    });
  });

  const tableD = Array.from(aggD.values()).map((r) => ({
    ...r,
    avgActionsPerImage: r.images > 0 ? r.totalActions / r.images : 0,
  }));

  tableD.sort((a, b) => b.avgActionsPerImage - a.avgActionsPerImage);

  return { tableA, tableD };
};

// ---------- Metrics Tab UI ----------
function MetricsTab({ tableA, tableD, onJumpToInspection }) {
  return (
    <div className="space-y-8">
      <div className="bg-slate-800/30 border border-slate-700 rounded-lg p-4">
        <h2 className="text-white font-semibold mb-3">Table A — Inspection Health</h2>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-slate-300">
              <tr className="border-b border-slate-700">
                <th className="text-left py-2 pr-4">Inspection</th>
                <th className="text-left py-2 pr-4">Published Images</th>
                <th className="text-left py-2 pr-4">Images w/ Actions</th>
                <th className="text-left py-2 pr-4">Avg Actions / Image</th>
              </tr>
            </thead>
            <tbody className="text-slate-200">
              {tableA.map((r) => (
                <tr key={r.inspectionId} className="border-b border-slate-800 hover:bg-slate-800/40">
                  <td className="py-2 pr-4">
                    <button
                      className="text-blue-400 hover:text-blue-300 underline-offset-2 hover:underline"
                      onClick={() => onJumpToInspection?.(r.inspectionId)}
                      title={r.inspectionId}
                    >
                      {r.label || `Inspection ${r.inspectionIndex}`}
                    </button>
                  </td>
                  <td className="py-2 pr-4">{r.publishedCount}</td>
                  <td className="py-2 pr-4">{r.imagesWithActions}</td>
                  <td className="py-2 pr-4">{r.avgActionsPerImage.toFixed(2)}</td>
                </tr>
              ))}
              {tableA.length === 0 && (
                <tr>
                  <td className="py-3 text-slate-400" colSpan={4}>
                    No data
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-slate-800/30 border border-slate-700 rounded-lg p-4">
        <h2 className="text-white font-semibold mb-3">Table D — Camera / POV Heatmap (Aggregate)</h2>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-slate-300">
              <tr className="border-b border-slate-700">
                <th className="text-left py-2 pr-4">Image Type</th>
                <th className="text-left py-2 pr-4">Sim Cam</th>
                <th className="text-left py-2 pr-4">Sim Side</th>
                <th className="text-left py-2 pr-4">Original Cam</th>
                <th className="text-left py-2 pr-4"># Images</th>
                <th className="text-left py-2 pr-4">Avg Actions / Image</th>
              </tr>
            </thead>
            <tbody className="text-slate-200">
              {tableD.map((r, idx) => (
                <tr
                  key={`${r.imageType}|${r.simulatedCamera}|${r.simulatedCameraSide}|${r.originalCameraId}|${idx}`}
                  className="border-b border-slate-800 hover:bg-slate-800/40"
                >
                  <td className="py-2 pr-4">{r.imageType}</td>
                  <td className="py-2 pr-4">{r.simulatedCamera}</td>
                  <td className="py-2 pr-4">{r.simulatedCameraSide}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{r.originalCameraId}</td>
                  <td className="py-2 pr-4">{r.images}</td>
                  <td className="py-2 pr-4">{r.avgActionsPerImage.toFixed(2)}</td>
                </tr>
              ))}
              {tableD.length === 0 && (
                <tr>
                  <td className="py-3 text-slate-400" colSpan={6}>
                    No data
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function ImageComparison() {
  const [inspections, setInspections] = useState([]);
  const [currentInspectionIndex, setCurrentInspectionIndex] = useState(0);
  const [currentComparisonIndex, setCurrentComparisonIndex] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [loadMethod, setLoadMethod] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [activeView, setActiveView] = useState("comparisons"); // 'comparisons' | 'metrics'
  const [metrics, setMetrics] = useState({ tableA: [], tableD: [] });

  // theme toggle (local state only)
  const [theme, setTheme] = useState("dark"); // 'dark' | 'light'

  const themeVars = useMemo(() => {
    if (theme === "light") {
      return {
        pageBg: "linear-gradient(135deg, #f8fafc 0%, #eef2ff 50%, #f8fafc 100%)",
        panelBg: "rgba(255,255,255,0.75)",
        panelBorder: "rgba(15,23,42,0.10)",
        text: "#0f172a",
        subText: "#475569",
        headerText: "#0f172a",
        chipBg: "#eef2ff",
        chipText: "#3730a3",
        cardBg: "#ffffff",
        cardBorder: "#e5e7eb",
      };
    }
    return {
      pageBg: "linear-gradient(135deg, #0f172a 0%, #1f2937 50%, #0f172a 100%)",
      panelBg: "rgba(30,41,59,0.50)",
      panelBorder: "rgba(148,163,184,0.25)",
      text: "#ffffff",
      subText: "#94a3b8",
      headerText: "#ffffff",
      chipBg: "rgba(99,102,241,0.15)",
      chipText: "#c7d2fe",
      cardBg: "rgba(15,23,42,0.35)",
      cardBorder: "rgba(148,163,184,0.20)",
    };
  }, [theme]);

  // fixed slot mapping (prevents regression)
  const SLOTS = useMemo(
    () => [
      { label: "Previous", idx: 0 },
      { label: "Latest", idx: 1 },
      { label: "Original", idx: 2 },
    ],
    []
  );

  const IMAGE_TYPE_ORDER = useMemo(() => ({ UV360: 0, SlimOverview: 1, Zoomer: 2 }), []);

  const safeUrl = (u) => (typeof u === "string" && u.trim() ? u.trim() : null);

  const pickOriginalUrl = (obj) => {
    if (!obj) return null;
    const candidates = [
      obj.originalImage,
      obj.originalImageUrl,
      obj.originalImageWithBackground,
      obj.originalImageWithoutBackground,
    ];
    return candidates.find((u) => typeof u === "string" && u.trim())?.trim() || null;
  };

  const createPOVKey = (imageType, pov, category = null) => {
    if (imageType === "UV360") {
      return `UV360_${category || "unknown"}_${pov?.serialNumber ?? "none"}`;
    }
    return `${imageType}_${pov?.simulatedCamera || "NA"}_${pov?.simulatedCameraSide || "NA"}_${pov?.serialNumber ?? "none"}`;
  };

  const parseUv360CameraSide = (category) => {
    const parts = String(category || "").split("_");
    const camera = parts[0] ? parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase() : "N/A";
    const side = parts[1] ? parts[1].charAt(0).toUpperCase() + parts[1].slice(1).toLowerCase() : "N/A";
    return { camera, side };
  };

  const processInspectionData = (inspection) => {
    const uvpaintData = inspection?.uvpaintData;
    if (!uvpaintData) return [];

    const rowsByPOV = {};

    const ensureRow = ({ povKey, imageType, pov, category }) => {
      if (!rowsByPOV[povKey]) {
        rowsByPOV[povKey] = { imageType, pov, category, renditions: {} };
      }
      return rowsByPOV[povKey];
    };

    const putRendition = ({ imageType, pov, category = null, rendition, activeImage, status, source, actions = "N/A", originalImage }) => {
      if (!pov) return;
      const povKey = createPOVKey(imageType, pov, category);
      const row = ensureRow({ povKey, imageType, pov, category });

      const rNum = Number.isFinite(Number(rendition)) ? Number(rendition) : null;
      if (rNum === null) return;

      row.renditions[rNum] = {
        image: safeUrl(activeImage),
        status: status || "N/A",
        source: source || "N/A",
        actions,
        originalImage: safeUrl(originalImage),
      };
    };

    // uvpaintData.images
    if (Array.isArray(uvpaintData.images)) {
      uvpaintData.images.forEach((img) => {
        if (!img || img.imageType === "Artemis") return;
        if (!img.pov) return;

        putRendition({
          imageType: img.imageType,
          pov: img.pov,
          rendition: img.rendition ?? 3,
          activeImage: img.activeImage,
          status: img.status,
          source: "images",
          actions: img.actionsCounterMap ? sumActionMap(img.actionsCounterMap) : 0,
          originalImage: pickOriginalUrl(img),
        });
      });
    }

    // uvpaintHistoryImages
    if (Array.isArray(uvpaintData.uvpaintHistoryImages)) {
      uvpaintData.uvpaintHistoryImages.forEach((img) => {
        if (!img || img.imageType === "Artemis") return;
        if (!img.pov) return;

        putRendition({
          imageType: img.imageType,
          pov: img.pov,
          rendition: img.rendition ?? 1,
          activeImage: img.activeImage,
          status: img.status,
          source: "uvpaintHistoryImages",
          actions: img.actionsCounterMap ? sumActionMap(img.actionsCounterMap) : 0,
          originalImage: pickOriginalUrl(img),
        });
      });
    }

    // uv360Images
    if (Array.isArray(uvpaintData.uv360Images)) {
      uvpaintData.uv360Images.forEach((img) => {
        const pov = img?.pov || {};
        const category = pov.category || "";
        if (!category) return;

        const processed = safeUrl(img.Uv360ProcessedImage);
        if (!processed) return;

        const { camera, side } = parseUv360CameraSide(category);

        putRendition({
          imageType: "UV360",
          pov: { simulatedCamera: camera, simulatedCameraSide: side, serialNumber: pov.serialNumber },
          category,
          rendition: img.rendition ?? 2,
          activeImage: processed,
          status: "Published",
          source: "uv360Images",
          actions: "N/A",
          originalImage: pickOriginalUrl(img),
        });
      });
    }

    // uv360HistoryImages
    if (Array.isArray(uvpaintData.uv360HistoryImages)) {
      uvpaintData.uv360HistoryImages.forEach((img) => {
        const pov = img?.pov || {};
        const category = pov.category || "";
        if (!category) return;

        const processed = safeUrl(img.Uv360ProcessedImage);
        if (!processed) return;

        const { camera, side } = parseUv360CameraSide(category);

        putRendition({
          imageType: "UV360",
          pov: { simulatedCamera: camera, simulatedCameraSide: side, serialNumber: pov.serialNumber },
          category,
          rendition: img.rendition ?? 0,
          activeImage: processed,
          status: "History-Published",
          source: "uv360HistoryImages",
          actions: "N/A",
          originalImage: pickOriginalUrl(img),
        });
      });
    }

    // Build groups
    const groups = [];

    Object.entries(rowsByPOV).forEach(([povKey, row]) => {
      const renditionNums = Object.keys(row.renditions)
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => b - a);

      if (renditionNums.length === 0) return;

      const latestR = renditionNums[0];
      const prevR = renditionNums[1] ?? null;

      const latest = row.renditions[latestR];
      const prev = prevR !== null ? row.renditions[prevR] : null;

      const cameraLabel = `${row.pov?.simulatedCamera || "N/A"} ${row.pov?.simulatedCameraSide || ""}`.trim();

      // IMPORTANT: Original is ONLY from originalImage fields (no "fallback to latest image")
      const originalUrl = pickOriginalUrl(latest) || pickOriginalUrl(prev) || null;

      groups.push({
        id: `${inspection.inspectionId}_${povKey}`,
        name: `${cameraLabel} (${row.imageType})`,
        sortKey: {
          typeOrder: IMAGE_TYPE_ORDER[row.imageType] ?? 999,
          cam: (row.pov?.simulatedCamera || "").toLowerCase(),
          side: (row.pov?.simulatedCameraSide || "").toLowerCase(),
          serial: Number(row.pov?.serialNumber ?? 0),
        },
        images: [
          safeUrl(prev?.image),     // Previous
          safeUrl(latest?.image),   // Latest
          safeUrl(originalUrl),     // Original (right side)
        ],
        metadata: {
          inspectionId: inspection.inspectionId,
          vehicle: inspection.uvpaintInspection?.vehicleInfo,
          pov: row.pov,
          imageType: row.imageType,
          renditions: [prevR, latestR, originalUrl ? "OG" : null],
          statuses: [
            prev?.status || (prevR !== null ? "N/A" : "Empty"),
            latest?.status || "N/A",
            originalUrl ? "Original" : "Empty",
          ],
          sources: [
            prev?.source || (prevR !== null ? "N/A" : "Empty"),
            latest?.source || "N/A",
            originalUrl ? "originalImage" : "Empty",
          ],
          actions: [
            prev?.actions ?? "N/A",
            latest?.actions ?? "N/A",
            "N/A",
          ],
          totalVersions: renditionNums.length,
        },
      });
    });

    // Keep ordering: UV360, SlimOverview, Zoomer
    groups.sort((a, b) => {
      if (a.sortKey.typeOrder !== b.sortKey.typeOrder) return a.sortKey.typeOrder - b.sortKey.typeOrder;
      if (a.sortKey.cam !== b.sortKey.cam) return a.sortKey.cam.localeCompare(b.sortKey.cam);
      if (a.sortKey.side !== b.sortKey.side) return a.sortKey.side.localeCompare(b.sortKey.side);
      return (a.sortKey.serial || 0) - (b.sortKey.serial || 0);
    });

    return groups;
  };

  const handleCSVUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setLoading(true);
    setError("");

    try {
      const text = await file.text();
      const lines = text.split("\n").filter((line) => line.trim());

      const startIndex = lines[0].toLowerCase().includes("inspection") ? 1 : 0;
      const inspectionIds = lines
        .slice(startIndex)
        .map((line) => line.split(",")[0].trim())
        .filter((id) => id);

      if (inspectionIds.length === 0) throw new Error("No inspection IDs found in CSV");

      const processedInspections = [];

      for (const inspectionId of inspectionIds) {
        try {
          const response = await fetch(API_CONFIG.url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ inspectionIds: [inspectionId] }),
          });

          if (!response.ok) {
            console.error(`Failed to fetch inspection ${inspectionId}: ${response.status}`);
            continue;
          }

          const data = await response.json();

          if (data.uvpaintInspections && data.uvpaintInspections.length > 0) {
            const inspection = data.uvpaintInspections[0];
            const comparisons = processInspectionData(inspection);

            processedInspections.push({
              inspectionId,
              vehicle: inspection.uvpaintInspection?.vehicleInfo,
              comparisons,
              rawInspection: inspection,
            });
          }
        } catch (err) {
          console.error(`Error processing inspection ${inspectionId}:`, err);
        }
      }

      if (processedInspections.length === 0) throw new Error("No valid inspections could be processed");

      const aggregated = computeAggregatedMetrics(processedInspections);
      setMetrics(aggregated);

      setInspections(processedInspections);
      setCurrentInspectionIndex(0);
      setCurrentComparisonIndex(0);
      setActiveView("comparisons");
      setLoadMethod("csv");
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const adjustZoom = (delta) => setZoom((prev) => Math.max(50, Math.min(200, prev + delta)));

  const goToPreviousComparison = () => setCurrentComparisonIndex((prev) => Math.max(0, prev - 1));

  const goToNextComparison = () => {
    const currentInspection = inspections[currentInspectionIndex];
    if (!currentInspection) return;
    setCurrentComparisonIndex((prev) => Math.min(currentInspection.comparisons.length - 1, prev + 1));
  };

  const goToPrevInspection = () => {
    setCurrentInspectionIndex((prev) => {
      const next = Math.max(0, prev - 1);
      if (next !== prev) setCurrentComparisonIndex(0);
      return next;
    });
  };

  const goToNextInspection = () => {
    setCurrentInspectionIndex((prev) => {
      const next = Math.min(inspections.length - 1, prev + 1);
      if (next !== prev) setCurrentComparisonIndex(0);
      return next;
    });
  };

  const resetApp = () => {
    setLoadMethod(null);
    setInspections([]);
    setCurrentInspectionIndex(0);
    setCurrentComparisonIndex(0);
    setActiveView("comparisons");
    setMetrics({ tableA: [], tableD: [] });
    setError("");
  };

  const currentInspection = inspections[currentInspectionIndex];
  const currentComparison = currentInspection?.comparisons?.[currentComparisonIndex];

  // Keyboard shortcuts:
  // ← / → comparisons, ↑ / ↓ inspections
  useEffect(() => {
    if (!loadMethod || activeView !== "comparisons") return;

    const onKeyDown = (e) => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target?.tagName)) return;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goToPreviousComparison();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goToNextComparison();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        goToPrevInspection();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        goToNextInspection();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [loadMethod, activeView, currentInspectionIndex, inspections, currentComparisonIndex]);

  // Jump dropdown options (camera/type)
  const jumpOptions = useMemo(() => {
    const comps = currentInspection?.comparisons || [];
    return comps.map((c, idx) => ({
      idx,
      label: `${String(idx + 1).padStart(3, "0")} — ${c.name}`,
      value: String(idx),
    }));
  }, [currentInspection]);

  const pageStyle = { background: themeVars.pageBg };

  const cardStyle = {
    background: themeVars.cardBg,
    border: `1px solid ${themeVars.cardBorder}`,
  };

  const panelStyle = {
    background: themeVars.panelBg,
    border: `1px solid ${themeVars.panelBorder}`,
    backdropFilter: "blur(10px)",
  };

  // ✅ Fix #2 (regression): ensure layout sizing exists even if CSS file changed.
  // (This puts the needed CSS back INSIDE the component so it can’t disappear.)
// inside ImageComparison() component, REPLACE your comparisonCss with this (adds debug styling)
const comparisonCss = `
  .comparisonGrid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
    align-items: stretch;
  }
  @media (max-width: 1024px) {
    .comparisonGrid { grid-template-columns: 1fr; }
  }
  .comparisonCard {
    border-radius: 16px;
    padding: 14px;
    overflow: hidden;
  }
  .comparisonHeader {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
  }
  .comparisonTitle {
    font-size: 16px;
    font-weight: 700;
    line-height: 1.2;
  }
  .comparisonBadge {
    font-size: 12px;
    padding: 4px 10px;
    border-radius: 999px;
    font-weight: 700;
    white-space: nowrap;
  }

  /* Debug block */
  .comparisonDebug {
    margin: 6px 0 10px 0;
    padding: 8px 10px;
    border-radius: 10px;
    font-size: 11px;
    line-height: 1.35;
    opacity: 0.95;
    overflow: hidden;
  }
  .comparisonDebugRow {
    display: flex;
    gap: 8px;
    align-items: baseline;
    margin-bottom: 6px;
  }
  .comparisonDebugLabel {
    font-weight: 700;
    opacity: 0.85;
    white-space: nowrap;
  }
  .comparisonDebugValue {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    word-break: break-all;
  }
  .comparisonDebugPre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  }

  .comparisonImageBox {
    height: 420px;
    border-radius: 14px;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .comparisonImg {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    transform-origin: center center;
    will-change: transform;
    user-select: none;
    -webkit-user-drag: none;
  }
  .comparisonEmpty {
    height: 100%;
    width: 100%;
    display: grid;
    place-items: center;
    opacity: 0.9;
  }
  .comparisonEmptyIcon { font-size: 32px; margin-bottom: 10px; }
  .comparisonEmptyText { font-size: 14px; }
  .comparisonStatus { margin-top: 10px; font-size: 12px; opacity: 0.9; }
  .imgFailed { opacity: 0.35; filter: grayscale(1); }
`;
  if (!loadMethod) {
    return (
      <div className="min-h-screen p-8 flex items-center justify-center" style={pageStyle}>
        <style>{comparisonCss}</style>

        <div className="max-w-3xl w-full">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-4xl font-bold" style={{ color: themeVars.headerText }}>
                Image Comparison Platform
              </h1>
              <p style={{ color: themeVars.subText }}>Upload a CSV with inspection IDs to compare versions</p>
            </div>

            <button
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
              className="px-3 py-2 rounded-lg flex items-center gap-2"
              style={panelStyle}
              title="Toggle theme"
            >
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              <span style={{ color: themeVars.text }}>{theme === "dark" ? "Light" : "Dark"}</span>
            </button>
          </div>

          <div className="rounded-xl p-8" style={panelStyle}>
            <div className="flex items-center gap-4 mb-6">
              <FileText className="w-10 h-10" style={{ color: theme === "dark" ? "#60a5fa" : "#2563eb" }} />
              <div>
                <h3 className="text-xl font-semibold" style={{ color: themeVars.text }}>
                  Upload CSV File
                </h3>
                <p className="text-sm mt-1" style={{ color: themeVars.subText }}>
                  Each row should contain an inspection ID
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div
                className="text-xs font-mono p-3 rounded"
                style={{
                  background: theme === "dark" ? "rgba(15,23,42,0.5)" : "rgba(15,23,42,0.04)",
                  color: themeVars.subText,
                }}
              >
                <strong>CSV Format:</strong>
                <br />
                inspectionId
                <br />
                35336435-f455-46bc-a821-cbf2d60ec868
                <br />
                ...
                <br />
                <br />
                <strong>API Endpoint:</strong>
                <br />
                {API_CONFIG.url}
              </div>

              {error && (
                <div
                  className="rounded-lg p-3 text-sm"
                  style={{
                    border: "1px solid rgba(239,68,68,0.5)",
                    background: "rgba(239,68,68,0.08)",
                    color: "#ef4444",
                  }}
                >
                  {error}
                </div>
              )}

              <label className="block">
                <div
                  className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors"
                  style={{
                    borderColor: theme === "dark" ? "rgba(148,163,184,0.35)" : "rgba(15,23,42,0.20)",
                    color: themeVars.text,
                  }}
                >
                  <Upload className="w-12 h-12 mx-auto mb-3" style={{ color: themeVars.subText }} />
                  <p>Click to upload CSV</p>
                  <p className="text-sm mt-1" style={{ color: themeVars.subText }}>
                    or drag and drop
                  </p>
                </div>
                <input type="file" accept=".csv" onChange={handleCSVUpload} className="hidden" disabled={loading} />
              </label>

              {loading && (
                <div className="flex items-center justify-center gap-2" style={{ color: theme === "dark" ? "#60a5fa" : "#2563eb" }}>
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  <span>Processing inspections...</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-8" style={pageStyle}>
      <style>{comparisonCss}</style>

      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-4xl font-bold mb-2" style={{ color: themeVars.headerText }}>
              Image Comparison Platform
            </h1>
            <p style={{ color: themeVars.subText }}>Viewing {inspections.length} inspection(s)</p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
              className="px-3 py-2 rounded-lg flex items-center gap-2"
              style={panelStyle}
              title="Toggle theme"
            >
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              <span style={{ color: themeVars.text }}>{theme === "dark" ? "Light" : "Dark"}</span>
            </button>

            <button
              onClick={resetApp}
              className="px-4 py-2 rounded-lg transition-colors"
              style={{ ...panelStyle, color: themeVars.text }}
            >
              Upload New CSV
            </button>
          </div>
        </div>

        {/* Inspection Tabs */}
        <div className="mb-4 rounded-lg p-2" style={panelStyle}>
          <div className="flex gap-2 overflow-x-auto">
            {inspections.map((insp, idx) => {
              const selected = currentInspectionIndex === idx;
              return (
                <button
                  key={idx}
                  onClick={() => {
                    setCurrentInspectionIndex(idx);
                    setCurrentComparisonIndex(0);
                  }}
                  className="px-4 py-2 rounded-lg whitespace-nowrap transition-colors"
                  style={{
                    background: selected ? (theme === "dark" ? "#2563eb" : "#1d4ed8") : theme === "dark" ? "rgba(148,163,184,0.15)" : "rgba(15,23,42,0.06)",
                    color: selected ? "#fff" : themeVars.text,
                  }}
                >
                  <div className="text-sm font-medium">
                    {insp.vehicle ? `${insp.vehicle.year} ${insp.vehicle.make}` : `Inspection ${idx + 1}`}
                  </div>
                  <div className="text-xs opacity-75">
                    {insp.comparisons.length} comparison{insp.comparisons.length !== 1 ? "s" : ""}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* View Toggle */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setActiveView("comparisons")}
            className="px-4 py-2 rounded-lg"
            style={{
              background: activeView === "comparisons" ? (theme === "dark" ? "#2563eb" : "#1d4ed8") : theme === "dark" ? "rgba(148,163,184,0.15)" : "rgba(15,23,42,0.06)",
              color: activeView === "comparisons" ? "#fff" : themeVars.text,
            }}
          >
            Comparisons
          </button>

          <button
            onClick={() => setActiveView("metrics")}
            className="px-4 py-2 rounded-lg"
            style={{
              background: activeView === "metrics" ? (theme === "dark" ? "#2563eb" : "#1d4ed8") : theme === "dark" ? "rgba(148,163,184,0.15)" : "rgba(15,23,42,0.06)",
              color: activeView === "metrics" ? "#fff" : themeVars.text,
            }}
          >
            Metrics
          </button>
        </div>

        {activeView === "metrics" ? (
          <MetricsTab
            tableA={metrics.tableA}
            tableD={metrics.tableD}
            onJumpToInspection={(inspectionId) => {
              const idx = inspections.findIndex((i) => i.inspectionId === inspectionId);
              if (idx >= 0) {
                setCurrentInspectionIndex(idx);
                setCurrentComparisonIndex(0);
                setActiveView("comparisons");
              }
            }}
          />
        ) : (
          <>
            {/* Controls */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6 rounded-lg p-4" style={panelStyle}>
              <div className="flex items-center gap-3 flex-wrap">
                <span style={{ color: themeVars.text, fontWeight: 600 }}>Zoom:</span>
                <button onClick={() => adjustZoom(-10)} className="p-2 rounded-lg" style={panelStyle}>
                  <ZoomOut className="w-5 h-5" style={{ color: themeVars.text }} />
                </button>
                <span className="font-mono min-w-16 text-center" style={{ color: themeVars.text }}>
                  {zoom}%
                </span>
                <button onClick={() => adjustZoom(10)} className="p-2 rounded-lg" style={panelStyle}>
                  <ZoomIn className="w-5 h-5" style={{ color: themeVars.text }} />
                </button>
                <button
                  onClick={() => setZoom(100)}
                  className="ml-1 px-4 py-2 rounded-lg text-sm"
                  style={{ background: theme === "dark" ? "#2563eb" : "#1d4ed8", color: "#fff" }}
                >
                  Reset
                </button>

                {/* Jump dropdown */}
                <div className="flex items-center gap-2 ml-0 md:ml-3">
                  <span className="text-sm" style={{ color: themeVars.subText }}>
                    Jump:
                  </span>
                  <select
                    value={String(currentComparisonIndex)}
                    onChange={(e) => setCurrentComparisonIndex(Number(e.target.value))}
                    className="px-3 py-2 rounded-lg text-sm"
                    style={{
                      background: theme === "dark" ? "rgba(15,23,42,0.55)" : "#fff",
                      color: themeVars.text,
                      border: `1px solid ${themeVars.panelBorder}`,
                    }}
                  >
                    {jumpOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="text-xs ml-0 md:ml-2" style={{ color: themeVars.subText }}>
                  Shortcuts: ←/→ comparisons, ↑/↓ inspections
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={goToPreviousComparison}
                  disabled={currentComparisonIndex === 0}
                  className="p-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                  style={panelStyle}
                >
                  <ChevronLeft className="w-5 h-5" style={{ color: themeVars.text }} />
                </button>

                <span style={{ color: themeVars.text }} className="px-2">
                  {currentComparisonIndex + 1} / {currentInspection?.comparisons.length || 0}
                </span>

                <button
                  onClick={goToNextComparison}
                  disabled={!currentInspection || currentComparisonIndex === currentInspection.comparisons.length - 1}
                  className="p-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                  style={panelStyle}
                >
                  <ChevronRight className="w-5 h-5" style={{ color: themeVars.text }} />
                </button>
              </div>
            </div>

            {/* Metadata */}
            {currentComparison?.metadata && (
              <div className="rounded-lg p-4 mb-6" style={panelStyle}>
                <h3 className="font-semibold mb-3" style={{ color: themeVars.text }}>
                  {currentComparison.name}
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <span style={{ color: themeVars.subText }}>Inspection ID:</span>
                    <span className="ml-2 text-xs font-mono" style={{ color: themeVars.text }}>
                      {currentInspection.inspectionId}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: themeVars.subText }}>Camera:</span>
                    <span className="ml-2" style={{ color: themeVars.text }}>
                      {currentComparison.metadata.pov.simulatedCamera} {currentComparison.metadata.pov.simulatedCameraSide}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: themeVars.subText }}>Renditions:</span>
                    <span className="ml-2" style={{ color: themeVars.text }}>
                      {currentComparison.metadata.renditions.filter((r) => r !== null).join(" → ")}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: themeVars.subText }}>Vehicle:</span>
                    <span className="ml-2" style={{ color: themeVars.text }}>
                      {currentInspection.vehicle
                        ? `${currentInspection.vehicle.year} ${currentInspection.vehicle.make} ${currentInspection.vehicle.model}`
                        : "N/A"}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Image Comparison */}
{/* Image Comparison */}
{currentComparison && (
  <div className="comparisonGrid">
    {SLOTS.map(({ label, idx }) => {
      const badge = currentComparison.metadata?.renditions?.[idx];
      const actions = currentComparison.metadata?.actions?.[idx];

      // TEMP DEBUG: show exact URL + POV object on the UI
      const imgUrl = currentComparison.images?.[idx] || null;
      const povObj = currentComparison.metadata?.pov || null;

      return (
        <div key={label} className="comparisonCard" style={cardStyle}>
          <div className="comparisonHeader">
            <h3 className="comparisonTitle" style={{ color: themeVars.headerText }}>
              {label}
            </h3>

            {badge !== null && badge !== undefined && (
              <span
                className="comparisonBadge"
                style={{ background: themeVars.chipBg, color: themeVars.chipText }}
              >
                {String(badge) === "OG" ? "OG" : `R${badge}`}
              </span>
            )}
          </div>

          {/* TEMP DEBUG UI */}
          <div
            className="comparisonDebug"
            style={{
              background: theme === "dark" ? "rgba(15,23,42,0.45)" : "rgba(15,23,42,0.04)",
              border: `1px solid ${themeVars.panelBorder}`,
              color: themeVars.text,
            }}
          >
            <div className="comparisonDebugRow">
              <span className="comparisonDebugLabel">URL:</span>
              <span className="comparisonDebugValue">{imgUrl || "(empty)"}</span>
            </div>

            <div className="comparisonDebugRow" style={{ marginBottom: 0 }}>
              <span className="comparisonDebugLabel">POV:</span>
            </div>

            <pre className="comparisonDebugPre">
              {povObj ? JSON.stringify(povObj, null, 2) : "(none)"}
            </pre>
          </div>

          <div className="comparisonImageBox">
            {imgUrl ? (
              <img
                src={imgUrl}
                alt={label}
                style={{ transform: `scale(${zoom / 100})` }}
                className="comparisonImg"
                loading="eager"
                decoding="async"
                // IMPORTANT: keep these removed, otherwise loads fail if server doesn't send CORS headers
                // crossOrigin="anonymous"
                // referrerPolicy="no-referrer"
                onError={(e) => {
                  console.warn("Failed to load image:", e.currentTarget.src);
                  e.currentTarget.alt = "Failed to load";
                  e.currentTarget.classList.add("imgFailed");
                }}
              />
            ) : (
              <div className="comparisonEmpty">
                <div className="comparisonEmptyIcon">📭</div>
                <div className="comparisonEmptyText">Empty Slot</div>
              </div>
            )}
          </div>

          {currentComparison.metadata?.statuses?.[idx] && (
            <div className="comparisonStatus" style={{ color: themeVars.subText }}>
              {currentComparison.metadata.statuses[idx]}
            </div>
          )}

          <div className="comparisonStatus" style={{ color: themeVars.subText }}>
            Actions: {actions ?? "N/A"}
          </div>
        </div>
      );
    })}
  </div>
)}

          </>
        )}
      </div>
    </div>
  );
}
