import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api, { formatApiError, downloadAuthenticatedPdfPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import FloorPlanCanvas, { PLAN_PX } from "@/components/floorplan/FloorPlanCanvas";
import DoorDetailsModal from "@/components/floorplan/DoorDetailsModal";
import InteriorDoorDetailsModal from "@/components/floorplan/InteriorDoorDetailsModal";
import WindowDetailsModal from "@/components/floorplan/WindowDetailsModal";
import FloorPlan3D, { renderLevel3dPng } from "@/components/floorplan/FloorPlan3D";
import LayerPanel from "@/components/floorplan/LayerPanel";
import WallDetail from "@/components/floorplan/WallDetail";
import ObjectCatalog from "@/components/floorplan/ObjectCatalog";
import ObjectCustomize from "@/components/floorplan/ObjectCustomize";
import KitchenDesignPanel from "@/components/floorplan/KitchenDesignPanel";
import ComponentSpecDialog from "@/components/floorplan/ComponentSpecDialog";
import StudioDialogs from "@/components/floorplan/StudioDialogs";
import TakeoffStat from "@/components/floorplan/TakeoffStat";
import ElectricianAdvice from "@/components/floorplan/ElectricianAdvice";
import { computeTakeoffs, interiorSkipsRoof, projectInvolvesRoof } from "@/lib/floorPlan/calc";
import { buildScope, WALL_FINISHES, WORK_KINDS, workOf } from "@/lib/floorPlan/scope";
import { adviseElectrician, findPanel, homeRunPath, isElectricalObject } from "@/lib/floorPlan/electrician";
import { completeElectricalDesign } from "@/lib/floorPlan/electricalDesign";
import { ABOVE_OPTIONS, beamFromWall, beamFromWallAt, needsBeamForOpening, recommendLvl, refreshBeam, syncOpeningBeams } from "@/lib/floorPlan/lvl";
import { createHistory } from "@/lib/floorPlan/history";
import {
  DOOR_STYLES, FLOORING, FOUNDATIONS, LEVEL_PRESETS, LIGHT_MOUNTS, PROJECT_TYPES,
  ROOF_KINDS, WINDOW_INSTALLS, WINDOW_MATERIALS, WINDOW_STYLES,
  isBaseRunObject, applyWallCabinetDrawerRule, libraryById, normalizeDocumentCabinets, normalizeLevelCabinets,
} from "@/lib/floorPlan/library";
import { fitCountertops } from "@/lib/floorPlan/countertops";
import {
  fitCabinetFillers, isRunOccupant, snapCabinetToWall, clearRunForOpening, planSymbolDepth, requiresWallHost, snapApplianceToWall,
} from "@/lib/floorPlan/cabinetRun";
import {
  applyKitchenStyle, autoGenerateCabinets, ensureRangeHood, evaluateKitchen, generateKitchenCounters,
  kitchenDesignOf, placeKitchenAnchor,
} from "@/lib/floorPlan/kitchenDesign";
import { pantryBlocksSink } from "@/lib/floorPlan/professionalLayout";
import { lightingCountForRoom, placeRoomLights, placeSinkLight } from "@/lib/floorPlan/lighting";
import {
  activeLevel, clonePlanObject, emptyDocument, emptyLevel, emptyObject, emptyOpening,
  emptyRoof, emptyRoom, emptyWall, fitRoofToRooms, flagPlumbingWalls, moveRoom, nearestWall, resizeRoom, setWallLength,
  applyInteriorDoorDefaults, createRoomFromOutsideBounds, setRoomWallThickness, snapPoint, updateLevel, wallsFromRoom, wallLength,
} from "@/lib/floorPlan/model";
import { importRoomPlan, installRoomPlanListener, hasNativeRoomPlan, requestNativeScan, SAMPLE_KITCHEN_SCAN, needsScanVerify } from "@/lib/floorPlan/roomplan";
import { createSyncOrigin, usePlanSync } from "@/lib/floorPlan/planSync";
import { formatFtIn, inches, parseFtIn, round2, snapTo, uid } from "@/lib/floorPlan/units";
import {
  clampOpeningOffset,
  applyDoorOpeningPatch,
  rehostOpening,
  setOpeningEndSpan,
  setOpeningStartSpan,
  slideOpening,
  wallInteriorClear,
} from "@/lib/floorPlan/wallOpenings";
import { doorSpecToOpeningPatch, normalizeDoorSpec } from "@/lib/floorPlan/doorSpec";
import {
  OPENING_CATEGORY,
  classifyOpening,
  interiorDoorSpecToOpeningPatch,
  normalizeInteriorDoorSpec,
  normalizeWindowSpec,
  windowSpecToOpeningPatch,
} from "@/lib/floorPlan/openingSpec";
import {
  canCommitSegment,
  clearDrawChain,
  nextChainPointsAfterCommit,
} from "@/lib/floorPlan/wallDraw";
import {
  CORNER_SNAP_TYPES,
  emptySnapSession,
  resolveDrawSnap,
  SNAP_CONFIG,
  SNAP_TYPES,
} from "@/lib/floorPlan/snapEngine";
import {
  applyWallMoveFromOrigin,
  commitAdjacentRoomClosure,
  commitDrawWall,
  mergeSharedPartition,
  signedWallDragDistance,
  weldDrawnWall,
} from "@/lib/floorPlan/planTopology";
import {
  addTwoCornersOnWall,
  applySectionOffsetFromOrigin,
  isReshapeSpanPending,
  movePlanVertex,
  projectPointOnWall,
  roomOutwardNormal,
  signedSectionDragDistance,
} from "@/lib/floorPlan/wallReshape";
import { toast } from "sonner";
import {
  ArrowLeft, Plus, Redo2, Save, Undo2, Box, Presentation, ZoomIn, ZoomOut,
} from "lucide-react";
import { scopeTotal } from "@/lib/floorPlan/priceBook";
import { usd } from "@/lib/format";
import { defaultLayers, toggleLayer } from "@/lib/floorPlan/layers";
import useDeleteHotkey from "@/lib/floorPlan/useDeleteHotkey";

export default function FloorPlanStudio() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isNew = id === "new";
  const history = useRef(createHistory());
  const dirty = useRef(false);
  const hydratedPlanId = useRef("");
  const docRef = useRef(null);
  const metaRef = useRef(null);
  const revisionRef = useRef(0);
  const savingRef = useRef(false);
  const syncOrigin = useRef(createSyncOrigin());
  const [unsaved, setUnsaved] = useState(false);
  const [meta, setMeta] = useState({
    name: "Floor plan",
    client_id: "",
    client_name: "",
    job_id: params.get("job") || "",
    address: "",
    project_type: "Kitchen",
    version_kind: "existing",
  });
  const [doc, setDoc] = useState(() => emptyDocument());
  const [mode, setMode] = useState("select");
  const [selected, setSelected] = useState(null);
  const [view, setView] = useState({ x: 24, y: 72, scale: 1 });
  const [placing, setPlacing] = useState(null);
  const [drawPoints, setDrawPoints] = useState([]);
  const [drawSnap, setDrawSnap] = useState(null);
  const drawSnapSession = useRef(emptySnapSession());
  const wallMoveBase = useRef(null);
  const freeAngleRef = useRef(false);
  const [reshapeMode, setReshapeMode] = useState(null); // null | "add-corners" | "move-corner"
  const [addCornerDraft, setAddCornerDraft] = useState([]); // [{x,y,along}]
  const [show3d, setShow3d] = useState(false);
  const [wallDialog, setWallDialog] = useState(null);
  const [roomDialog, setRoomDialog] = useState(null);
  const [lidarOpen, setLidarOpen] = useState(false);
  const [lidarText, setLidarText] = useState("");
  const [planId, setPlanId] = useState(isNew ? "" : id);
  const [clientView, setClientView] = useState(false);
  const [presenting, setPresenting] = useState(params.get("present") === "1");
  const [phase, setPhase] = useState(params.get("present") === "1" ? "after" : "all");
  const [presentSlider, setPresentSlider] = useState(100);
  const [reportOpen, setReportOpen] = useState(false);
  const [pdfUrl, setPdfUrl] = useState("");
  const [permitOpen, setPermitOpen] = useState(false);
  const [permitPdfUrl, setPermitPdfUrl] = useState("");
  const [permitSheets, setPermitSheets] = useState({ cover: true, wall: true, foundation: true, roof: false, beam: false });
  const [walk3d, setWalk3d] = useState(false);
  const [reportAttach, setReportAttach] = useState({ estimate_id: "", contract_id: "" });
  const [mergeEstimateId, setMergeEstimateId] = useState("");
  const [lightMount, setLightMount] = useState("recessed");
  const [lightMode, setLightMode] = useState("auto");
  const [lightQty, setLightQty] = useState("6");
  const [counterMaterial, setCounterMaterial] = useState("quartz");
  const [layers, setLayers] = useState(() => defaultLayers());
  const [placingAnchor, setPlacingAnchor] = useState(null);
  const [pickingCabinetWalls, setPickingCabinetWalls] = useState(false);
  const [generatorWallIds, setGeneratorWallIds] = useState([]);
  const [islandHint, setIslandHint] = useState("");
  const [specDialog, setSpecDialog] = useState(null);
  const [openingDetails, setOpeningDetails] = useState(null);
  const canvasRef = useRef(null);
  const photoRef = useRef(null);
  const deleteSelectedRef = useRef(() => false);

  const { data: clients = [] } = useQuery({ queryKey: ["clients"], queryFn: async () => (await api.get("/clients")).data });
  const { data: jobs = [] } = useQuery({ queryKey: ["jobs"], queryFn: async () => (await api.get("/jobs")).data });
  const { data: existing } = useQuery({
    queryKey: ["floor-plan", id],
    enabled: !isNew,
    queryFn: async () => (await api.get(`/floor-plans/${id}`)).data,
  });
  const { data: jobSheet } = useQuery({
    queryKey: ["job-sheet", meta.job_id],
    enabled: Boolean(meta.job_id),
    queryFn: async () => (await api.get(`/jobs/${meta.job_id}/sheet`)).data,
  });
  const { data: estimates = [] } = useQuery({
    queryKey: ["estimates"],
    queryFn: async () => (await api.get("/estimates")).data,
  });
  const { data: contracts = [] } = useQuery({
    queryKey: ["contracts"],
    queryFn: async () => (await api.get("/contracts")).data,
  });
  const permitQuery = useQuery({
    queryKey: ["permit-details", planId],
    enabled: Boolean(permitOpen && planId),
    queryFn: async () => (await api.get(`/floor-plans/${planId}/permit-details`)).data,
  });
  const permitPreview = permitQuery.data;

  const applySavedPlan = useCallback((saved) => {
    if (!saved?.id) return;
    revisionRef.current = Number(saved.revision || 0);
    hydratedPlanId.current = saved.id;
    setPlanId(saved.id);
    if (saved.document) setDoc(normalizeDocumentCabinets(saved.document));
    setMeta({
      name: saved.name || saved.meta?.name || "Floor plan",
      client_id: saved.client_id || saved.meta?.client_id || "",
      client_name: saved.client_name || saved.meta?.client_name || "",
      job_id: saved.job_id || saved.meta?.job_id || "",
      address: saved.address || saved.meta?.address || "",
      project_type: saved.project_type || saved.meta?.project_type || "Kitchen",
      version_kind: saved.version_kind || saved.meta?.version_kind || "existing",
    });
    dirty.current = false;
    setUnsaved(false);
    qc.setQueryData(["floor-plan", saved.id], (current) => ({ ...(current || {}), ...saved }));
  }, [qc]);

  useEffect(() => {
    if (!existing) return;
    if (dirty.current && hydratedPlanId.current === existing.id) return;
    if (revisionRef.current && Number(existing.revision || 0) < revisionRef.current) return;
    hydratedPlanId.current = existing.id;
    revisionRef.current = Number(existing.revision || 0);
    dirty.current = false;
    setUnsaved(false);
    setMeta({
      name: existing.name,
      client_id: existing.client_id || "",
      client_name: existing.client_name || "",
      job_id: existing.job_id || "",
      address: existing.address || "",
      project_type: existing.project_type || "Kitchen",
      version_kind: existing.version_kind || "existing",
    });
    setDoc(normalizeDocumentCabinets(existing.document || emptyDocument()));
    setPlanId(existing.id);
    if (existing.showcase) {
      setPhase("after");
    }
  }, [existing]);

  useEffect(() => {
    if (!jobSheet?.sheet) return;
    setMeta((prev) => ({
      ...prev,
      client_id: prev.client_id || jobSheet.sheet.client_id || jobSheet.job?.client_id || "",
      client_name: prev.client_name || jobSheet.sheet.client_name || jobSheet.job?.client_name || "",
      address: prev.address || jobSheet.sheet.address || "",
      project_type: prev.project_type || jobSheet.sheet.project_type || "Kitchen",
      name: prev.name === "Floor plan" ? `${jobSheet.sheet.client_name || "Job"} floor plan` : prev.name,
    }));
  }, [jobSheet]);

  const enterPresent = useCallback(() => {
    setPresenting(true);
    setClientView(true);
    setPhase("after");
    setPresentSlider(100);
    const next = new URLSearchParams(params);
    next.set("present", "1");
    setParams(next, { replace: true });
  }, [params, setParams]);

  const exitPresent = useCallback(() => {
    setPresenting(false);
    setClientView(false);
    setPhase("all");
    const next = new URLSearchParams(params);
    next.delete("present");
    setParams(next, { replace: true });
  }, [params, setParams]);

  useEffect(() => {
    if (params.get("permit") === "1") setPermitOpen(true);
    if (params.get("scan") === "1") {
      setLidarOpen(true);
      if (hasNativeRoomPlan()) {
        requestNativeScan();
        toast.message("Starting RoomPlan… walk the kitchen slowly.");
      }
    }
    if (params.get("present") === "1") {
      setPresenting(true);
      setClientView(true);
      setPhase("after");
    }
  }, [params]);

  useEffect(() => {
    if (!presenting) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") exitPresent();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [presenting, exitPresent]);

  useEffect(() => {
    if (clientView || presenting) return undefined;
    const onKey = (event) => {
      if (event.key === "Alt") freeAngleRef.current = true;
      if (event.key !== "Escape") return;
      const tag = String(event.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || event.target?.isContentEditable) return;
      if (reshapeMode || addCornerDraft.length) {
        setReshapeMode(null);
        setAddCornerDraft([]);
        event.preventDefault();
        return;
      }
      if (drawPoints.length || mode === "draw") {
        setDrawPoints(clearDrawChain());
        setDrawSnap(null);
        drawSnapSession.current = emptySnapSession();
        event.preventDefault();
      }
    };
    const onKeyUp = (event) => {
      if (event.key === "Alt") freeAngleRef.current = false;
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [clientView, presenting, drawPoints.length, mode, reshapeMode, addCornerDraft.length]);

  const level = activeLevel(doc);
  docRef.current = doc;
  metaRef.current = meta;
  const takeoffs = useMemo(() => computeTakeoffs(doc, meta.project_type), [doc, meta.project_type]);
  const scope = useMemo(() => buildScope(doc, meta.project_type), [doc, meta.project_type]);

  const cycleWork = (current) => {
    const order = ["existing", "demo", "new"];
    return order[(order.indexOf(current || "existing") + 1) % order.length];
  };

  const captureVoice = (apply) => {
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Rec) {
      toast.error("Voice notes work in Safari on iPhone. You can still type a note.");
      return;
    }
    const rec = new Rec();
    rec.lang = "en-US";
    rec.onresult = (ev) => apply(ev.results[0][0].transcript);
    rec.onerror = () => toast.error("Could not hear that note. Please try again.");
    rec.start();
    toast.message("Listening…");
  };

  const markUnsaved = () => {
    dirty.current = true;
    setUnsaved(true);
  };

  const commit = (nextDoc) => {
    history.current.push(doc);
    markUnsaved();
    setDoc(nextDoc);
  };

  /** Undo / redo must mark the plan dirty so auto-save persists the reverted state. */
  const stepHistory = (direction) => {
    try {
      const next = direction === "redo" ? history.current.redo(doc) : history.current.undo(doc);
      if (next === doc) return;
      markUnsaved();
      setDoc(next);
    } catch (err) {
      console.error(`[History] ${direction} failed`, err);
      toast.error(`Could not ${direction}. Please try again.`);
    }
  };

  const patchLevel = (updater) => {
    commit(updateLevel(doc, level.id, (lvl) => flagPlumbingWalls(syncOpeningBeams(normalizeLevelCabinets(updater(lvl))))));
  };

  /** Live drag updates — one undo entry from beginGesture, no stack flood. */
  const patchLevelLive = (updater) => {
    markUnsaved();
    setDoc((prev) => updateLevel(prev, level.id, (lvl) => flagPlumbingWalls(syncOpeningBeams(normalizeLevelCabinets(updater(lvl))))));
  };

  const finishCabinetRun = (lvl) => {
    const withHood = ensureRangeHood(lvl, doc.house_standards?.defaults);
    const objects = (withHood.objects || []).map((obj) => applyWallCabinetDrawerRule(obj, withHood));
    let next = fitCabinetFillers({ ...withHood, objects });
    if ((next.objects || []).some(isBaseRunObject)) {
      next = fitCountertops(next, { snap: doc.snap, material: counterMaterial });
    }
    return next;
  };

  const placeOrUpdateObject = (lvl, obj, { announce = false, insert = false, onReject = null } = {}) => {
    try {
      const others = (lvl.objects || []).filter((o) => o.id !== obj.id);
      let result;
      if (requiresWallHost(obj)) {
        // Appliances only live on an interior or exterior wall; off-wall moves keep the last spot.
        result = snapApplianceToWall(obj, { ...lvl, objects: others }, doc.snap);
        if (!result.onWall) {
          if (announce || insert) {
            console.warn("[Placement] appliance rejected — no host wall", { item: obj.library_id, x: obj.x, y: obj.y });
          }
          onReject?.(result.reason);
          return lvl;
        }
      } else {
        result = snapCabinetToWall(obj, { ...lvl, objects: others }, doc.snap);
      }
      if (announce && !result.fit && result.reason) toast.message(result.reason);
      const placed = applyWallCabinetDrawerRule(result.object, { ...lvl, objects: [...others, result.object] });
      if (pantryBlocksSink({ ...lvl, objects: [...others, placed] }, placed)) {
        if (announce || insert) toast.error("A pantry may contain only cabinets, shelves, and storage — never a sink.");
        return lvl;
      }
      const objects = insert ? [...others, placed] : (lvl.objects || []).map((o) => (o.id === obj.id ? placed : o));
      return finishCabinetRun({ ...lvl, objects });
    } catch (err) {
      console.error("Cabinet placement failed", err);
      return lvl;
    }
  };

  const save = useMutation({
    mutationFn: async () => {
      const payload = { ...meta, document: doc };
      if (planId) return (await api.put(`/floor-plans/${planId}`, payload)).data;
      return (await api.post("/floor-plans", payload)).data;
    },
    onSuccess: (saved) => {
      dirty.current = false;
      setUnsaved(false);
      setPlanId(saved.id);
      hydratedPlanId.current = saved.id;
      revisionRef.current = Number(saved.revision || 0);
      qc.invalidateQueries({ queryKey: ["floor-plans"] });
      qc.setQueryData(["floor-plan", saved.id], saved);
      toast.success(saved.drive?.web_view_link ? "Saved and copied to Google Drive" : "Floor plan saved. Reloads will keep this copy.");
      if (isNew) navigate(`/floor-plans/${saved.id}`, { replace: true });
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not save the floor plan. Please try again.")),
  });

  const runSave = () => {
    try {
      save.mutate();
    } catch (err) {
      console.error("Could not save the floor plan", err);
      toast.error("Could not save the floor plan. Please try again.");
    }
  };

  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    const onKey = (event) => {
      if (!(event.metaKey || event.ctrlKey) || String(event.key || "").toLowerCase() !== "s") return;
      event.preventDefault();
      if (clientView || presenting) return;
      try {
        saveRef.current.mutate();
      } catch (err) {
        console.error("Could not save the floor plan", err);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clientView, presenting]);

  const duplicate = useMutation({
    mutationFn: async () => (await api.post(`/floor-plans/${planId}/duplicate`, { version_kind: meta.version_kind === "existing" ? "proposed" : "existing" })).data,
    onSuccess: (saved) => {
      toast.success("Version copied");
      navigate(`/floor-plans/${saved.id}`);
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not copy this version. Please try again.")),
  });

  const attachOpening = (wall, kind, libItem, world) => {
    try {
      const opening = emptyOpening(kind);
      if (libItem) {
        opening.width = libItem.width;
        opening.height = libItem.height;
        opening.style = libItem.id?.includes("french") ? "french"
          : libItem.id?.includes("sh-") ? "single-hung"
            : libItem.id?.includes("slider") ? "slider"
              : libItem.id?.includes("picture") ? "picture"
                : libItem.id?.includes("casement") ? "casement"
                  : libItem.id?.includes("awning") ? "awning"
                    : libItem.id?.includes("dh") ? "double-hung"
                      : opening.style;
        opening.storm = Boolean(libItem.id?.includes("ext"));
        opening.leafs = Number(libItem.leafs) || (opening.style === "french" ? 2 : 1);
        opening.lites = Number(libItem.lites) || (opening.style === "french" ? 4 : 0);
        opening.model_number = libItem.sku || "";
        opening.manufacturer = libItem.manufacturer || "";
        opening.description = libItem.description || libItem.name || "";
        opening.exterior = Boolean(libItem.id?.includes("ext"));
        if (kind === "window") {
          opening.material = opening.material || "vinyl";
          opening.install = opening.install || "new-construction";
          opening.extension_jambs = opening.install !== "replacement";
        }
      }
      if (kind === "door") {
        const wantsInterior = wall.kind === "interior"
          || opening.exterior === false
          || (libItem && !String(libItem.id || "").includes("ext") && wall.kind === "interior");
        if (wantsInterior && !(libItem && String(libItem.id || "").includes("ext"))) {
          applyInteriorDoorDefaults(opening);
        } else {
          opening.exterior = true;
          opening.opening_category = OPENING_CATEGORY.EXTERIOR_DOOR;
        }
      }
      if (kind === "window") {
        opening.opening_category = OPENING_CATEGORY.WINDOW;
        opening.window_type = opening.window_type
          || (["single-hung", "double-hung", "casement", "awning", "slider", "picture", "fixed"].includes(opening.style)
            ? (opening.style === "picture" ? "fixed" : opening.style)
            : "double-hung");
        opening.sill_height_above_floor = opening.sill_height_above_floor || opening.sill || 36;
        if (opening.rough_opening_mode !== "manual") {
          opening.rough_opening_width = round2(opening.width + 1);
          opening.rough_opening_height = round2(opening.height + 1);
        }
      }
      const hit = nearestWall([wall], world.x, world.y, 80) || { t: 0.15 };
      const along = hit.t * wallLength(wall) - opening.width / 2;
      // Temporary level context for clear clamps
      const probeLevel = { rooms: level.rooms, walls: level.walls };
      opening.offset = clampOpeningOffset(probeLevel, wall, opening, along, 1);
      patchLevel((lvl) => {
        const withOpening = {
          ...lvl,
          walls: lvl.walls.map((w) => w.id === wall.id ? { ...w, openings: [...(w.openings || []), opening] } : w),
        };
        const host = withOpening.walls.find((w) => w.id === wall.id) || wall;
        return clearRunForOpening(withOpening, host, opening);
      });
      setSelected({ type: "opening", id: opening.id, wallId: wall.id });
      if (needsBeamForOpening(opening)) {
        const rec = recommendLvl({
          span_in: opening.width,
          tributary_in: 144,
          wall_kind: wall.kind === "exterior" ? "exterior" : "interior",
          wall_thickness: wall.thickness,
          above: "bedroom",
          stories_above: 1,
        });
        toast.success(`Opening cut. ${rec.label} is on that header.`);
      } else {
        toast.success("Opening placed. Drag cabinets to fine-tune the run.");
      }
    } catch (err) {
      console.error("Could not place that opening", err);
      toast.error("Could not place that opening. Please try again.");
    }
  };

  const resolvePointLineSnap = (world, { origin = null, chainStart = null, chainWallIds = [], freeAngle = false } = {}) => {
    try {
      const resolved = resolveDrawSnap({
        cursorWorld: world,
        origin,
        chainStart,
        chainWallIds,
        walls: level.walls,
        rooms: level.rooms,
        vertices: level.vertices,
        gridSnap: doc.snap || 6,
        scale: view.scale * PLAN_PX,
        freeAngle,
        session: drawSnapSession.current,
      });
      drawSnapSession.current = resolved.session;
      return resolved;
    } catch (err) {
      console.error("[PointLine] snap resolve failed", { error: err?.message || err, world });
      drawSnapSession.current = emptySnapSession();
      return {
        point: { x: round2(world.x), y: round2(world.y) },
        candidate: { type: SNAP_TYPES.FREE, x: round2(world.x), y: round2(world.y), label: "" },
        session: drawSnapSession.current,
        label: "",
        guides: [],
      };
    }
  };

  const onCanvasTap = (world, extra) => {
    if (pickingCabinetWalls) return;
    const snapped = snapPoint(world.x, world.y, doc.snap || 6, level.walls);
    if (placingAnchor) {
      const preview = placeKitchenAnchor(level, placingAnchor, snapped, kitchenDesignOf(doc), doc.house_standards?.defaults);
      if (preview._kitchenError) {
        // Keep the anchor armed so the next tap can land on a wall.
        console.warn("[Placement] kitchen anchor rejected", { kind: placingAnchor, x: snapped.x, y: snapped.y, reason: preview._kitchenError });
        toast.error(preview._kitchenError);
        return;
      }
      patchLevel((lvl) => {
        const next = placeKitchenAnchor(lvl, placingAnchor, snapped, kitchenDesignOf(doc), doc.house_standards?.defaults);
        return next._kitchenError ? lvl : next;
      });
      toast.success(`${placingAnchor === "range" ? "Range" : placingAnchor === "fridge" ? "Refrigerator" : placingAnchor === "sink" ? "Sink" : "Dishwasher"} locked to that utility`);
      setPlacingAnchor(null);
      return;
    }
    if (mode === "room") {
      if (extra.doubled && selected?.type === "room") {
        const room = level.rooms.find((r) => r.id === selected.id);
        if (room) setRoomDialog({ ...room, w: formatFtIn(room.width), d: formatFtIn(room.depth) });
      }
      // Room blocks are created by click-drag (onRoomDraw), not a single tap.
      return;
    }
    if (mode === "draw") {
      // Transient Point & Line — ortho/magnetic snap; commit is one history transaction.
      if (extra.doubled) {
        setDrawPoints(clearDrawChain());
        setDrawSnap(null);
        drawSnapSession.current = emptySnapSession();
        return;
      }
      const previous = drawPoints[drawPoints.length - 1] || null;
      const chainStartPt = previous?.chainStart
        || (drawPoints[0] && !drawPoints[0].fromCommit ? { x: drawPoints[0].x, y: drawPoints[0].y } : null);
      const chainWallIds = previous?.chainWallIds || drawPoints.find((p) => p.chainWallIds)?.chainWallIds || [];
      const resolved = resolvePointLineSnap(world, {
        origin: previous,
        chainStart: chainStartPt,
        chainWallIds,
        freeAngle: freeAngleRef.current || Boolean(extra.freeAngle),
      });
      setDrawSnap(resolved);
      const snapped = resolved.point;

      if (previous && canCommitSegment(previous, snapped)) {
        const continued = Boolean(previous.fromCommit);
        const closing = resolved.candidate?.type === SNAP_TYPES.ROOM_CLOSE;
        const viaExisting = Boolean(resolved.candidate?.meta?.viaExisting && resolved.candidate?.meta?.closingWallId);
        const wall = emptyWall(previous.x, previous.y, snapped.x, snapped.y, continued ? "interior" : "exterior");
        let formedRoom = false;
        let commitFailed = false;
        patchLevel((lvl) => {
          try {
            if (closing && viaExisting) {
              const closed = commitAdjacentRoomClosure(lvl, {
                wallPartial: wall,
                chainStart: chainStartPt,
                closingWallId: resolved.candidate.meta.closingWallId,
                chainWallIds,
              });
              formedRoom = Boolean(closed.room);
              return closed.level;
            }
            const committed = commitDrawWall(lvl, wall, {
              closeTo: closing ? snapped : null,
            });
            return weldDrawnWall(committed.level, committed.wall.id).level;
          } catch (err) {
            commitFailed = true;
            console.error("[PointLine] wall commit failed", {
              error: err?.message || err,
              from: { x: previous.x, y: previous.y },
              to: snapped,
              snap: resolved.candidate?.type,
            });
            return lvl;
          }
        });
        if (commitFailed) {
          toast.error("Could not place that wall. Please try again.");
          return;
        }
        if (closing) {
          setDrawPoints(clearDrawChain());
          setDrawSnap(null);
          drawSnapSession.current = emptySnapSession();
          toast.success(formedRoom || viaExisting ? "Room closed — shared wall reused." : "Room closed.");
          return;
        }
        const startAnchor = previous.chainStart
          || (!continued ? { x: previous.x, y: previous.y } : chainStartPt);
        setDrawPoints(nextChainPointsAfterCommit(snapped).map((pt) => ({
          ...pt,
          fromCommit: true,
          chainStart: startAnchor,
          chainWallIds: [...chainWallIds, wall.id],
        })));
        return;
      }
      if (previous) {
        // Segment too short — keep chain, do not restart.
        return;
      }
      // First click — corner / endpoint wins; else the exact point ON the wall under the cursor.
      const startType = resolved.candidate?.type;
      const isCorner = CORNER_SNAP_TYPES.has(startType);
      const onWallId = startType === SNAP_TYPES.WALL_AXIS ? resolved.candidate?.meta?.wallId : null;
      const fallbackWall = !isCorner && !onWallId
        ? nearestWall(level.walls, snapped.x, snapped.y, SNAP_CONFIG.acquireRadiusPx / Math.max(view.scale * PLAN_PX, 0.01))
        : null;
      let startPt;
      if (isCorner) {
        startPt = {
          x: snapped.x,
          y: snapped.y,
          fromCommit: false,
          chainStart: { x: snapped.x, y: snapped.y },
          chainWallIds: [],
          startLabel: resolved.label || "CORNER",
        };
      } else if (onWallId || fallbackWall) {
        const sx = onWallId ? snapped.x : round2(fallbackWall.x);
        const sy = onWallId ? snapped.y : round2(fallbackWall.y);
        startPt = {
          x: sx,
          y: sy,
          fromCommit: false,
          onWallId: onWallId || fallbackWall.wall.id,
          chainStart: { x: sx, y: sy },
          chainWallIds: [],
          startLabel: "ON WALL",
        };
      } else {
        startPt = {
          x: snapped.x,
          y: snapped.y,
          fromCommit: false,
          chainStart: { x: snapped.x, y: snapped.y },
          chainWallIds: [],
        };
      }
      setDrawPoints([startPt]);
      drawSnapSession.current = emptySnapSession();
      return;
    }
    if (placing) {
      const tags = placing.tags || [];
      if (tags.includes("lvl")) {
        const hit = nearestWall(level.walls, snapped.x, snapped.y, 28);
        if (!hit) {
          toast.error("Tap a wall to place that LVL.");
          return;
        }
        const beam = beamFromWall(hit.wall, { stories_above: 1, above: "bedroom" });
        patchLevel((lvl) => ({ ...lvl, beams: [...(lvl.beams || []), beam] }));
        setSelected({ type: "beam", id: beam.id });
        toast.message("LVL proposed — check the structural panel.");
        return;
      }
      const openingKind = tags.includes("window") ? "window" : tags.includes("cased") ? "cased" : tags.includes("door") ? "door" : "";
      if (openingKind) {
        const hit = nearestWall(level.walls, snapped.x, snapped.y, 28);
        if (!hit) {
          toast.error("Tap a wall to place that opening.");
          return;
        }
        attachOpening(hit.wall, openingKind, placing, snapped);
        return;
      }
      if ((placing.tags || []).includes("layout") || placing.id === "light-layout") {
        const room = (level.rooms || []).find((r) => snapped.x >= r.x && snapped.x <= r.x + r.width && snapped.y >= r.y && snapped.y <= r.y + r.depth);
        if (!room) {
          toast.error("Tap inside a room to auto-space the lights.");
          return;
        }
        patchLevel((lvl) => placeRoomLights(lvl, room, {
          mount: lightMount,
          mode: lightMode,
          quantity: Number(lightQty) || lightingCountForRoom(room),
        }));
        toast.success(lightMode === "quantity" ? `Placed ${lightQty} lights in ${room.name}` : `Auto-spaced lights in ${room.name}`);
        return;
      }
      const draft = emptyObject(placing, snapped.x, snapped.y, doc.house_standards?.defaults);
      const placed = isRunOccupant(draft) || requiresWallHost(draft)
        ? { ...draft, x: round2(snapped.x - inches(draft.width) / 2), y: round2(snapped.y - inches(draft.depth) / 2) }
        : draft;
      if (requiresWallHost(placed)) {
        const check = snapApplianceToWall(placed, level, doc.snap);
        if (!check.onWall) {
          console.warn("[Placement] appliance tap off-wall", { item: placed.library_id, x: snapped.x, y: snapped.y });
          toast.error(check.reason);
          return;
        }
      }
      let rejected = "";
      patchLevel((lvl) => placeOrUpdateObject(lvl, placed, {
        announce: true,
        insert: true,
        onReject: (reason) => { rejected = reason || "Tap on or next to a wall to place that appliance."; },
      }));
      if (rejected) {
        toast.error(rejected);
        return;
      }
      setSelected({ type: "object", id: placed.id });
      if (isElectricalObject(placed) || (placing.tags || []).includes("appliance")) {
        toast.message("Electrician notes are in the inspector.");
      }
      return;
    }
    if (["door", "window", "cased"].includes(mode)) {
      const hit = nearestWall(level.walls, world.x, world.y, 36);
      if (!hit) {
        toast.error("Click a wall to cut that opening.");
        return;
      }
      attachOpening(hit.wall, mode === "cased" ? "cased" : mode, null, world);
    }
  };

  const attach = useMutation({
    mutationFn: async (payload) => (await api.post(`/floor-plans/${planId}/attach`, payload)).data,
    onSuccess: () => toast.success("Attached to the estimate or contract"),
    onError: async (err) => toast.error(await formatApiError(err, "Could not attach this floor plan. Please try again.")),
  });

  const sendEstimate = useMutation({
    mutationFn: async (estimateId) => {
      const saved = await save.mutateAsync();
      return (await api.post(`/floor-plans/${saved.id}/send-to-estimate`, { estimate_id: estimateId || mergeEstimateId || "" })).data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["estimates"] });
      const priced = data.priced_total ? ` · ${usd(data.priced_total)}` : "";
      toast.success(data.estimate_number ? `${data.item_count || "Quantities"} sent to ${data.estimate_number}${priced}` : `Quantities sent to the estimate${priced}`);
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not send quantities to an estimate. Please try again.")),
  });

  const generateReport = useMutation({
    mutationFn: async () => {
      const saved = await save.mutateAsync();
      const originalLevel = doc.active_level_id;
      const originalPhase = phase;
      const levels = {};
      for (const lvl of doc.levels || []) {
        flushSync(() => {
          setDoc((current) => ({ ...current, active_level_id: lvl.id }));
          setPhase("after");
        });
        const png2d = await canvasRef.current?.capturePng?.();
        let png3d = "";
        try {
          png3d = await renderLevel3dPng(lvl, null, layers, "after");
        } catch (err) {
          console.error("3D snapshot failed", err);
        }
        levels[lvl.id] = { png_2d: png2d || "", png_3d: png3d || "" };
      }
      flushSync(() => {
        setDoc((current) => ({ ...current, active_level_id: originalLevel || current.active_level_id }));
        setPhase("before");
      });
      const before = await canvasRef.current?.capturePng?.();
      flushSync(() => setPhase("after"));
      const after = await canvasRef.current?.capturePng?.();
      flushSync(() => setPhase(originalPhase));
      const url = await downloadAuthenticatedPdfPost(
        `/floor-plans/${saved.id}/report`,
        {
          snapshots: { levels, before: before || "", after: after || "" },
          estimate_id: reportAttach.estimate_id || "",
          contract_id: reportAttach.contract_id || "",
        },
        `${(meta.client_name || "Client").replace(/\s+/g, "-")}-design-proposal.pdf`,
        "Could not build the client report. Please try again.",
      );
      return url;
    },
    onSuccess: (url) => {
      setPdfUrl(url);
      qc.invalidateQueries({ queryKey: ["estimates"] });
      qc.invalidateQueries({ queryKey: ["contracts"] });
      toast.success("Client report ready — saved to Drive when connected");
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not build the client report. Please try again.")),
  });

  const openPermit = async () => {
    try {
      if (!planId) await save.mutateAsync();
      setPermitOpen(true);
    } catch {
      toast.error("Save the floor plan first, then generate permit details.");
    }
  };

  const generatePermit = useMutation({
    mutationFn: async () => {
      const saved = await save.mutateAsync();
      const url = await downloadAuthenticatedPdfPost(
        `/floor-plans/${saved.id}/permit-details`,
        { sheets: permitSheets },
        `${(meta.client_name || "Client").replace(/\s+/g, "-")}-permit-details.pdf`,
        "Could not build the permit details. Please try again.",
      );
      return url;
    },
    onSuccess: (url) => {
      setPermitPdfUrl(url);
      toast.success("Permit details ready — saved to Drive when connected");
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not build the permit details. Please try again.")),
  });

  useEffect(() => {
    if (!planId) return undefined;
    const persistQuiet = () => {
      if (!dirty.current || !planId || !docRef.current || savingRef.current) return;
      savingRef.current = true;
      dirty.current = false;
      api.put(`/floor-plans/${planId}`, { ...metaRef.current, document: docRef.current })
        .then((res) => {
          revisionRef.current = Number(res.data?.revision || revisionRef.current);
          if (!dirty.current) setUnsaved(false);
          if (res.data?.drive?.web_view_link) toast.success("Auto-saved to Google Drive");
        })
        .catch((err) => {
          dirty.current = true;
          setUnsaved(true);
          console.error("Auto-save failed", err);
        })
        .finally(() => {
          savingRef.current = false;
        });
    };
    const debounce = setTimeout(persistQuiet, unsaved ? 2500 : 12000);
    const timer = setInterval(persistQuiet, 12000);
    return () => {
      clearTimeout(debounce);
      clearInterval(timer);
    };
  }, [planId, unsaved, doc]);

  const syncStatus = usePlanSync({
    planId,
    origin: syncOrigin.current,
    enabled: Boolean(planId) && !isNew,
    getRevision: () => revisionRef.current,
    isDirty: () => dirty.current,
    onRemote: (msg) => {
      try {
        applySavedPlan({
          id: planId,
          revision: msg.revision,
          updated_at: msg.updated_at,
          document: msg.document,
          ...(msg.meta || {}),
        });
        toast.message("Updated from another device");
      } catch (err) {
        console.error("Could not apply a remote plan update", err);
      }
    },
  });

  const onSelect = (sel) => {
    if (pickingCabinetWalls) {
      if (sel?.type === "wall" && sel.id) {
        setGeneratorWallIds((prev) => prev.includes(sel.id) ? prev.filter((id) => id !== sel.id) : [...prev, sel.id]);
      }
      return;
    }
    setSelected(sel);
  };

  const cancelCabinetWallPick = () => {
    setPickingCabinetWalls(false);
    setGeneratorWallIds([]);
  };

  const confirmCabinetWallPick = () => {
    if (!generatorWallIds.length) {
      toast.error("Click at least one wall that should receive cabinets.");
      return;
    }
    const design = kitchenDesignOf(doc);
    const wallIds = [...generatorWallIds];
    history.current.push(doc);
    dirty.current = true;
    setUnsaved(true);
    setDoc((current) => {
      const lvl = activeLevel(current);
      const result = autoGenerateCabinets(lvl, design, current.house_standards?.defaults, wallIds);
      return updateLevel(current, lvl.id, () => flagPlumbingWalls(syncOpeningBeams(result.level)));
    });
    setPickingCabinetWalls(false);
    setGeneratorWallIds([]);
    toast.success("Auto Generator placed cabinets on the selected walls. You can still drag items by hand.");
  };

  const openOpeningDetails = (wallId, openingId) => {
    try {
      const wall = (level.walls || []).find((w) => w.id === wallId);
      const opening = (wall?.openings || []).find((o) => o.id === openingId);
      if (!wall || !opening) return;
      const category = classifyOpening(opening, wall);
      if (category === OPENING_CATEGORY.CASED) {
        setSpecDialog({ type: "opening", id: opening.id, wallId: wall.id, data: { ...opening } });
        return;
      }
      setSelected({ type: "opening", id: openingId, wallId });
      let data;
      if (category === OPENING_CATEGORY.WINDOW) data = normalizeWindowSpec(opening);
      else if (category === OPENING_CATEGORY.INTERIOR_DOOR) data = normalizeInteriorDoorSpec(opening);
      else data = normalizeDoorSpec(opening);
      setOpeningDetails({ category, wallId, openingId, data });
    } catch (err) {
      console.error("Could not open opening details", err);
      toast.error("Could not open opening details.");
    }
  };

  const applyOpeningDetails = ({ wallId, openingId, data, category: categoryHint }) => {
    try {
      const wall = (level.walls || []).find((w) => w.id === wallId);
      const opening = (wall?.openings || []).find((o) => o.id === openingId);
      const category = categoryHint || classifyOpening(opening || data, wall);
      const patch = category === OPENING_CATEGORY.WINDOW
        ? windowSpecToOpeningPatch(data)
        : category === OPENING_CATEGORY.INTERIOR_DOOR
          ? interiorDoorSpecToOpeningPatch(data)
          : doorSpecToOpeningPatch(data);
      let failedReason = "";
      patchLevel((lvl) => {
        const result = applyDoorOpeningPatch(lvl, wallId, openingId, patch, 0.25);
        if (!result.ok) {
          failedReason = result.reason || "Could not apply opening changes.";
          return lvl;
        }
        const host = (result.level.walls || []).find((w) => w.id === wallId);
        const nextOpening = host?.openings?.find((o) => o.id === openingId);
        return nextOpening && host ? clearRunForOpening(result.level, host, nextOpening) : result.level;
      });
      if (failedReason) {
        toast.error(failedReason);
        return;
      }
      setOpeningDetails(null);
      const label = category === OPENING_CATEGORY.WINDOW
        ? "Window"
        : category === OPENING_CATEGORY.INTERIOR_DOOR
          ? "Interior door"
          : "Exterior door";
      toast.success(`${label} details saved to the plan.`);
    } catch (err) {
      console.error("Could not save opening details", err);
      toast.error("Could not save opening details. Please try again.");
    }
  };

  const openSpecFor = (sel) => {
    try {
      if (pickingCabinetWalls) return;
      if (!sel) return;
      if (sel.type === "object") {
        const obj = (level.objects || []).find((o) => o.id === sel.id);
        if (obj) setSpecDialog({ type: "object", id: obj.id, data: { ...obj } });
        return;
      }
      if (sel.type === "opening") {
        const wall = (level.walls || []).find((w) => w.id === sel.wallId);
        const opening = (wall?.openings || []).find((o) => o.id === sel.id);
        if (wall && opening) {
          openOpeningDetails(wall.id, opening.id);
          return;
        }
        return;
      }
      if (sel.type === "wall") {
        const wall = (level.walls || []).find((w) => w.id === sel.id);
        if (wall) {
          setSpecDialog({
            type: "wall",
            id: wall.id,
            clickT: Number.isFinite(Number(sel.t)) ? Number(sel.t) : 0.5,
            data: {
              ...wall,
              length: wallLength(wall),
              header_span: 48,
              header_trib: 144,
              header_above: "bedroom",
              header_stories: 1,
              stud_spacing: wall.stud_spacing || 16,
              foundation_contact: Boolean(wall.foundation_contact),
              bottom_plate_treatment: wall.bottom_plate_treatment || "standard",
            },
          });
        }
        return;
      }
      if (sel.type === "beam") {
        const beam = (level.beams || []).find((b) => b.id === sel.id);
        if (beam) setSpecDialog({ type: "beam", id: beam.id, data: { ...beam } });
        return;
      }
      if (sel.type === "room") {
        const room = (level.rooms || []).find((r) => r.id === sel.id);
        if (room) setSpecDialog({ type: "room", id: room.id, data: { ...room } });
      }
    } catch (err) {
      console.error("Could not open component specs", err);
      toast.error("Could not open those specs. Please try again.");
    }
  };

  const applySpec = (next) => {
    try {
      if (!next?.data) return;
      if (next.type === "object") {
        const draft = { ...next.data, depth: planSymbolDepth(next.data) };
        patchLevel((lvl) => {
          const exists = (lvl.objects || []).some((o) => o.id === draft.id);
          return placeOrUpdateObject(lvl, draft, { announce: true, insert: !exists });
        });
      } else if (next.type === "opening") {
        patchLevel((lvl) => {
          const withOpening = {
            ...lvl,
            walls: (lvl.walls || []).map((w) => w.id !== next.wallId ? w : {
              ...w,
              openings: (w.openings || []).map((o) => o.id === next.id ? { ...o, ...next.data, id: o.id } : o),
            }),
          };
          const host = withOpening.walls.find((w) => w.id === next.wallId);
          const opening = (host?.openings || []).find((o) => o.id === next.id);
          return opening && host ? clearRunForOpening(withOpening, host, opening) : withOpening;
        });
      } else if (next.type === "wall") {
        patchLevel((lvl) => {
          const nextWalls = (lvl.walls || []).map((w) => {
            if (w.id !== next.id) return w;
            const sized = next.data.length ? setWallLength(w, next.data.length) : w;
            let openings = sized.openings || [];
            const selectedHeaderId = next.data.selected_header_opening_id;
            if (selectedHeaderId) {
              openings = openings.map((op) => {
                if (op.id !== selectedHeaderId) return op;
                return {
                  ...op,
                  header_engineering: {
                    header_span: Number(next.data.header_span) || 48,
                    header_trib: Number(next.data.header_trib) || 144,
                    header_above: next.data.header_above || "bedroom",
                    header_stories: Number(next.data.header_stories ?? 1),
                  },
                };
              });
            }
            return {
              ...sized,
              openings,
              thickness: next.data.thickness || sized.thickness,
              height: next.data.height || sized.height,
              kind: next.data.kind || sized.kind,
              plumbing: Boolean(next.data.plumbing),
              bearing: next.data.bearing ?? next.data.kind === "exterior",
              work: next.data.work || sized.work || "existing",
              note: next.data.note || "",
              stud_spacing: Number(next.data.stud_spacing) || sized.stud_spacing || 16,
              foundation_contact: Boolean(next.data.foundation_contact),
              bottom_plate_treatment: next.data.foundation_contact
                ? "pressure-treated"
                : (next.data.bottom_plate_treatment || "standard"),
            };
          });
          return { ...lvl, walls: nextWalls };
        });
      } else if (next.type === "beam") {
        patchLevel((lvl) => ({
          ...lvl,
          beams: (lvl.beams || []).map((b) => b.id === next.id ? refreshBeam({ ...b, ...next.data, id: b.id }) : b),
        }));
      } else if (next.type === "room") {
        patchLevel((lvl) => {
          const withMeta = {
            ...lvl,
            rooms: (lvl.rooms || []).map((r) => r.id === next.id ? {
              ...r,
              name: next.data.name || r.name,
              flooring: next.data.flooring || r.flooring,
              wall_finish: next.data.wall_finish || "",
              note: next.data.note || "",
              notes: next.data.notes || next.data.note || "",
              wall_thickness: next.data.wall_thickness ?? r.wall_thickness ?? 3.5,
            } : r),
          };
          const sized = resizeRoom(withMeta, next.id, next.data.width, next.data.depth);
          return setRoomWallThickness(sized, next.id, next.data.wall_thickness ?? 3.5);
        });
      }
      setSpecDialog(null);
      toast.success("Specs applied to the plan.");
    } catch (err) {
      console.error("Could not apply component specs", err);
      toast.error("Could not apply those specs. Please try again.");
    }
  };

  const applyScanPayload = async (payload) => {
    try {
      if (!payload) throw new Error("That scan did not include rooms or walls we could read.");
      let targetId = planId;
      if (!targetId) {
        const created = (await api.post("/floor-plans", { ...metaRef.current, document: docRef.current })).data;
        targetId = created.id;
        applySavedPlan(created);
        navigate(`/floor-plans/${created.id}`, { replace: true });
      }
      const saved = (await api.post(`/floor-plans/${targetId}/import-roomplan`, payload)).data;
      applySavedPlan(saved);
      setLidarOpen(false);
      setLidarText("");
      const next = new URLSearchParams(params);
      next.delete("scan");
      setParams(next, { replace: true });
      toast.success("Rough layout created – measurements need verification.");
    } catch (err) {
      console.error("LiDAR import failed", err);
      try {
        const scanned = importRoomPlan(payload, emptyLevel("LiDAR Scan", level.sort_order));
        scanned.id = level.id;
        scanned.name = level.name;
        patchLevel(() => scanned);
        setLidarOpen(false);
        toast.success("Rough layout created – measurements need verification.");
      } catch (fallbackErr) {
        toast.error(fallbackErr.message || err.message || "Could not read that scan file.");
      }
    }
  };

  const applyLidar = () => {
    try {
      const parsed = JSON.parse(lidarText);
      applyScanPayload(parsed);
    } catch (err) {
      toast.error(err.message || "Could not read that scan file.");
    }
  };

  const applyScanRef = useRef(applyScanPayload);
  applyScanRef.current = applyScanPayload;

  useEffect(() => installRoomPlanListener((payload, err) => {
    if (err || !payload) {
      toast.error("The iPhone scan could not be read. Please try again.");
      return;
    }
    applyScanRef.current(payload);
  }), []);

  const zoomBy = (factor) => {
    setView((current) => ({
      ...current,
      scale: Math.min(4.5, Math.max(0.35, Number(current.scale || 1) * factor)),
    }));
  };

  const selectedWall = selected?.type === "wall" ? level.walls.find((w) => w.id === selected.id) : null;
  const selectedRoom = selected?.type === "room" ? level.rooms.find((r) => r.id === selected.id) : null;
  const selectedObj = selected?.type === "object" ? level.objects.find((o) => o.id === selected.id) : null;
  const selectedBeam = selected?.type === "beam" ? (level.beams || []).find((b) => b.id === selected.id) : null;
  const selectedOpening = selected?.type === "opening"
    ? ((level.walls.find((w) => w.id === selected.wallId)?.openings || []).find((o) => o.id === selected.id) || null)
    : null;

  const deleteSelected = () => {
    if (clientView || presenting) return false;
    try {
      if (selectedObj) {
        patchLevel((lvl) => finishCabinetRun({
          ...lvl,
          objects: (lvl.objects || []).filter((o) => o.id !== selectedObj.id),
        }));
        setSelected(null);
        return true;
      }
      if (selectedRoom) {
        patchLevel((lvl) => ({
          ...lvl,
          rooms: lvl.rooms.filter((r) => r.id !== selectedRoom.id),
          walls: lvl.walls.filter((w) => w.source_room_id !== selectedRoom.id),
        }));
        setSelected(null);
        return true;
      }
      if (selectedOpening && selected?.wallId) {
        patchLevel((lvl) => ({
          ...lvl,
          walls: (lvl.walls || []).map((w) => w.id !== selected.wallId ? w : {
            ...w,
            openings: (w.openings || []).filter((o) => o.id !== selectedOpening.id),
          }),
        }));
        setSelected(null);
        return true;
      }
      if (selectedWall) {
        patchLevel((lvl) => ({
          ...lvl,
          walls: lvl.walls.filter((w) => w.id !== selectedWall.id),
        }));
        setSelected(null);
        setDrawPoints(clearDrawChain());
        return true;
      }
      if (selectedBeam) {
        patchLevel((lvl) => ({ ...lvl, beams: (lvl.beams || []).filter((b) => b.id !== selectedBeam.id) }));
        setSelected(null);
        return true;
      }
      // No plan entity selected — cancel uncommitted Point & Line transient geometry.
      if (drawPoints.length) {
        setDrawPoints(clearDrawChain());
        return true;
      }
    } catch (err) {
      console.error("Could not delete the selected floor-plan item", err);
      toast.error("Could not delete that item. Please try again.");
    }
    return false;
  };
  deleteSelectedRef.current = deleteSelected;

  const rotateSelected = () => {
    if (!selectedObj) {
      toast.message("Select a cabinet or appliance to rotate.");
      return;
    }
    patchLevel((lvl) => {
      const order = ["south", "west", "north", "east"];
      const current = (lvl.objects || []).find((o) => o.id === selectedObj.id);
      if (!current) return lvl;
      const front = order[(order.indexOf(current.front || "south") + 1) % order.length];
      return placeOrUpdateObject(lvl, { ...current, front, rotation: ((current.rotation || 0) + 90) % 360 }, { announce: true });
    });
  };

  const duplicateSelected = () => {
    try {
      const live = (level.objects || []).find((o) => o.id === selectedObj?.id);
      if (!live) {
        toast.message("Select a cabinet or appliance to duplicate.");
        return;
      }
      const copy = clonePlanObject(live);
      if (!copy) {
        toast.error("Could not duplicate that item. Please try again.");
        return;
      }
      patchLevel((lvl) => ({
        ...lvl,
        objects: [...(lvl.objects || []), copy],
      }));
      setSelected({ type: "object", id: copy.id });
      setMode("select");
      toast.success("Duplicated — drag the twin into place.");
    } catch (err) {
      console.error("Could not duplicate the selected item", err);
      toast.error("Could not duplicate that item. Please try again.");
    }
  };

  const placementHint = (item) => (
    requiresWallHost({ library_id: item?.id, tags: item?.tags })
      ? `Tap an interior or exterior wall to place ${item.name}`
      : `Tap the plan to place ${item?.name || "that item"}`
  );

  const armCatalog = (id) => {
    const item = libraryById(id);
    if (!item) {
      toast.error("That catalog item is missing.");
      return;
    }
    setPlacing(item);
    setMode("object");
    setPlacingAnchor(null);
    setDrawPoints([]);
    toast.message(placementHint(item));
  };

  const runDockAction = (id) => {
    if (clientView || presenting) return;
    try {
      if (id === "undo") {
        setDrawPoints(clearDrawChain());
        setDrawSnap(null);
        drawSnapSession.current = emptySnapSession();
        stepHistory("undo");
        return;
      }
      if (id === "redo") {
        setDrawPoints(clearDrawChain());
        setDrawSnap(null);
        drawSnapSession.current = emptySnapSession();
        stepHistory("redo");
        return;
      }
      if (["select", "pan", "room", "draw", "door", "window", "cased"].includes(id)) {
        setMode(id);
        setPlacing(null);
        setPlacingAnchor(null);
        if (id !== "draw") setDrawPoints([]);
        if (id === "door") toast.message("Click a wall to cut a door. Cabinets slide clear.");
        if (id === "window") toast.message("Click a wall to place a window.");
        if (id === "cased") toast.message("Click a wall for a cased opening.");
        if (id === "pan") toast.message("Drag the drawing to pan.");
        return;
      }
      if (id === "french-48") {
        const item = libraryById("door-french-48");
        if (selectedWall && item) {
          attachOpening(selectedWall, "door", item, {
            x: (selectedWall.x1 + selectedWall.x2) / 2,
            y: (selectedWall.y1 + selectedWall.y2) / 2,
          });
          return;
        }
        armCatalog("door-french-48");
        return;
      }
      if (id.startsWith("place:")) {
        const catalogId = id.slice(6);
        if (catalogId.startsWith("lvl") && selectedWall) {
          const beam = beamFromWall(selectedWall, { stories_above: 1, above: "bedroom" });
          patchLevel((lvl) => ({ ...lvl, beams: [...(lvl.beams || []), beam] }));
          setSelected({ type: "beam", id: beam.id });
          toast.success("LVL placed — drag it onto the opening.");
          return;
        }
        armCatalog(catalogId);
        return;
      }
      if (id === "rotate") {
        rotateSelected();
        return;
      }
      if (id === "duplicate") {
        duplicateSelected();
        return;
      }
      if (id === "specs") {
        if (!selected) {
          toast.message("Select something, then open Properties.");
          return;
        }
        openSpecFor(selected);
        return;
      }
      if (id === "lock") {
        if (!selectedObj) {
          toast.message("Select an item to lock.");
          return;
        }
        patchLevel((lvl) => ({
          ...lvl,
          objects: (lvl.objects || []).map((o) => o.id === selectedObj.id ? { ...o, locked: !o.locked } : o),
        }));
        return;
      }
      if (id === "delete") {
        if (!deleteSelected()) toast.message("Select something to delete.");
        return;
      }
      if (id === "counters") {
        patchLevel((lvl) => finishCabinetRun(fitCountertops(lvl, { snap: doc.snap, material: counterMaterial })));
        toast.success("Countertops snapped to the base run");
        return;
      }
      if (id === "lidar") {
        setMode("lidar");
        setLidarOpen(true);
        return;
      }
      if (id === "electrical") {
        runElectricalDesign();
        return;
      }
      if (id === "3d") {
        setWalk3d(false);
        setShow3d(true);
      }
    } catch (err) {
      console.error("Edit dock action failed", err);
      toast.error("That edit tool could not run. Please try again.");
    }
  };

  useDeleteHotkey(deleteSelectedRef);
  const runElectricalDesign = (roomId = "") => {
    try {
      const result = completeElectricalDesign(level, { projectType: meta.project_type, roomId: roomId || "" });
      patchLevel(() => result.level);
      setLayers((prev) => ({ ...prev, electrical: true, lighting: true }));
      const errors = (result.report?.warnings || []).filter((w) => w.severity === "error").length;
      const n = Number(result.report?.device_count || 0);
      if (errors) toast.message(`Electrical design ready · ${n} devices · ${errors} code flag${errors === 1 ? "" : "s"} to review.`);
      else toast.success(`Electrical design complete · ${n} code-aware devices, circuits, and panel schedule.`);
    } catch (err) {
      console.error("Electrical design failed", err);
      toast.error("Could not complete the electrical design. Please try again.");
    }
  };
  const elecAdvice = selectedObj && isElectricalObject(selectedObj)
    ? adviseElectrician(selectedObj, { rooms: level.rooms, projectType: meta.project_type })
    : null;
  const panelObj = findPanel(level.objects);
  const wirePath = elecAdvice && panelObj && selectedObj ? homeRunPath(panelObj, selectedObj) : [];
  const levelTake = (takeoffs.levels || []).find((l) => l.level_id === level.id) || (takeoffs.levels || [])[0];
  const roofInTakeoff = Boolean(levelTake?.roof_in_scope);
  const scanVerifyCount = [
    ...(level.objects || []),
    ...(level.walls || []),
    ...(level.rooms || []),
  ].filter(needsScanVerify).length;

  return (
    <div className={`flex flex-col overflow-hidden overscroll-none bg-[#F4F7F8] ${presenting ? "h-dvh" : "h-full min-h-0"}`} data-testid="floorplan-studio">
      <header className={`shrink-0 bg-white border-b border-slate-200 px-3 sm:px-4 py-2 space-y-2 ${presenting ? "hidden" : ""}`}>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => navigate("/floor-plans")} className="p-2 rounded-md hover:bg-slate-100 text-[#0B3A8F]" data-testid="floorplan-back">
            <ArrowLeft size={18} />
          </button>
          <Input className="h-9 font-['Outfit'] font-semibold" value={meta.name} onChange={(e) => { markUnsaved(); setMeta({ ...meta, name: e.target.value }); }} data-testid="floorplan-name" />
          <span className={`hidden sm:inline rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.version_kind === "proposed" ? "bg-[#C9A227]/20 text-[#8A7018]" : "bg-slate-100 text-[#4B6370]"}`}>
            {meta.version_kind === "proposed" ? "Proposed" : "Existing"}
          </span>
          <div className="ml-auto flex items-center gap-1">
            {clientView ? null : (
              <>
                <span
                  className={`hidden sm:inline rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    syncStatus === "live" ? "bg-emerald-50 text-emerald-800" : syncStatus === "polling" ? "bg-amber-50 text-[#8A7018]" : "bg-slate-100 text-[#4B6370]"
                  }`}
                  data-testid="plan-sync-status"
                  title="Edits save automatically and appear on iPhone and Mac"
                >
                  {syncStatus === "live" ? "Live sync" : syncStatus === "polling" ? "Syncing…" : planId ? "Saved on this device" : "Unsaved plan"}
                </span>
                <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => stepHistory("undo")}><Undo2 size={14} /></Button>
                <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => stepHistory("redo")}><Redo2 size={14} /></Button>
                <Button
                  type="button"
                  size="sm"
                  className={`h-9 gap-1 ${unsaved ? "bg-[#C45C26] hover:bg-[#A3481C] text-white" : "bg-[#0B3A8F] hover:bg-[#082C73]"}`}
                  onClick={runSave}
                  data-testid="floorplan-save"
                  title="Save this plan (⌘S). Reloads will not replace a saved showcase."
                >
                  <Save size={14} /> {save.isPending ? "Saving…" : unsaved ? "Save • Unsaved" : "Save"}
                </Button>
              </>
            )}
            <Button type="button" size="sm" variant="outline" className="h-9 text-xs" onClick={() => setClientView((v) => !v)} data-testid="client-view-toggle">
              {clientView ? "Editor" : "Client view"}
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-9 text-xs bg-[#C9A227] hover:bg-[#B8911F] text-[#061A23] gap-1"
              data-testid="present-mode-btn"
              onClick={enterPresent}
            >
              <Presentation size={14} /> Present
            </Button>
          </div>
        </div>
        {existing?.showcase && !clientView ? (
          <div className="text-[11px] text-[#4B6370] font-['Outfit']" data-testid="showcase-save-hint">
            This is your working showcase. Use <span className="font-semibold text-[#C45C26]">Save</span> (⌘S) after a change. Code reloads will not restore the factory kitchen over this copy.
          </div>
        ) : null}
        {scanVerifyCount > 0 && !clientView ? (
          <div className="rounded-lg border border-[#C9A227]/50 bg-[#C9A227]/10 px-3 py-1.5 text-[12px] text-[#8A7018]" data-testid="scan-verify-banner">
            Rough layout from a LiDAR scan — {scanVerifyCount} item{scanVerifyCount === 1 ? "" : "s"} still marked <span className="font-semibold">from scan – verify</span>. Clean up sizes on iPhone or Mac; they stay in sync.
          </div>
        ) : null}
        <div className={`grid grid-cols-2 sm:grid-cols-4 gap-2 ${clientView ? "hidden" : ""}`}>
          <select className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm" value={meta.client_id} onChange={(e) => {
            const client = clients.find((c) => c.id === e.target.value);
            markUnsaved();
            setMeta({ ...meta, client_id: e.target.value, client_name: client?.name || "", address: meta.address || client?.address || "" });
          }} data-testid="floorplan-client">
            <option value="">Client</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <Input className="h-9 text-sm" placeholder="Project address" value={meta.address} onChange={(e) => { markUnsaved(); setMeta({ ...meta, address: e.target.value }); }} data-testid="floorplan-address" />
          <select className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm" value={meta.project_type} onChange={(e) => {
            const nextType = e.target.value;
            markUnsaved();
            setMeta({ ...meta, project_type: nextType });
            let nextFlag = doc.roof_in_takeoff;
            if (projectInvolvesRoof(nextType)) nextFlag = true;
            else if (interiorSkipsRoof(nextType)) nextFlag = false;
            if (nextFlag !== doc.roof_in_takeoff) {
              commit({ ...doc, roof_in_takeoff: nextFlag });
            }
          }} data-testid="floorplan-type">
            {PROJECT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm" value={meta.job_id} onChange={(e) => { markUnsaved(); setMeta({ ...meta, job_id: e.target.value }); }} data-testid="floorplan-job">
            <option value="">Link job</option>
            {jobs.map((j) => <option key={j.id} value={j.id}>{j.job_number} · {j.name}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1 overflow-x-auto">
          {(doc.levels || []).map((lvl) => (
            <button
              key={lvl.id}
              type="button"
              onClick={() => setDoc({ ...doc, active_level_id: lvl.id })}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${lvl.id === level.id ? "bg-[#0B3A8F] text-white" : "bg-slate-100 text-[#4B6370]"}`}
              data-testid={`floor-tab-${lvl.id}`}
            >
              {lvl.name}
            </button>
          ))}
          {clientView ? null : (
            <button
              type="button"
              className="shrink-0 rounded-full px-3 py-1 text-xs font-medium border border-dashed border-[#0B3A8F]/40 text-[#0B3A8F]"
              onClick={() => {
                const nextName = LEVEL_PRESETS[doc.levels.length] || `Level ${doc.levels.length + 1}`;
                const lvl = emptyLevel(nextName, doc.levels.length);
                commit({ ...doc, levels: [...doc.levels, lvl], active_level_id: lvl.id });
              }}
              data-testid="add-level-btn"
            >
              <Plus size={12} className="inline mr-1" /> Level
            </button>
          )}
        </div>
      </header>

      <div className={`flex-1 min-h-0 overflow-hidden grid ${clientView ? "grid-cols-1 grid-rows-1" : "grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(12rem,38vh)] lg:grid-cols-[minmax(0,1fr)_300px] lg:grid-rows-1"}`}>
        <div className="relative min-h-0 overflow-hidden">
          <FloorPlanCanvas
            ref={canvasRef}
            level={level}
            mode={clientView ? "select" : mode}
            view={view}
            onViewChange={setView}
            selected={clientView ? null : selected}
            highlightedWallIds={pickingCabinetWalls ? generatorWallIds : []}
            pickingWalls={pickingCabinetWalls}
            onSelect={clientView ? () => {} : onSelect}
            onCanvasTap={clientView ? () => {} : onCanvasTap}
            onDrawCursor={(world) => {
              if (mode !== "draw" || clientView) return;
              const previous = drawPoints[drawPoints.length - 1] || null;
              const chainStart = previous
                ? (previous.chainStart
                  || (drawPoints[0] && !drawPoints[0].fromCommit ? { x: drawPoints[0].x, y: drawPoints[0].y } : null))
                : null;
              const resolved = resolvePointLineSnap(world, {
                origin: previous,
                chainStart,
                chainWallIds: previous?.chainWallIds || [],
                freeAngle: freeAngleRef.current,
              });
              setDrawSnap(resolved);
            }}
            drawSnap={clientView ? null : drawSnap}
            drawPoints={clientView ? [] : drawPoints}
            placingItem={clientView ? null : placing}
            wirePath={clientView ? [] : wirePath}
            phase={phase}
            clientView={clientView}
            layers={layers}
            asbuilt={doc.asbuilt}
            onWallMoveStart={(wallId) => {
              const wall = (level.walls || []).find((w) => w.id === wallId);
              if (!wall) return;
              history.current.beginGesture(doc);
              wallMoveBase.current = {
                wallId,
                originWall: { ...wall },
                baseLevel: JSON.parse(JSON.stringify(level)),
                section: isReshapeSpanPending(level, wallId) || wall.is_bump_face || wall.is_reshape_span,
                outward: roomOutwardNormal(level, wall),
              };
            }}
            onWallMove={(wallId, cursorWorld) => {
              const base = wallMoveBase.current;
              if (!base || base.wallId !== wallId) return;
              if (base.section) {
                let distance = signedSectionDragDistance(base.originWall, cursorWorld, base.outward);
                distance = Math.round(distance / SNAP_CONFIG.drawingIncrementIn) * SNAP_CONFIG.drawingIncrementIn;
                patchLevelLive(() => applySectionOffsetFromOrigin(
                  base.baseLevel,
                  wallId,
                  base.originWall,
                  distance,
                  base.outward,
                ));
                return;
              }
              let distance = signedWallDragDistance(base.originWall, cursorWorld);
              distance = Math.round(distance / SNAP_CONFIG.drawingIncrementIn) * SNAP_CONFIG.drawingIncrementIn;
              patchLevelLive(() => applyWallMoveFromOrigin(
                base.baseLevel,
                wallId,
                base.originWall,
                distance,
              ));
            }}
            onWallMoveEnd={() => {
              history.current.endGesture();
              wallMoveBase.current = null;
            }}
            onVertexMoveStart={(vertexId) => {
              history.current.beginGesture(doc);
              wallMoveBase.current = {
                vertexId,
                baseLevel: JSON.parse(JSON.stringify(level)),
              };
            }}
            onVertexMove={(vertexId, world, extra = {}) => {
              const base = wallMoveBase.current;
              if (!base || base.vertexId !== vertexId) return;
              let x = world.x;
              let y = world.y;
              if (!extra.freeAngle) {
                // Prefer ortho snap to original vertex axes from neighbors
                const snap = doc.snap || SNAP_CONFIG.drawingIncrementIn;
                x = Math.round(x / snap) * snap;
                y = Math.round(y / snap) * snap;
              }
              patchLevelLive(() => movePlanVertex(base.baseLevel, vertexId, x, y, {
                snapOrtho: !extra.freeAngle,
                orthoFrom: (() => {
                  const walls = (base.baseLevel.walls || []).filter((w) => (
                    w.startVertexId === vertexId || w.endVertexId === vertexId
                  ));
                  if (!walls.length) return null;
                  const other = walls[0].startVertexId === vertexId
                    ? { x: walls[0].x2, y: walls[0].y2 }
                    : { x: walls[0].x1, y: walls[0].y1 };
                  return other;
                })(),
              }));
            }}
            onVertexMoveEnd={() => {
              history.current.endGesture();
              wallMoveBase.current = null;
              setReshapeMode(null);
            }}
            reshapeMode={clientView ? null : reshapeMode}
            addCornerDraft={clientView ? [] : addCornerDraft}
            onAddCornerClick={(wallId, pt) => {
              const wall = (level.walls || []).find((w) => w.id === wallId);
              if (!wall) return;
              const hit = projectPointOnWall(wall, pt.x, pt.y);
              const nextDraft = [...addCornerDraft, { x: hit.x, y: hit.y, along: hit.along, wallId }];
              if (nextDraft.length < 2) {
                setAddCornerDraft(nextDraft);
                setSelected({ type: "wall", id: wallId });
                toast.message("Corner 1 placed — click second corner on this wall.");
                return;
              }
              const a = nextDraft[0];
              const b = nextDraft[1];
              let result = null;
              patchLevel((lvl) => {
                result = addTwoCornersOnWall(lvl, wallId, a, b);
                if (result.error) return lvl;
                return result.level;
              });
              setAddCornerDraft([]);
              setReshapeMode(null);
              if (result?.error) {
                toast.error(result.error);
                return;
              }
              toast.success("Middle section ready — drag it in or out to reshape the room.");
              if (result?.midWallId) setSelected({ type: "wall", id: result.midWallId });
            }}
            onRoomMoveStart={() => {
              history.current.beginGesture(doc);
            }}
            onRoomMove={(rid, x, y) => patchLevelLive((lvl) => moveRoom(lvl, rid, snapTo(x, doc.snap), snapTo(y, doc.snap)))}
            onRoomMoveEnd={() => {
              history.current.endGesture();
            }}
            onRoomResize={(rid, x, y) => patchLevel((lvl) => {
              const room = lvl.rooms.find((r) => r.id === rid);
              if (!room) return lvl;
              return resizeRoom(lvl, rid, snapTo(x - room.x, doc.snap), snapTo(y - room.y, doc.snap));
            })}
            onRoomDraw={(bounds) => {
              const snap = doc.snap || 6;
              const room = createRoomFromOutsideBounds(
                "Room",
                snapTo(bounds.x1, snap),
                snapTo(bounds.y1, snap),
                snapTo(bounds.x2, snap),
                snapTo(bounds.y2, snap),
              );
              patchLevel((lvl) => {
                let next = fitRoofToRooms({
                  ...lvl,
                  rooms: [...lvl.rooms, room],
                  walls: [...lvl.walls, ...wallsFromRoom(room)],
                });
                // If flush against an existing room wall, reuse it as shared partition.
                const b = {
                  left: room.x,
                  right: room.x + room.width,
                  top: room.y,
                  bottom: room.y + room.depth,
                };
                const candidates = (next.walls || []).filter((w) => (
                  w.source_room_id && w.source_room_id !== room.id && w.room_side
                ));
                let shared = null;
                candidates.forEach((w) => {
                  const mx = (w.x1 + w.x2) / 2;
                  const my = (w.y1 + w.y2) / 2;
                  if (w.room_side === "east" && Math.abs(mx - b.left) <= 4) shared = w;
                  if (w.room_side === "west" && Math.abs(mx - b.right) <= 4) shared = w;
                  if (w.room_side === "south" && Math.abs(my - b.top) <= 4) shared = w;
                  if (w.room_side === "north" && Math.abs(my - b.bottom) <= 4) shared = w;
                });
                if (shared) {
                  next = mergeSharedPartition(next, room.id, shared.id);
                }
                return next;
              });
              setSelected({ type: "room", id: room.id });
            }}
            onDoubleClick={clientView ? undefined : openSpecFor}
            placingAnchor={clientView ? null : placingAnchor}
            onObjectMove={(oid, x, y) => patchLevel((lvl) => {
              const current = (lvl.objects || []).find((o) => o.id === oid);
              if (!current || (current.auto && String(current.library_id || "").includes("filler"))) return lvl;
              return placeOrUpdateObject(lvl, { ...current, x, y, locked: false });
            })}
            onObjectResize={(oid, w, d) => patchLevel((lvl) => {
              const current = (lvl.objects || []).find((o) => o.id === oid);
              if (!current || (current.auto && String(current.library_id || "").includes("filler"))) return lvl;
              return placeOrUpdateObject(lvl, {
                ...current,
                locked: false,
                width: Math.max(4, snapTo(w, doc.snap) || w),
                depth: planSymbolDepth({ ...current, depth: Math.max(2, snapTo(d, doc.snap) || d) }),
              }, { announce: true });
            })}
            onOpeningMoveStart={() => {
              history.current.beginGesture(doc);
            }}
            onOpeningMove={(wallId, openingId, offset) => patchLevelLive((lvl) => {
              const result = slideOpening(lvl, wallId, openingId, offset, 1);
              return result.ok ? result.level : lvl;
            })}
            onOpeningMoveEnd={() => {
              history.current.endGesture();
            }}
            onOpeningClick={(sel) => {
              if (clientView) return;
              const wall = (level.walls || []).find((w) => w.id === sel.wallId);
              const opening = (wall?.openings || []).find((o) => o.id === sel.id);
              if (!opening) return;
              setSelected({ type: "opening", id: sel.id, wallId: sel.wallId });
              openOpeningDetails(sel.wallId, sel.id);
            }}
            onOpeningRehost={(fromWallId, openingId, toWallId, worldX, worldY) => {
              patchLevelLive((lvl) => {
                const result = rehostOpening(lvl, fromWallId, openingId, toWallId, worldX, worldY, 1);
                if (!result.ok) return lvl;
                const host = (result.level.walls || []).find((w) => w.id === result.wallId);
                const opening = host?.openings?.find((o) => o.id === openingId);
                setSelected({ type: "opening", id: openingId, wallId: result.wallId });
                return opening && host ? clearRunForOpening(result.level, host, opening) : result.level;
              });
              history.current.endGesture();
            }}
            onOpeningSpanEdit={({ wallId, segment, text }) => {
              const inchesVal = parseFtIn(text);
              if (!Number.isFinite(inchesVal) || inchesVal < 0) {
                toast.error("Enter a valid architectural dimension.");
                return;
              }
              patchLevel((lvl) => {
                const wall = (lvl.walls || []).find((w) => w.id === wallId);
                if (!wall || !segment?.openingId) return lvl;
                const clear = wallInteriorClear(lvl, wall);
                const opening = (wall.openings || []).find((o) => o.id === segment.openingId);
                if (!opening) return lvl;
                const width = inches(opening.width);
                if (segment.role === "start") {
                  const max = clear.clearLength - width;
                  if (inchesVal > max + 0.05) {
                    toast.error(`Left span cannot exceed ${formatFtIn(max)}.`);
                    return lvl;
                  }
                  const result = setOpeningStartSpan(lvl, wallId, segment.openingId, inchesVal, 0.25);
                  if (!result.ok) {
                    toast.error(result.reason || "Invalid span.");
                    return lvl;
                  }
                  return result.level;
                }
                if (segment.role === "end") {
                  const max = clear.clearLength - width;
                  if (inchesVal > max + 0.05) {
                    toast.error(`Right span cannot exceed ${formatFtIn(max)}.`);
                    return lvl;
                  }
                  const result = setOpeningEndSpan(lvl, wallId, segment.openingId, inchesVal, 0.25);
                  if (!result.ok) {
                    toast.error(result.reason || "Invalid span.");
                    return lvl;
                  }
                  return result.level;
                }
                return lvl;
              });
            }}
            onBeamMove={(bid, x, y, spanX, spanY) => patchLevel((lvl) => ({
              ...lvl,
              beams: (lvl.beams || []).map((b) => b.id !== bid ? b : {
                ...b,
                x1: round2(x),
                y1: round2(y),
                x2: round2(x + spanX),
                y2: round2(y + spanY),
              }),
            }))}
          />
          {show3d ? <FloorPlan3D level={level} layers={layers} phase={phase} walkMode={walk3d} onClose={() => { setShow3d(false); setWalk3d(false); }} /> : null}
          <LayerPanel
            layers={layers}
            onToggle={(id) => setLayers((prev) => toggleLayer(prev, id))}
            compact={presenting || clientView}
            mode={mode}
            placingId={placing?.id || ""}
            selectedKind={selected?.type || ""}
            locked={Boolean(selectedObj?.locked)}
            onAction={runDockAction}
          />

          {pickingCabinetWalls ? (
            <div className="absolute bottom-3 left-3 right-3 z-20 flex justify-center pointer-events-none" data-testid="auto-generator-banner">
              <div className="pointer-events-auto max-w-xl rounded-xl border border-[#C9A227]/50 bg-white/95 px-4 py-3 shadow-sm">
                <div className="text-sm font-semibold font-['Outfit'] text-[#0B3A8F]">Which walls need cabinets?</div>
                <p className="text-[11px] text-[#4B6370] mt-0.5">Click walls to select them. {generatorWallIds.length ? `${generatorWallIds.length} selected.` : "None selected yet."}</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" className="h-8 px-3 rounded-md border border-slate-200 text-xs" onClick={cancelCabinetWallPick}>Cancel</button>
                  <button type="button" className="h-8 px-3 rounded-md bg-[#C9A227] text-[#061A23] text-xs font-semibold" onClick={confirmCabinetWallPick}>Done</button>
                </div>
              </div>
            </div>
          ) : null}

          {presenting ? (
            <div className="absolute top-3 left-3 right-3 flex items-center justify-between gap-3 pointer-events-none">
              <div className="rounded-full bg-white/95 border border-slate-200 px-3 py-1 text-xs font-semibold text-[#0B3A8F]">{meta.name}</div>
              <button
                type="button"
                className="pointer-events-auto rounded-full bg-white/95 border border-slate-200 px-3 py-1 text-xs font-medium text-[#0B3A8F]"
                data-testid="exit-present-btn"
                onClick={exitPresent}
              >
                Exit
              </button>
            </div>
          ) : null}
          <div className={`absolute top-2 left-2 right-2 z-20 flex justify-center ${presenting ? "hidden" : ""}`}>
            <div className="pointer-events-auto max-w-full flex flex-wrap items-center justify-center gap-1 rounded-full bg-white/95 border border-slate-200 p-1 shadow-sm">
              {["all", "before", "after"].map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setPhase(id)}
                  className={`rounded-full px-3 py-1.5 text-[11px] font-medium ${phase === id ? "bg-[#0B3A8F] text-white" : "text-[#4B6370]"}`}
                  data-testid={`phase-${id}`}
                >
                  {id === "all" ? "All work" : id === "before" ? "Before" : "Proposed"}
                </button>
              ))}
              {clientView ? (
                <>
                  <button type="button" className="rounded-full px-3 py-1.5 text-[11px] font-medium bg-[#C9A227] text-[#061A23]" onClick={() => setReportOpen(true)} data-testid="open-client-report">
                    Generate Client Report
                  </button>
                  <button type="button" className="rounded-full px-3 py-1.5 text-[11px] font-medium text-[#4B6370]" onClick={openPermit} data-testid="open-permit-details">
                    Generate Permit Details
                  </button>
                  <button type="button" className="rounded-full px-3 py-1.5 text-[11px] font-medium text-[#4B6370]" onClick={() => { setWalk3d(true); setShow3d(true); }}>3D walk-through</button>
                  <button type="button" className="rounded-full px-3 py-1.5 text-[11px] font-medium text-[#4B6370]" onClick={async () => {
                    const png = await canvasRef.current?.capturePng?.();
                    if (!png) return toast.error("Could not export that view. Please try again.");
                    const a = document.createElement("a");
                    a.href = png;
                    a.download = `${(meta.name || "floor-plan").replace(/\s+/g, "-")}.png`;
                    a.click();
                  }}>Export image</button>
                </>
              ) : (
                <>
                  <span className="hidden sm:block w-px h-5 bg-slate-200 mx-0.5" aria-hidden="true" />
                  <button
                    type="button"
                    onClick={() => { setWalk3d(false); setShow3d(true); }}
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-medium ${show3d ? "bg-[#C9A227] text-[#061A23]" : "text-[#8A7018]"}`}
                    data-testid="mode-3d"
                  >
                    <Box size={14} /> 3D
                  </button>
                  <span className="hidden sm:block w-px h-5 bg-slate-200 mx-0.5" aria-hidden="true" />
                  <button
                    type="button"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[#0B3A8F] hover:bg-slate-100"
                    data-testid="zoom-out"
                    aria-label="Zoom out"
                    onClick={() => zoomBy(0.85)}
                  >
                    <ZoomOut size={14} />
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[#0B3A8F] hover:bg-slate-100"
                    data-testid="zoom-in"
                    aria-label="Zoom in"
                    onClick={() => zoomBy(1.18)}
                  >
                    <ZoomIn size={14} />
                  </button>
                </>
              )}
            </div>
          </div>
          {presenting ? (
            <div className="absolute bottom-4 left-4 right-4 flex flex-col items-center gap-2">
              <div className="w-full max-w-xl rounded-2xl bg-white/95 border border-slate-200 px-4 py-3 shadow-sm" data-testid="present-slider">
                <div className="flex justify-between text-[11px] font-semibold uppercase tracking-wide">
                  <span className="text-[#0B3A8F]">Existing</span>
                  <span className="text-[#2E7D32]">Proposed</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={presentSlider}
                  data-testid="present-phase-slider"
                  className="w-full mt-1 accent-[#0B3A8F]"
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    setPresentSlider(value);
                    setPhase(value < 40 ? "before" : value > 60 ? "after" : "all");
                  }}
                />
                <div className="text-center text-xs text-[#4B6370]">
                  {phase === "before" ? "What is there now" : phase === "after" ? "What we are building" : "Existing and proposed together"}
                </div>
              </div>
            </div>
          ) : clientView ? (
            <div className="absolute bottom-3 left-3 right-3 flex justify-center pointer-events-none">
              <div className="rounded-full bg-white/95 border border-slate-200 px-3 py-1 text-[10px] text-[#4B6370]">
                <span className="text-[#C62828] font-semibold">Red dashed</span> demolition · <span className="text-[#2E7D32] font-semibold">Green</span> new work · <span className="text-[#C9A227] font-semibold">Gold dot</span> note
              </div>
            </div>
          ) : null}
        </div>

        <aside className={`min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain border-t lg:border-t-0 lg:border-l border-slate-200 bg-white ${clientView ? "hidden" : ""}`}>
          <div className="p-3 border-b border-slate-200">
            <div className="text-xs font-semibold uppercase tracking-wide text-[#0B3A8F]">Live take-offs · {level.name}</div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm" data-testid="takeoff-panel">
              <TakeoffStat label="Floor SF" value={levelTake?.floor_sf} />
              <TakeoffStat label="Ceiling SF" value={levelTake?.ceiling_sf} />
              <TakeoffStat label="Wall SF" value={levelTake?.wall_sf} />
              <TakeoffStat label="Wall LF" value={levelTake?.wall_lf} />
              {roofInTakeoff ? (
                <>
                  <TakeoffStat label="Roof SF" value={levelTake?.roof_sf} />
                  <TakeoffStat label="Roof peri. LF" value={levelTake?.roof_perimeter_lf} />
                  <TakeoffStat label="Ridge LF" value={levelTake?.ridge_lf} />
                  <TakeoffStat label="Gutter LF" value={levelTake?.gutter_lf} />
                  <TakeoffStat label="Gable LF" value={levelTake?.gable_lf} />
                  <TakeoffStat label="Valley LF" value={levelTake?.valley_lf} />
                </>
              ) : null}
              <TakeoffStat label="2x6 plumb LF" value={levelTake?.plumbing_wall_lf} />
              <TakeoffStat label="LVL LF" value={levelTake?.lvl_lf} />
            </div>
            <div className="mt-2 text-xs text-[#4B6370]">
              {takeoffs.pitch ? `Pitch ${takeoffs.pitch} · ` : ""}
              Building {takeoffs.totals.floor_sf} SF across {takeoffs.totals.level_count} level{takeoffs.totals.level_count === 1 ? "" : "s"}
            </div>
            <div className="mt-1 text-sm font-['Outfit'] font-semibold text-[#0B3A8F]" data-testid="scope-priced-total">Shop catalog {usd(scopeTotal(scope.line_items))}</div>
            {(levelTake?.rooms || []).length ? (
              <div className="mt-2 space-y-1">
                {levelTake.rooms.map((room) => (
                  <div key={room.id} className="flex justify-between text-[11px] text-[#4B6370]">
                    <span className="truncate pr-2">{room.name}</span>
                    <span className="font-medium text-[#0B3A8F]">{room.sf.toFixed(1)} SF</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <KitchenDesignPanel
            level={level}
            design={kitchenDesignOf(doc)}
            warnings={evaluateKitchen(level, kitchenDesignOf(doc))}
            islandHint={islandHint}
            placingAnchor={placingAnchor}
            pickingWalls={pickingCabinetWalls}
            selectedWallCount={generatorWallIds.length}
            onDesignPatch={(patch) => {
              const current = kitchenDesignOf(doc);
              commit({
                ...doc,
                kitchen_design: { ...current, ...patch, style: { ...current.style, ...(patch.style || {}) } },
              });
            }}
            onPlaceAnchor={(kind) => {
              setPlacing(null);
              setMode("select");
              setPickingCabinetWalls(false);
              setPlacingAnchor(kind);
              toast.message(`Tap the ${kind} location on the plan`);
            }}
            onAutoGenerate={() => {
              setPlacing(null);
              setPlacingAnchor(null);
              setMode("select");
              setPickingCabinetWalls(true);
              setGeneratorWallIds([]);
              toast.message("Which walls need cabinets? Click the walls, then Done.");
            }}
            onCancelWalls={cancelCabinetWallPick}
            onConfirmWalls={confirmCabinetWallPick}
            onCounters={() => {
              const material = kitchenDesignOf(doc).style?.counter_material || counterMaterial || "quartz";
              patchLevel((lvl) => generateKitchenCounters(lvl, material));
              setCounterMaterial(material);
              toast.success("Countertop silhouette snapped to the base run");
            }}
            onApplyStyle={() => {
              const style = kitchenDesignOf(doc).style;
              patchLevel((lvl) => applyKitchenStyle(lvl, style));
              toast.success("Door style, finish, and hardware applied to the kitchen");
            }}
          />

          <div className="p-3 border-b border-slate-200 space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-[#0B3A8F]">Inspector</div>
            {selectedOpening ? (
              <div className="space-y-2 text-sm">
                <div className="font-medium capitalize">{selectedOpening.style === "french" ? "French door" : selectedOpening.type} · {formatFtIn(selectedOpening.width)}</div>
                <div className="text-[11px] text-[#4B6370]">
                  {selectedOpening.leafs > 1 ? `${selectedOpening.leafs} leaves` : "Single leaf"}
                  {selectedOpening.lites ? ` · ${selectedOpening.lites} vertical lites each` : ""}
                </div>
                <Button type="button" size="sm" className="h-8 w-full text-xs bg-[#0B3A8F] hover:bg-[#082C73]" onClick={() => openSpecFor(selected)}>Edit specs</Button>
                <Button type="button" size="sm" variant="outline" className="h-8 w-full text-xs text-red-600" onClick={() => deleteSelected()}>Delete opening</Button>
              </div>
            ) : selectedWall ? (
              <div className="space-y-2 text-sm">
                <div className="font-medium">{selectedWall.kind} wall · {formatFtIn(wallLength(selectedWall))}</div>
                {reshapeMode === "add-corners" ? (
                  <div className="rounded-md border border-[#C45C26]/40 bg-[#FFF8F4] px-2 py-1.5 text-[11px] text-[#8B2E0E]">
                    ADD CORNERS — click two points on this wall ({addCornerDraft.length}/2)
                    <Button type="button" size="sm" variant="outline" className="mt-1 h-7 w-full text-[10px]" onClick={() => { setReshapeMode(null); setAddCornerDraft([]); }}>Cancel</Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 text-xs bg-[#0B3A8F] hover:bg-[#082C73]"
                      onClick={() => {
                        setReshapeMode("add-corners");
                        setAddCornerDraft([]);
                        toast.message("Click two points along the wall, then drag the middle section.");
                      }}
                    >
                      Add Corners
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      onClick={() => {
                        setReshapeMode("move-corner");
                        toast.message("Drag a wall endpoint/corner. Hold Alt for free angle.");
                      }}
                    >
                      Move Corner
                    </Button>
                  </div>
                )}
                {(selectedWall.is_reshape_span || selectedWall.reshape_span || selectedWall.is_bump_face) ? (
                  <div className="text-[11px] text-[#C45C26] font-medium">Drag this section perpendicular to reshape the room.</div>
                ) : null}
                <button type="button" className="text-[11px] rounded px-2 py-1 text-white" style={{ background: WORK_KINDS.find((w) => w.id === workOf(selectedWall))?.color }} onClick={() => patchLevel((lvl) => ({
                  ...lvl,
                  walls: lvl.walls.map((w) => w.id === selectedWall.id ? { ...w, work: cycleWork(w.work) } : w),
                }))}>{WORK_KINDS.find((w) => w.id === workOf(selectedWall))?.name}</button>
                <Input className="h-8 text-xs" placeholder="Field / client note" value={selectedWall.note || ""} onChange={(e) => patchLevel((lvl) => ({
                  ...lvl,
                  walls: lvl.walls.map((w) => w.id === selectedWall.id ? { ...w, note: e.target.value } : w),
                }))} />
                <div className="flex gap-1">
                  <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => patchLevel((lvl) => {
                    if (selectedWall.source_room_id) {
                      const nextT = selectedWall.kind === "exterior" ? 4.5 : 6;
                      return setRoomWallThickness(lvl, selectedWall.source_room_id, nextT);
                    }
                    return {
                      ...lvl,
                      walls: lvl.walls.map((w) => w.id === selectedWall.id ? { ...w, kind: w.kind === "exterior" ? "interior" : "exterior", thickness: w.kind === "exterior" ? 4.5 : 6 } : w),
                    };
                  })}>Make {selectedWall.kind === "exterior" ? "interior" : "exterior"}</Button>
                  <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => patchLevel((lvl) => {
                    if (selectedWall.source_room_id) {
                      const nextT = selectedWall.plumbing ? (selectedWall.kind === "exterior" ? 6 : 4.5) : 5.5;
                      const cleared = {
                        ...lvl,
                        walls: lvl.walls.map((w) => w.id === selectedWall.id ? { ...w, plumbing: !w.plumbing } : w),
                      };
                      return setRoomWallThickness(cleared, selectedWall.source_room_id, nextT);
                    }
                    return {
                      ...lvl,
                      walls: lvl.walls.map((w) => w.id === selectedWall.id ? { ...w, plumbing: !w.plumbing, thickness: !w.plumbing ? 5.5 : (w.kind === "exterior" ? 6 : 4.5) } : w),
                    };
                  })}>{selectedWall.plumbing ? "Clear 2x6" : "2x6 plumbing"}</Button>
                  <Button type="button" size="sm" variant="outline" className="h-8 text-xs text-red-600" onClick={() => {
                    try {
                      const beam = beamFromWall(selectedWall, { stories_above: 1, above: "bedroom" });
                      patchLevel((lvl) => ({
                        ...lvl,
                        walls: lvl.walls.filter((w) => w.id !== selectedWall.id),
                        beams: [...(lvl.beams || []), beam],
                      }));
                      setSelected({ type: "beam", id: beam.id });
                      toast.message(`Wall removed — ${beam.label} proposed over that span.`);
                    } catch (err) {
                      console.error("Could not replace that wall with a header", err);
                      toast.error("Could not replace that wall with a header. Please try again.");
                    }
                  }}>Delete / header</Button>
                </div>
                <Button type="button" size="sm" className="h-8 w-full text-xs bg-[#C45C26] hover:bg-[#A3481C] text-white" onClick={() => {
                  try {
                    const beam = (Number.isFinite(Number(selected?.t))
                      ? beamFromWallAt(selectedWall, selected.t, 48, { stories_above: 1, above: "bedroom" })
                      : beamFromWall(selectedWall, { stories_above: 1, above: "bedroom" }));
                    patchLevel((lvl) => ({ ...lvl, beams: [...(lvl.beams || []), beam] }));
                    setSelected({ type: "beam", id: beam.id });
                    if (beam.engineer_required) toast.error(`${beam.label}. ${beam.notes}`);
                    else if (beam.header_kind === "dimensional") toast.success(`${beam.label} — twin dimensional lumber is enough.`);
                    else toast.success(`${beam.label} — 2x10 / 2x12 will not carry this load.`);
                  } catch (err) {
                    console.error("Could not propose a header over that wall", err);
                    toast.error("Could not size that header. Please try again.");
                  }
                }}>Propose header over this wall</Button>
                <div className="flex gap-1">
                  {["door", "window", "cased"].map((kind) => (
                    <Button key={kind} type="button" size="sm" variant="outline" className="h-8 text-xs capitalize" onClick={() => attachOpening(selectedWall, kind, null, { x: (selectedWall.x1 + selectedWall.x2) / 2, y: (selectedWall.y1 + selectedWall.y2) / 2 })}>{kind}</Button>
                  ))}
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="h-8 w-full text-xs bg-[#0B3A8F] hover:bg-[#082C73]"
                  onClick={() => attachOpening(selectedWall, "door", libraryById("door-french-48"), { x: (selectedWall.x1 + selectedWall.x2) / 2, y: (selectedWall.y1 + selectedWall.y2) / 2 })}
                >
                  48&quot; French pair · 4 lites
                </Button>
                {(selectedWall.openings || []).map((op) => (
                  <div key={op.id} className="rounded-md border border-slate-200 p-2 space-y-1">
                    <div className="flex justify-between text-xs font-medium capitalize">{op.type} · {formatFtIn(op.width)}
                      <button type="button" className="text-red-500" onClick={() => patchLevel((lvl) => ({
                        ...lvl,
                        walls: lvl.walls.map((w) => w.id === selectedWall.id ? { ...w, openings: w.openings.filter((o) => o.id !== op.id) } : w),
                      }))}>Remove</button>
                    </div>
                    <Input className="h-8 text-xs" defaultValue={formatFtIn(op.width)} key={`${op.id}-${op.width}`} onBlur={(e) => {
                      const next = parseFtIn(e.target.value);
                      if (next < 12) return;
                      patchLevel((lvl) => ({
                        ...lvl,
                        walls: lvl.walls.map((w) => w.id === selectedWall.id ? { ...w, openings: w.openings.map((o) => o.id === op.id ? { ...o, width: next } : o) } : w),
                      }));
                    }} placeholder={`2' 8"`} />
                    <select className="h-8 w-full rounded-md border border-slate-200 px-2 text-xs" value={op.style} onChange={(e) => patchLevel((lvl) => ({
                      ...lvl,
                      walls: lvl.walls.map((w) => w.id === selectedWall.id ? { ...w, openings: w.openings.map((o) => o.id === op.id ? { ...o, style: e.target.value } : o) } : w),
                    }))}>
                      {(op.type === "window" ? WINDOW_STYLES : DOOR_STYLES).map((style) => (
                        <option key={style.id || style} value={style.id || style}>{style.name || style}</option>
                      ))}
                    </select>
                    {op.type === "window" ? (
                      <div className="space-y-1">
                        <select className="h-8 w-full rounded-md border border-slate-200 px-2 text-xs" value={op.material || "vinyl"} onChange={(e) => patchLevel((lvl) => ({
                          ...lvl,
                          walls: lvl.walls.map((w) => w.id === selectedWall.id ? { ...w, openings: w.openings.map((o) => o.id === op.id ? { ...o, material: e.target.value } : o) } : w),
                        }))}>
                          {WINDOW_MATERIALS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                        <select className="h-8 w-full rounded-md border border-slate-200 px-2 text-xs" value={op.install || "new-construction"} onChange={(e) => patchLevel((lvl) => ({
                          ...lvl,
                          walls: lvl.walls.map((w) => w.id === selectedWall.id ? { ...w, openings: w.openings.map((o) => o.id === op.id ? { ...o, install: e.target.value, extension_jambs: e.target.value === "new-construction" } : o) } : w),
                        }))}>
                          {WINDOW_INSTALLS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                        <div className="text-[10px] text-[#4B6370]">
                          {(op.install || "new-construction") === "replacement"
                            ? "Box / pocket replacement — existing frame stays, no extension jambs."
                            : "New construction — extension jambs included to the finished wall."}
                        </div>
                      </div>
                    ) : null}
                    {op.type === "door" ? (
                      <div className="flex flex-wrap gap-1">
                        <button type="button" className="text-[11px] rounded bg-slate-100 px-2 py-1" onClick={() => patchLevel((lvl) => ({
                          ...lvl,
                          walls: lvl.walls.map((w) => w.id === selectedWall.id ? { ...w, openings: w.openings.map((o) => o.id === op.id ? { ...o, swing: o.swing === "left" ? "right" : "left" } : o) } : w),
                        }))}>Swing {op.swing}</button>
                        <button type="button" className="text-[11px] rounded bg-slate-100 px-2 py-1" onClick={() => patchLevel((lvl) => ({
                          ...lvl,
                          walls: lvl.walls.map((w) => w.id === selectedWall.id ? { ...w, openings: w.openings.map((o) => o.id === op.id ? { ...o, direction: o.direction === "in" ? "out" : "in" } : o) } : w),
                        }))}>{op.direction}</button>
                        {selectedWall.kind === "exterior" ? (
                          <button type="button" className="text-[11px] rounded bg-slate-100 px-2 py-1" onClick={() => patchLevel((lvl) => ({
                            ...lvl,
                            walls: lvl.walls.map((w) => w.id === selectedWall.id ? { ...w, openings: w.openings.map((o) => o.id === op.id ? { ...o, storm: !o.storm } : o) } : w),
                          }))}>{op.storm ? "Storm on" : "Add storm"}</button>
                        ) : null}
                      </div>
                    ) : null}
                    {op.type === "cased" && needsBeamForOpening({ ...op, type: "cased" }) ? (
                      <div className="text-[10px] text-[#C45C26]">LVL shown as a red dotted line above this opening.</div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : selectedBeam ? (
              <div className="space-y-2 text-sm" data-testid="lvl-inspector">
                <div className="font-medium text-[#C45C26]">{selectedBeam.label}</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[11px]">Opening span</Label>
                    <Input className="h-8 text-xs" defaultValue={formatFtIn(selectedBeam.span_in)} key={`span-${selectedBeam.id}-${selectedBeam.span_in}`} onBlur={(e) => {
                      const span = parseFtIn(e.target.value);
                      if (span < 12) return;
                      patchLevel((lvl) => ({
                        ...lvl,
                        beams: (lvl.beams || []).map((b) => b.id === selectedBeam.id ? refreshBeam({ ...b, span_in: span }) : b),
                      }));
                    }} />
                  </div>
                  <div>
                    <Label className="text-[11px]">Room / trib. width</Label>
                    <Input className="h-8 text-xs" defaultValue={formatFtIn(selectedBeam.tributary_in)} key={`trib-${selectedBeam.id}-${selectedBeam.tributary_in}`} onBlur={(e) => {
                      const trib = parseFtIn(e.target.value);
                      if (trib < 24) return;
                      patchLevel((lvl) => ({
                        ...lvl,
                        beams: (lvl.beams || []).map((b) => b.id === selectedBeam.id ? refreshBeam({ ...b, tributary_in: trib }) : b),
                      }));
                    }} />
                  </div>
                </div>
                <select className="h-8 w-full rounded-md border border-slate-200 px-2 text-xs" value={selectedBeam.wall_kind} onChange={(e) => patchLevel((lvl) => ({
                  ...lvl,
                  beams: (lvl.beams || []).map((b) => b.id === selectedBeam.id ? refreshBeam({ ...b, wall_kind: e.target.value }) : b),
                }))}>
                  <option value="interior">Interior wall</option>
                  <option value="exterior">Exterior wall</option>
                </select>
                <select className="h-8 w-full rounded-md border border-slate-200 px-2 text-xs" value={selectedBeam.above} onChange={(e) => patchLevel((lvl) => ({
                  ...lvl,
                  beams: (lvl.beams || []).map((b) => b.id === selectedBeam.id ? refreshBeam({ ...b, above: e.target.value }) : b),
                }))}>
                  {ABOVE_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.name} above</option>)}
                </select>
                <select className="h-8 w-full rounded-md border border-slate-200 px-2 text-xs" value={String(selectedBeam.stories_above)} onChange={(e) => patchLevel((lvl) => ({
                  ...lvl,
                  beams: (lvl.beams || []).map((b) => b.id === selectedBeam.id ? refreshBeam({ ...b, stories_above: Number(e.target.value) }) : b),
                }))}>
                  <option value="0">No upstairs (this is the top)</option>
                  <option value="1">1 story above</option>
                  <option value="2">2 stories above</option>
                </select>
                <div className="rounded-md bg-[#F4F7F8] p-2 text-[11px] text-[#4B6370] space-y-0.5">
                  <div>Dead {selectedBeam.loads?.dead_psf} psf + live {selectedBeam.loads?.live_psf} psf</div>
                  <div>Uniform load {selectedBeam.loads?.w_plf} plf</div>
                  <div>{selectedBeam.plies} ply · {selectedBeam.depth_in}" deep · {formatFtIn(selectedBeam.width_in)} wide</div>
                  <div>{selectedBeam.jack_studs} jacks · {selectedBeam.king_studs} kings each end</div>
                  {selectedBeam.engineer_required ? <div className="text-red-600 font-medium">Engineer required for this span/load.</div> : null}
                </div>
                <WallDetail rec={selectedBeam} />
                <p className="text-[10px] text-[#4B6370]">{selectedBeam.notes}</p>
                <Button type="button" size="sm" variant="outline" className="h-8 text-xs text-red-600" onClick={() => deleteSelected()}>Remove header</Button>
              </div>
            ) : selectedRoom ? (
              <div className="space-y-2 text-sm">
                <Input value={selectedRoom.name} onChange={(e) => patchLevel((lvl) => ({ ...lvl, rooms: lvl.rooms.map((r) => r.id === selectedRoom.id ? { ...r, name: e.target.value } : r) }))} />
                <button type="button" className="text-[11px] rounded px-2 py-1 text-white" style={{ background: WORK_KINDS.find((w) => w.id === workOf(selectedRoom))?.color }} onClick={() => patchLevel((lvl) => ({
                  ...lvl,
                  rooms: lvl.rooms.map((r) => r.id === selectedRoom.id ? { ...r, work: cycleWork(r.work) } : r),
                }))}>{WORK_KINDS.find((w) => w.id === workOf(selectedRoom))?.name}</button>
                <select className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm" value={selectedRoom.flooring} onChange={(e) => patchLevel((lvl) => ({ ...lvl, rooms: lvl.rooms.map((r) => r.id === selectedRoom.id ? { ...r, flooring: e.target.value } : r) }))}>
                  {FLOORING.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
                <select className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm" value={selectedRoom.wall_finish || ""} onChange={(e) => patchLevel((lvl) => ({ ...lvl, rooms: lvl.rooms.map((r) => r.id === selectedRoom.id ? { ...r, wall_finish: e.target.value } : r) }))}>
                  {WALL_FINISHES.map((f) => <option key={f.id} value={f.id}>{f.name} walls</option>)}
                </select>
                <div className="flex gap-1">
                  <Input className="h-8 text-xs" placeholder="Room note" value={selectedRoom.note || selectedRoom.notes || ""} onChange={(e) => patchLevel((lvl) => ({
                    ...lvl,
                    rooms: lvl.rooms.map((r) => r.id === selectedRoom.id ? { ...r, note: e.target.value, notes: e.target.value } : r),
                  }))} />
                  <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => captureVoice((text) => patchLevel((lvl) => ({
                    ...lvl,
                    rooms: lvl.rooms.map((r) => r.id === selectedRoom.id ? { ...r, note: `${r.note ? `${r.note} ` : ""}${text}`, notes: `${r.note ? `${r.note} ` : ""}${text}` } : r),
                  })))}>Voice</Button>
                </div>
                <div className="text-xs text-[#4B6370]">{((selectedRoom.width * selectedRoom.depth) / 144).toFixed(1)} SF outside · clear {(Math.max(0, selectedRoom.width - 2 * (selectedRoom.wall_thickness || 3.5)) * Math.max(0, selectedRoom.depth - 2 * (selectedRoom.wall_thickness || 3.5)) / 144).toFixed(1)} SF · drag room to move · gold corner to resize</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-[11px] text-[#4B6370]">Wall thickness</div>
                    <Input
                      className="h-8 text-xs"
                      type="number"
                      step="0.5"
                      min="2"
                      value={selectedRoom.wall_thickness ?? 3.5}
                      onChange={(e) => patchLevel((lvl) => setRoomWallThickness(lvl, selectedRoom.id, Number(e.target.value) || 3.5))}
                      data-testid="room-wall-thickness"
                    />
                  </div>
                </div>
                <div className="rounded-lg border border-[#0B3A8F]/15 bg-[#F4F7F8] p-2 space-y-1.5" data-testid="room-lighting">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-[#0B3A8F]">Ceiling lights</div>
                  <select className="h-8 w-full rounded-md border border-slate-200 px-2 text-xs" value={lightMount} onChange={(e) => setLightMount(e.target.value)}>
                    {LIGHT_MOUNTS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <select className="h-8 w-full rounded-md border border-slate-200 px-2 text-xs" value={lightMode} onChange={(e) => setLightMode(e.target.value)}>
                    <option value="auto">Auto-space to the room</option>
                    <option value="quantity">Set a quantity</option>
                  </select>
                  {lightMode === "quantity" ? (
                    <Input className="h-8 text-xs" type="number" min="1" max="36" value={lightQty} onChange={(e) => setLightQty(e.target.value)} />
                  ) : (
                    <div className="text-[10px] text-[#4B6370]">About {lightingCountForRoom(selectedRoom)} lights, inset from the walls and centered.</div>
                  )}
                  <Button type="button" size="sm" className="h-8 w-full text-xs bg-[#0B3A8F] hover:bg-[#082C73]" onClick={() => {
                    patchLevel((lvl) => placeRoomLights(lvl, selectedRoom, {
                      mount: lightMount,
                      mode: lightMode,
                      quantity: Number(lightQty) || lightingCountForRoom(selectedRoom),
                    }));
                    toast.success("Lights placed symmetrically in this room");
                  }}>Place room lights</Button>
                  <Button type="button" size="sm" variant="outline" className="h-8 w-full text-xs" onClick={() => {
                    const sink = (level.objects || []).find((o) => String(o.library_id || "").includes("sink") || (o.tags || []).includes("sink"));
                    if (!sink) return toast.error("Place a sink first, then drop one light over it.");
                    patchLevel((lvl) => placeSinkLight(lvl, sink, { mount: lightMount }));
                    toast.success("One light over the sink");
                  }}>One light over the sink</Button>
                </div>
                <Button type="button" size="sm" className="h-8 w-full text-xs bg-[#C9A227] hover:bg-[#B8911F] text-[#061A23]" onClick={() => runElectricalDesign(selectedRoom.id)} data-testid="room-complete-electrical">
                  Complete electrical for this room
                </Button>
                <Button type="button" size="sm" variant="outline" className="h-8 text-xs text-red-600" onClick={() => deleteSelected()}>Delete room</Button>
              </div>
            ) : selectedObj ? (
              <div className="space-y-2 text-sm">
                <ObjectCustomize
                  obj={selectedObj}
                  level={level}
                  onPatch={(patch) => patchLevel((lvl) => {
                    const current = (lvl.objects || []).find((o) => o.id === selectedObj.id);
                    if (!current) return lvl;
                    const merged = { ...current, ...patch };
                    if (patch.width != null || patch.depth != null || patch.front != null || patch.height != null) {
                      return placeOrUpdateObject(lvl, merged, { announce: true, onReject: (reason) => toast.error(reason) });
                    }
                    return finishCabinetRun({
                      ...lvl,
                      objects: lvl.objects.map((o) => (o.id === selectedObj.id ? merged : o)),
                    });
                  })}
                  onRotate={() => rotateSelected()}
                  onDelete={() => deleteSelected()}
                  onVoice={() => captureVoice((text) => patchLevel((lvl) => ({
                    ...lvl,
                    objects: lvl.objects.map((o) => o.id === selectedObj.id ? { ...o, note: `${o.note ? `${o.note} ` : ""}${text}` } : o),
                  })))}
                  counterMaterial={counterMaterial}
                  onCounterMaterial={setCounterMaterial}
                  onSnapCounters={() => {
                    patchLevel((lvl) => finishCabinetRun(fitCountertops(lvl, { snap: doc.snap, material: counterMaterial })));
                    toast.success("Countertops snapped to the base run");
                  }}
                  onSaveStandard={(defaults) => {
                    setDoc((current) => ({
                      ...current,
                      house_standards: {
                        favorites: current.house_standards?.favorites || [],
                        defaults: { ...(current.house_standards?.defaults || {}), ...defaults },
                      },
                    }));
                    toast.success("House standard saved with this plan");
                  }}
                />
              </div>
            ) : (
              <p className="text-xs text-[#4B6370]">Tap a room, wall, or object, then drag the body to move it. Resize only from the gold corner. Double-tap a wall to type exact length.</p>
            )}
            <div className="mt-3">
              <ElectricianAdvice
                advice={elecAdvice}
                report={level.electrical}
                onComplete={() => runElectricalDesign(selected?.type === "room" ? selected.id : "")}
              />
            </div>
          </div>

          <div className="p-3">
            <ObjectCatalog
              placing={placing}
              houseFavorites={doc.house_standards?.favorites || []}
              onToggleFavorite={(id, next) => setDoc((current) => ({
                ...current,
                house_standards: {
                  ...(current.house_standards || { defaults: {} }),
                  favorites: next,
                },
              }))}
              onPlace={(item) => { setPlacing(item); setMode("object"); toast.message(placementHint(item)); }}
            />
            <div className="mt-3 space-y-2">
              <Button type="button" className="w-full h-9 text-xs bg-[#0B3A8F] hover:bg-[#082C73]" onClick={() => sendEstimate.mutate(mergeEstimateId)} data-testid="send-to-estimate-btn">
                {sendEstimate.isPending ? "Sending…" : "Send to Estimate"}
              </Button>
              <select className="h-9 w-full rounded-md border border-slate-200 px-2 text-xs" value={mergeEstimateId} onChange={(e) => setMergeEstimateId(e.target.value)} data-testid="merge-estimate-select">
                <option value="">New draft estimate</option>
                {estimates.map((est) => (
                  <option key={est.id} value={est.id}>Merge into {est.estimate_number || est.id}</option>
                ))}
              </select>
              <Button type="button" variant="outline" className="w-full h-9 text-xs" onClick={() => setReportOpen(true)}>Generate Client Report</Button>
              <Button type="button" className="w-full h-9 text-xs bg-[#0B3A8F] hover:bg-[#082C73]" onClick={openPermit} data-testid="open-permit-details-sidebar">Generate Permit Details</Button>
              <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => commit({ ...doc, asbuilt: { ...(doc.asbuilt || {}), dataUrl: String(reader.result || ""), opacity: 0.35, x: 0, y: 0, scale: 1 } });
                reader.readAsDataURL(file);
              }} />
              <Button type="button" variant="outline" className="w-full h-9 text-xs" onClick={() => photoRef.current?.click()}>Photo overlay / as-built</Button>
              {doc.asbuilt?.dataUrl ? (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[11px]">Photo opacity</Label>
                    <input type="range" min="0.1" max="0.8" step="0.05" value={doc.asbuilt.opacity || 0.35} onChange={(e) => commit({ ...doc, asbuilt: { ...doc.asbuilt, opacity: Number(e.target.value) } })} className="w-full" />
                  </div>
                  <div>
                    <Label className="text-[11px]">Photo scale</Label>
                    <input type="range" min="0.4" max="2.4" step="0.1" value={doc.asbuilt.scale || 1} onChange={(e) => commit({ ...doc, asbuilt: { ...doc.asbuilt, scale: Number(e.target.value) } })} className="w-full" />
                  </div>
                  <div>
                    <Label className="text-[11px]">Photo left / right</Label>
                    <input type="range" min="-80" max="240" step="2" value={doc.asbuilt.x || 0} onChange={(e) => commit({ ...doc, asbuilt: { ...doc.asbuilt, x: Number(e.target.value) } })} className="w-full" />
                  </div>
                  <div>
                    <Label className="text-[11px]">Photo up / down</Label>
                    <input type="range" min="-80" max="240" step="2" value={doc.asbuilt.y || 0} onChange={(e) => commit({ ...doc, asbuilt: { ...doc.asbuilt, y: Number(e.target.value) } })} className="w-full" />
                  </div>
                  <Button type="button" variant="outline" className="h-8 text-xs col-span-2" onClick={() => commit({ ...doc, asbuilt: { dataUrl: "", opacity: 0.35, x: 0, y: 0, scale: 1 } })}>Clear photo</Button>
                </div>
              ) : null}
              <Label className="text-[11px]">Client notes</Label>
              <textarea className="w-full h-16 rounded-md border border-slate-200 p-2 text-xs" value={doc.client_notes || ""} onChange={(e) => commit({ ...doc, client_notes: e.target.value })} placeholder="Selections, allowances, things the homeowner asked for…" />
              <Label className="text-[11px]">Special conditions</Label>
              <textarea className="w-full h-16 rounded-md border border-slate-200 p-2 text-xs" value={doc.special_conditions || ""} onChange={(e) => commit({ ...doc, special_conditions: e.target.value })} placeholder="Allowances, HOA, access, existing conditions to protect…" />
              <Label className="text-[11px]">Foundation</Label>
              <select className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm" value={doc.foundation || "slab"} onChange={(e) => commit({ ...doc, foundation: e.target.value })}>
                {FOUNDATIONS.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
              <Label className="text-[11px]">Roof</Label>
              <select
                className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm"
                value={roofInTakeoff ? (level.roofs?.[0]?.kind || "gable") : "none"}
                onChange={(e) => {
                  const kind = e.target.value;
                  commit(updateLevel({ ...doc, roof_in_takeoff: kind !== "none" }, level.id, (lvl) => {
                    if (kind === "none") return { ...lvl, roofs: [] };
                    const roof = lvl.roofs?.[0] || emptyRoof(kind);
                    return fitRoofToRooms({ ...lvl, roofs: [{ ...roof, kind }] });
                  }));
                }}
              >
                <option value="none">Not in this job</option>
                {ROOF_KINDS.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              {roofInTakeoff ? (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[11px]">Pitch rise</Label>
                  <Input className="h-8 text-sm" defaultValue={level.roofs?.[0]?.pitch_rise || 6} key={`rise-${level.id}-${level.roofs?.[0]?.pitch_rise || 6}`} onBlur={(e) => {
                    const rise = Number(e.target.value) || 6;
                    patchLevel((lvl) => {
                      const roof = lvl.roofs?.[0] || emptyRoof();
                      return { ...lvl, roofs: [{ ...roof, pitch_rise: rise }] };
                    });
                  }} />
                </div>
                <div>
                  <Label className="text-[11px]">Pitch run</Label>
                  <Input className="h-8 text-sm" defaultValue={level.roofs?.[0]?.pitch_run || 12} key={`run-${level.id}-${level.roofs?.[0]?.pitch_run || 12}`} onBlur={(e) => {
                    const run = Number(e.target.value) || 12;
                    patchLevel((lvl) => {
                      const roof = lvl.roofs?.[0] || emptyRoof();
                      return { ...lvl, roofs: [{ ...roof, pitch_run: run }] };
                    });
                  }} />
                </div>
              </div>
              ) : null}
              {planId ? (
                <>
                  <Button type="button" variant="outline" className="w-full h-9 text-xs" onClick={() => duplicate.mutate()}>
                    Save as {meta.version_kind === "existing" ? "proposed" : "existing"} version
                  </Button>
                  <Label className="text-[11px]">Attach to estimate</Label>
                  <select className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm" defaultValue="" onChange={(e) => {
                    if (e.target.value) attach.mutate({ estimate_id: e.target.value });
                    e.target.value = "";
                  }}>
                    <option value="">Choose estimate…</option>
                    {estimates.filter((e) => !meta.job_id || e.job_id === meta.job_id || !e.job_id).map((e) => (
                      <option key={e.id} value={e.id}>{e.estimate_number || e.title || e.id}</option>
                    ))}
                  </select>
                  <Label className="text-[11px]">Attach to contract</Label>
                  <select className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm" defaultValue="" onChange={(e) => {
                    if (e.target.value) attach.mutate({ contract_id: e.target.value });
                    e.target.value = "";
                  }}>
                    <option value="">Choose contract…</option>
                    {contracts.filter((c) => !meta.job_id || c.job_id === meta.job_id || !c.job_id).map((c) => (
                      <option key={c.id} value={c.id}>{c.contract_number || c.title || c.id}</option>
                    ))}
                  </select>
                </>
              ) : null}
            </div>
          </div>
        </aside>
      </div>

      {openingDetails?.category === OPENING_CATEGORY.EXTERIOR_DOOR ? (
        <DoorDetailsModal
          open
          door={openingDetails.data}
          wallId={openingDetails.wallId}
          openingId={openingDetails.openingId}
          onSave={(payload) => applyOpeningDetails({ ...payload, category: OPENING_CATEGORY.EXTERIOR_DOOR })}
          onClose={() => setOpeningDetails(null)}
        />
      ) : null}
      {openingDetails?.category === OPENING_CATEGORY.INTERIOR_DOOR ? (
        <InteriorDoorDetailsModal
          open
          door={openingDetails.data}
          wallId={openingDetails.wallId}
          openingId={openingDetails.openingId}
          onSave={(payload) => applyOpeningDetails({ ...payload, category: OPENING_CATEGORY.INTERIOR_DOOR })}
          onClose={() => setOpeningDetails(null)}
        />
      ) : null}
      {openingDetails?.category === OPENING_CATEGORY.WINDOW ? (
        <WindowDetailsModal
          open
          windowSpec={openingDetails.data}
          wallId={openingDetails.wallId}
          openingId={openingDetails.openingId}
          onSave={(payload) => applyOpeningDetails({ ...payload, category: OPENING_CATEGORY.WINDOW })}
          onClose={() => setOpeningDetails(null)}
        />
      ) : null}
      {specDialog ? (
        <ComponentSpecDialog
          spec={specDialog}
          level={level}
          foundation={doc?.foundation}
          onAccept={applySpec}
          onClose={() => setSpecDialog(null)}
          onEditOpening={(wallId, openingId) => {
            setSpecDialog(null);
            openOpeningDetails(wallId, openingId);
          }}
          onAddOpening={(kind, t) => {
            try {
              const wall = (level.walls || []).find((w) => w.id === specDialog.id);
              if (!wall) return;
              const along = Number.isFinite(Number(t)) ? Number(t) : (Number(specDialog.clickT) || 0.5);
              const pt = {
                x: wall.x1 + (wall.x2 - wall.x1) * along,
                y: wall.y1 + (wall.y2 - wall.y1) * along,
              };
              attachOpening(wall, kind, null, pt);
              setSpecDialog(null);
            } catch (err) {
              console.error("Could not add that opening from the wall dialog", err);
              toast.error("Could not add that opening. Please try again.");
            }
          }}
          onAddHeader={(opts) => {
            try {
              const wall = (level.walls || []).find((w) => w.id === specDialog.id);
              if (!wall) return;
              const beam = beamFromWallAt(wall, opts?.t ?? specDialog.clickT ?? 0.5, opts?.span_in || 48, {
                tributary_in: opts?.tributary_in || 144,
                above: opts?.above || "bedroom",
                stories_above: opts?.stories_above ?? 1,
              });
              patchLevel((lvl) => ({ ...lvl, beams: [...(lvl.beams || []), beam] }));
              setSelected({ type: "beam", id: beam.id });
              setSpecDialog(null);
              if (beam.engineer_required) {
                toast.error(`${beam.label}. ${beam.notes}`);
              } else if (beam.header_kind === "dimensional") {
                toast.success(`${beam.label} — twin dimensional lumber is enough.`);
              } else {
                toast.success(`${beam.label} — 2x10 / 2x12 will not carry this load.`);
              }
            } catch (err) {
              console.error("Could not size a header on that wall", err);
              toast.error("Could not size that header. Please try again.");
            }
          }}
          onDelete={() => {
            try {
              if (specDialog.type === "object") {
                const id = specDialog.id;
                patchLevel((lvl) => finishCabinetRun({
                  ...lvl,
                  objects: (lvl.objects || []).filter((o) => o.id !== id),
                }));
                setSelected(null);
              }
            } catch (err) {
              console.error("Could not delete from specs", err);
            }
            setSpecDialog(null);
          }}
          onVoice={() => captureVoice((text) => {
            setSpecDialog((current) => current ? { ...current, data: { ...current.data, note: `${current.data.note ? `${current.data.note} ` : ""}${text}` } } : current);
          })}
          counterMaterial={counterMaterial}
          onCounterMaterial={setCounterMaterial}
          onSnapCounters={() => {
            patchLevel((lvl) => finishCabinetRun(fitCountertops(lvl, { snap: doc.snap, material: counterMaterial })));
            toast.success("Countertops snapped to the base run");
          }}
          onSaveStandard={(defaults) => {
            setDoc((current) => ({
              ...current,
              house_standards: {
                favorites: current.house_standards?.favorites || [],
                defaults: { ...(current.house_standards?.defaults || {}), ...defaults },
              },
            }));
            toast.success("Saved as the house standard");
          }}
        />
      ) : null}

      <StudioDialogs
        wallDialog={wallDialog}
        setWallDialog={setWallDialog}
        roomDialog={roomDialog}
        setRoomDialog={setRoomDialog}
        lidarOpen={lidarOpen}
        setLidarOpen={setLidarOpen}
        lidarText={lidarText}
        setLidarText={setLidarText}
        applyLidar={applyLidar}
        applyScanPayload={applyScanPayload}
        loadSampleScan={() => setLidarText(JSON.stringify(SAMPLE_KITCHEN_SCAN, null, 2))}
        patchLevel={patchLevel}
        reportOpen={reportOpen}
        setReportOpen={setReportOpen}
        meta={meta}
        scope={scope}
        takeoffs={takeoffs}
        pdfUrl={pdfUrl}
        generateReport={generateReport}
        estimates={estimates}
        contracts={contracts}
        reportAttach={reportAttach}
        setReportAttach={setReportAttach}
        permitOpen={permitOpen}
        permitPreview={permitPreview}
        permitSheets={permitSheets}
        setPermitSheets={setPermitSheets}
        permitPdfUrl={permitPdfUrl}
        generatePermit={generatePermit}
        setPermitOpen={setPermitOpen}
      />
    </div>
  );
}

