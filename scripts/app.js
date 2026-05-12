/**
 * ProMotion Draw — Modern Drawing App
 * Features: workspace pan/zoom, CapCut-style keyframes, layers, undo/redo
 */

// ─── STATE ───────────────────────────────────────────────────────────────────
const state = {
    // Canvas internals
    canvas: null,
    ctx: null,
    width: 1920,
    height: 1080,

    // Workspace viewport (CSS-space)
    view: { x: 0, y: 0, scale: 1 },
    canvasDisplayW: 960,  // CSS width of canvas at scale=1
    canvasDisplayH: 540,

    // Workspace interaction
    isPanning: false,
    panStart: null,
    spaceHeld: false,

    // Drawing
    tool: 'brush',       // 'brush' | 'eraser' | 'polygon' | 'pan' | 'move'
    isDrawing: false,
    brush: { color: '#000000', size: 5, opacity: 1.0 },
    bgColor: '#ffffff',

    // Polygon / zone tool config
    polygon: { color: '#e05252', fillColor: '#e05252', fillAlpha: 0.25, strokeWidth: 3 },

    // Timeline / recording
    drawingActions: [],
    currentTime: 0,
    lastDrawTime: 0,

    // Playback
    isPlaying: false,
    playbackSpeed: 1,
    rafId: null,

    // Layers — each has its OWN duration so all layers play from t=0 in parallel
    layers: [{ id: 1, name: 'Layer 1', visible: true, opacity: 1, duration: 0 }],
    activeLayerId: 1,

    // Keyframes: { id, time, viewX, viewY, viewScale }
    keyframes: [],
    selectedKfId: null,

    // Assets / Images
    images: [],
    selectedImageIdx: null,
    imgAction: null,   // 'drag' | 'resize'
    imgDragStart: null,

    // Undo/Redo
    undoStack: [],
    redoStack: [],
};

// ─── ELEMENTS ────────────────────────────────────────────────────────────────
const el = {
    canvas:       document.getElementById('main-canvas'),
    viewport:     document.getElementById('canvas-viewport'),
    workspace:    document.getElementById('workspace'),
    tlTrack:      document.getElementById('tl-track'),
    tlCursor:     document.getElementById('tl-cursor'),
    tlKeyframes:  document.getElementById('tl-keyframes'),
    timeDisplay:  document.getElementById('time-display'),
    hudZoom:      document.getElementById('hud-zoom'),
    hudHint:      document.getElementById('hud-hint'),
    hudImgActs:   document.getElementById('hud-img-actions'),
    exportBtn:    document.getElementById('btn-export'),
    exportStatus: document.getElementById('export-status'),
    layersList:   document.getElementById('layers-list'),
    kfHint:       document.getElementById('keyframe-hint'),
    kfLabel:      document.getElementById('kf-selected-label'),
};

// ─── INIT ────────────────────────────────────────────────────────────────────
function init() {
    state.canvas = el.canvas;
    state.ctx    = el.canvas.getContext('2d', { alpha: false });

    state.canvas.width  = state.width;
    state.canvas.height = state.height;

    fitCanvasToWorkspace();
    setupEventListeners();
    renderLayersUI();
    redrawCanvas();
    updateTimelineUI();
    // Hide polygon panel until polygon tool is active
    const pp = document.getElementById('polygon-panel');
    if (pp) pp.style.display = 'none';
}

function fitCanvasToWorkspace(animate) {
    const ws = el.workspace.getBoundingClientRect();
    const aspect = state.width / state.height;
    const wsAspect = ws.width / ws.height;

    let displayW, displayH;
    if (aspect > wsAspect) {
        displayW = ws.width  * 0.88;
        displayH = displayW / aspect;
    } else {
        displayH = ws.height * 0.88;
        displayW = displayH * aspect;
    }

    state.canvasDisplayW = displayW;
    state.canvasDisplayH = displayH;
    el.canvas.style.width  = displayW + 'px';
    el.canvas.style.height = displayH + 'px';

    state.view = { x: 0, y: 0, scale: 1 };
    applyViewport();
}

function applyViewport() {
    const { x, y, scale } = state.view;
    const cw = state.canvasDisplayW;
    const ch = state.canvasDisplayH;
    // transform-origin: 0 0  (set in CSS)
    // canvas-viewport is at left:50%, top:50% → moves its origin to workspace center
    // translate puts the canvas center at workspace center + (x,y)
    el.viewport.style.transform =
        `translate(${x - cw * scale / 2}px, ${y - ch * scale / 2}px) scale(${scale})`;
    el.hudZoom.textContent = Math.round(scale * 100) + '%';
}

// ─── WORKSPACE PAN / ZOOM ────────────────────────────────────────────────────
const MIN_SCALE = 0.05;
const MAX_SCALE = 20;

function zoomAt(factor, wsX, wsY) {
    // wsX, wsY = position relative to workspace center
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, state.view.scale * factor));
    if (newScale === state.view.scale) return;
    const k = newScale / state.view.scale;
    state.view.x = wsX - (wsX - state.view.x) * k;
    state.view.y = wsY - (wsY - state.view.y) * k;
    state.view.scale = newScale;
    applyViewport();
}

function zoomStep(factor) {
    zoomAt(factor, 0, 0);
}

el.workspace.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = el.workspace.getBoundingClientRect();
    const wsX = e.clientX - rect.left - rect.width  / 2;
    const wsY = e.clientY - rect.top  - rect.height / 2;
    const factor = e.deltaY < 0 ? 1.1 : (1 / 1.1);
    zoomAt(factor, wsX, wsY);
}, { passive: false });

// Touchpad pinch (pointerdown double touch)
let lastPinchDist = null;
el.workspace.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) lastPinchDist = null;
}, { passive: true });
el.workspace.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 2) return;
    e.preventDefault();
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.hypot(dx, dy);
    if (lastPinchDist !== null) {
        const factor = dist / lastPinchDist;
        const rect = el.workspace.getBoundingClientRect();
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left - rect.width  / 2;
        const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top  - rect.height / 2;
        zoomAt(factor, cx, cy);
    }
    lastPinchDist = dist;
}, { passive: false });

// Space + drag to pan
window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !state.spaceHeld && document.activeElement.tagName === 'BODY') {
        e.preventDefault();
        state.spaceHeld = true;
        el.workspace.classList.add('panning');
        el.hudHint.style.display = '';
    }
});
window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
        state.spaceHeld = false;
        state.isPanning = false;
        el.workspace.classList.remove('panning', 'panning-active');
        el.hudHint.style.display = 'none';
    }
});

// ─── POINTER POSITION ────────────────────────────────────────────────────────
function getCanvasPos(e) {
    // getBoundingClientRect accounts for ALL CSS transforms — simplest & most reliable
    const rect = el.canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
        x: (clientX - rect.left) * (state.canvas.width  / rect.width),
        y: (clientY - rect.top)  * (state.canvas.height / rect.height),
    };
}

function getWorkspacePos(e) {
    const rect = el.workspace.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
        x: clientX - rect.left - rect.width  / 2,
        y: clientY - rect.top  - rect.height / 2,
    };
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function getActiveLayer() {
    return state.layers.find(l => l.id === state.activeLayerId) || state.layers[0];
}

// Each layer has its own independent duration (starts at 0).
// totalDuration = max of all layer durations → all layers play in PARALLEL from t=0.
function getTotalDuration() {
    if (!state.layers.length) return 0;
    return Math.max(0, ...state.layers.map(l => l.duration || 0));
}

// ─── DRAWING ENGINE ──────────────────────────────────────────────────────────
let currentPath   = [];
let actionStartTime = 0;

function startDrawing(e) {
    if (state.isPlaying) return;

    // Middle mouse button (button=1) or Space held → pan regardless of tool
    if (e.button === 1 || state.spaceHeld) { e.preventDefault(); startPan(e); return; }

    if (state.tool === 'pan')     { startPan(e); return; }
    if (state.tool === 'move')    { startImageInteract(e); return; }
    if (state.tool === 'polygon') { handlePolyDown(e); return; }

    // Only start brush/eraser drawing when cursor is actually over the canvas
    const rect = el.canvas.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right ||
        e.clientY < rect.top  || e.clientY > rect.bottom) return;

    state.isDrawing = true;
    currentPath = [getCanvasPos(e)];
    actionStartTime  = getActiveLayer().duration || 0;
    state.lastDrawTime = Date.now();
}

function onDrawMove(e) {
    if (state.isPanning) { doPan(e); return; }
    if (state.tool === 'move')    { doImageInteract(e); return; }
    if (state.tool === 'polygon') { handlePolyMove(e); return; }
    if (!state.isDrawing) return;

    const pos  = getCanvasPos(e);
    const last = currentPath[currentPath.length - 1];
    if (Math.hypot(pos.x - last.x, pos.y - last.y) < 3) return;

    const now   = Date.now();
    const delta = now - state.lastDrawTime;
    state.lastDrawTime = now;

    const layer = getActiveLayer();
    layer.duration = (layer.duration || 0) + delta;
    state.currentTime = getTotalDuration();

    currentPath.push(pos);
    redrawCanvas();
    updateTimelineUI();
}

function stopDrawing(e) {
    if (state.isPanning) { endPan(); return; }
    if (state.tool === 'move')    { endImageInteract(); return; }
    if (state.tool === 'polygon') { handlePolyUp(e); return; }
    if (!state.isDrawing) return;
    state.isDrawing = false;

    if (currentPath.length < 2) { currentPath = []; return; }

    saveUndoSnapshot();
    const layer = getActiveLayer();
    state.drawingActions.push({
        type:      'stroke',
        isEraser:  state.tool === 'eraser',
        points:    [...currentPath],
        color:     state.brush.color,
        size:      state.tool === 'eraser' ? state.brush.size * 2.5 : state.brush.size,
        opacity:   state.brush.opacity,
        layerId:   state.activeLayerId,
        startTime: actionStartTime,
        endTime:   layer.duration || 0,
    });
    currentPath = [];
    redrawCanvas();
}

// Pan helpers
function startPan(e) {
    state.isPanning  = true;
    state.panStart   = { mx: e.clientX || e.touches[0].clientX, my: e.clientY || e.touches[0].clientY, vx: state.view.x, vy: state.view.y };
    el.workspace.classList.add('panning-active');
}
function doPan(e) {
    if (!state.isPanning) return;
    const mx = e.clientX || (e.touches && e.touches[0].clientX);
    const my = e.clientY || (e.touches && e.touches[0].clientY);
    state.view.x = state.panStart.vx + (mx - state.panStart.mx);
    state.view.y = state.panStart.vy + (my - state.panStart.my);
    applyViewport();
}
function endPan() {
    state.isPanning = false;
    el.workspace.classList.remove('panning-active');
}

// ─── POLYGON / ZONE TOOL ─────────────────────────────────────────────────────
const POLY_SNAP_DIST  = 20;  // canvas-px: snap-close to first vertex
const POLY_VTX_HIT    = 14;  // canvas-px: vertex hit radius

let polyBuild    = null;   // {vertices:[{x,y}], startTime} — in-progress polygon
let polyEditId   = null;   // id of selected completed polygon
let polyEditVtx  = null;   // vertex index being dragged
let polyDragData = null;   // {origVerts, origX, origY} at drag-start
let polyPreview  = null;   // cursor pos for preview line (canvas coords)

function getPolyById(id) {
    return state.drawingActions.find(a => a.type === 'polygon' && a.id === id) || null;
}

function getPolyVertsAtTime(poly, t) {
    const snaps = poly.snapshots;
    if (!snaps || !snaps.length) return [];
    if (t < poly.createdAt) return null; // not visible yet
    let prev = snaps[0];
    let next = null;
    for (let i = 0; i < snaps.length - 1; i++) {
        if (snaps[i].time <= t) prev = snaps[i];
        if (snaps[i].time <= t && snaps[i + 1].time > t) { next = snaps[i + 1]; break; }
    }
    if (!next) return prev.vertices.map(v => ({ ...v }));
    const frac = (t - prev.time) / Math.max(1, next.time - prev.time);
    const et   = frac < 0.5 ? 4*frac*frac*frac : 1 - Math.pow(-2*frac + 2, 3) / 2;
    return prev.vertices.map((v, i) => ({
        x: v.x + (next.vertices[i].x - v.x) * et,
        y: v.y + (next.vertices[i].y - v.y) * et,
    }));
}

function pointInPoly(px, py, verts) {
    let inside = false;
    for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
        const { x: xi, y: yi } = verts[i], { x: xj, y: yj } = verts[j];
        if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi)
            inside = !inside;
    }
    return inside;
}

function handlePolyDown(e) {
    const p = getCanvasPos(e);

    // ── If currently building, add vertex or close ──
    if (polyBuild) {
        const verts = polyBuild.vertices;
        if (verts.length >= 3) {
            const first = verts[0];
            if (Math.hypot(p.x - first.x, p.y - first.y) < POLY_SNAP_DIST) {
                closePolygon(true); return;
            }
        }
        verts.push({ ...p });
        redrawCanvas(); return;
    }

    // ── Check vertices of existing polygons on active layer ──
    const polys = state.drawingActions.filter(a => a.type === 'polygon' && a.layerId === state.activeLayerId);
    for (let i = polys.length - 1; i >= 0; i--) {
        const poly  = polys[i];
        const verts = getPolyVertsAtTime(poly, state.currentTime);
        if (!verts) continue;
        for (let vi = 0; vi < verts.length; vi++) {
            if (Math.hypot(p.x - verts[vi].x, p.y - verts[vi].y) < POLY_VTX_HIT) {
                polyEditId   = poly.id;
                polyEditVtx  = vi;
                polyDragData = { origVerts: verts.map(v => ({ ...v })), origX: p.x, origY: p.y };
                state.lastDrawTime = Date.now();
                redrawCanvas(); return;
            }
        }
    }

    // ── Check if clicking inside a closed polygon → toggle fill ──
    for (let i = polys.length - 1; i >= 0; i--) {
        const poly  = polys[i];
        if (!poly.closed) continue;
        const verts = getPolyVertsAtTime(poly, state.currentTime);
        if (!verts) continue;
        if (pointInPoly(p.x, p.y, verts)) {
            saveUndoSnapshot();
            poly.filled = !poly.filled;
            polyEditId  = poly.id;
            redrawCanvas(); return;
        }
    }

    // ── Start a new polygon ──
    polyEditId  = null;
    polyEditVtx = null;
    polyBuild   = { vertices: [{ ...p }], startTime: getActiveLayer().duration || 0 };
    redrawCanvas();
}

function handlePolyMove(e) {
    const p = getCanvasPos(e);
    polyPreview = { ...p };

    // Vertex drag in progress
    if (polyEditId !== null && polyEditVtx !== null && polyDragData) {
        const poly = getPolyById(polyEditId);
        if (!poly) return;

        const now   = Date.now();
        const delta = now - state.lastDrawTime;
        state.lastDrawTime = now;

        const layer = getActiveLayer();
        layer.duration = (layer.duration || 0) + delta;
        state.currentTime = getTotalDuration();

        // Move only the dragged vertex in the latest snapshot
        const latestSnap = poly.snapshots[poly.snapshots.length - 1];
        const orig = polyDragData.origVerts[polyEditVtx];
        latestSnap.vertices[polyEditVtx] = {
            x: orig.x + (p.x - polyDragData.origX),
            y: orig.y + (p.y - polyDragData.origY),
        };

        redrawCanvas();
        updateTimelineUI();
        return;
    }

    redrawCanvas(); // update preview line + hover highlight
}

function handlePolyUp(e) {
    if (polyEditId !== null && polyEditVtx !== null && polyDragData) {
        const poly = getPolyById(polyEditId);
        if (poly) {
            // Save a NEW snapshot at the current time so the move is baked into the timeline
            const latestVerts = poly.snapshots[poly.snapshots.length - 1].vertices.map(v => ({ ...v }));
            poly.snapshots.push({ time: getActiveLayer().duration || 0, vertices: latestVerts });
            saveUndoSnapshot();
        }
        polyEditVtx  = null;
        polyDragData = null;
        redrawCanvas();
    }
}

function handlePolyDblClick(e) {
    if (!polyBuild || polyBuild.vertices.length < 2) return;
    // A dblclick fires two mousedowns first, so we have 1-2 duplicate vertices
    // at the end from those clicks — remove the last one before closing
    const verts = polyBuild.vertices;
    if (verts.length >= 2) {
        const a = verts[verts.length - 2], b = verts[verts.length - 1];
        if (Math.hypot(a.x - b.x, a.y - b.y) < 4) verts.pop();
    }
    closePolygon(false);
}

function cancelPolyBuild() {
    polyBuild = null;
    redrawCanvas();
}

function closePolygon(closed) {
    if (!polyBuild || polyBuild.vertices.length < 2) { polyBuild = null; return; }
    const layer = getActiveLayer();
    const id    = Date.now();
    const verts = polyBuild.vertices.map(v => ({ ...v }));
    saveUndoSnapshot();
    state.drawingActions.push({
        type:        'polygon',
        id,
        layerId:     state.activeLayerId,
        strokeColor: state.polygon.color,
        fillColor:   state.polygon.fillColor,
        fillAlpha:   state.polygon.fillAlpha,
        strokeWidth: state.polygon.strokeWidth,
        filled:      false,
        closed,
        createdAt:   polyBuild.startTime,
        snapshots:   [{ time: polyBuild.startTime, vertices: verts }],
    });
    polyBuild  = null;
    polyEditId = id;
    redrawCanvas();
    updateTimelineUI();
}

function renderPolygon(ctx, poly, verts, isSelected) {
    if (!verts || verts.length < 2) return;
    ctx.save();
    ctx.lineCap  = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth   = poly.strokeWidth;
    ctx.strokeStyle = poly.strokeColor;

    // Fill
    if (poly.filled && poly.closed && verts.length >= 3) {
        ctx.beginPath();
        ctx.moveTo(verts[0].x, verts[0].y);
        verts.slice(1).forEach(v => ctx.lineTo(v.x, v.y));
        ctx.closePath();
        // Parse fill color + alpha
        const hex = poly.fillColor || '#e05252';
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        ctx.fillStyle = `rgba(${r},${g},${b},${poly.fillAlpha ?? 0.25})`;
        ctx.fill();
    }

    // Stroke (always sharp edges)
    ctx.beginPath();
    ctx.moveTo(verts[0].x, verts[0].y);
    verts.slice(1).forEach(v => ctx.lineTo(v.x, v.y));
    if (poly.closed) ctx.closePath();
    ctx.stroke();

    // Vertex handles (only when polygon is selected / being edited)
    if (isSelected) {
        verts.forEach((v, i) => {
            ctx.beginPath();
            ctx.arc(v.x, v.y, POLY_VTX_HIT, 0, Math.PI * 2);
            ctx.fillStyle   = (i === polyEditVtx) ? '#2196f3' : 'rgba(255,255,255,0.85)';
            ctx.strokeStyle = '#2196f3';
            ctx.lineWidth   = 2;
            ctx.fill();
            ctx.stroke();
        });
    }
    ctx.restore();
}

// ─── IMAGE MOVE / RESIZE ─────────────────────────────────────────────────────
const HANDLE = 18; // px in canvas space

function startImageInteract(e) {
    const p = getCanvasPos(e);
    for (let i = state.images.length - 1; i >= 0; i--) {
        const img = state.images[i];
        const inHandle = p.x >= img.x + img.w - HANDLE && p.x <= img.x + img.w + HANDLE &&
                         p.y >= img.y + img.h - HANDLE && p.y <= img.y + img.h + HANDLE;
        const inBody   = p.x >= img.x && p.x <= img.x + img.w && p.y >= img.y && p.y <= img.y + img.h;
        if (inHandle || inBody) {
            state.selectedImageIdx = i;
            state.imgAction    = inHandle ? 'resize' : 'drag';
            state.imgDragStart = { px: p.x, py: p.y, ix: img.x, iy: img.y, iw: img.w, ih: img.h };
            el.hudImgActs.style.display = '';
            redrawCanvas();
            return;
        }
    }
    state.selectedImageIdx = null;
    el.hudImgActs.style.display = 'none';
    redrawCanvas();
}
function doImageInteract(e) {
    if (state.selectedImageIdx === null || !state.imgAction) return;
    const p   = getCanvasPos(e);
    const img = state.images[state.selectedImageIdx];
    const s   = state.imgDragStart;
    if (!img || !s) return;
    if (state.imgAction === 'drag') {
        img.x = s.ix + (p.x - s.px);
        img.y = s.iy + (p.y - s.py);
    } else {
        img.w = Math.max(20, s.iw + (p.x - s.px));
        img.h = Math.max(20, s.ih + (p.y - s.py));
    }
    redrawCanvas();
}
function endImageInteract() { state.imgAction = null; }

// ─── UNDO / REDO ─────────────────────────────────────────────────────────────
function snapshotLayers() {
    return state.layers.map(l => ({ ...l }));
}
function deepCopyAction(a) {
    if (a.type === 'stroke') return { ...a, points: [...a.points] };
    if (a.type === 'polygon') return {
        ...a,
        snapshots: a.snapshots.map(s => ({ ...s, vertices: s.vertices.map(v => ({ ...v })) })),
    };
    return { ...a };
}
function saveUndoSnapshot() {
    state.undoStack.push({
        actions: state.drawingActions.map(deepCopyAction),
        layers:  snapshotLayers(),
    });
    state.redoStack = [];
    if (state.undoStack.length > 60) state.undoStack.shift();
}
function restoreSnapshot(snap) {
    state.drawingActions = snap.actions;
    snap.layers.forEach(sl => {
        const l = state.layers.find(x => x.id === sl.id);
        if (l) l.duration = sl.duration;
    });
    state.currentTime = Math.min(state.currentTime, getTotalDuration());
}
function undo() {
    if (!state.undoStack.length) return;
    state.redoStack.push({ actions: state.drawingActions.map(deepCopyAction), layers: snapshotLayers() });
    restoreSnapshot(state.undoStack.pop());
    polyBuild = null; polyEditId = null;
    redrawCanvas(); updateTimelineUI();
}
function redo() {
    if (!state.redoStack.length) return;
    state.undoStack.push({ actions: state.drawingActions.map(deepCopyAction), layers: snapshotLayers() });
    restoreSnapshot(state.redoStack.pop());
    polyBuild = null; polyEditId = null;
    redrawCanvas(); updateTimelineUI();
}
function clearActiveLayer() {
    if (!confirm('Clear all strokes on the active layer?')) return;
    saveUndoSnapshot();
    state.drawingActions = state.drawingActions.filter(a => a.layerId !== state.activeLayerId);
    const layer = getActiveLayer();
    if (layer) layer.duration = 0;
    state.currentTime = Math.min(state.currentTime, getTotalDuration());
    redrawCanvas(); updateTimelineUI();
}

// ─── RENDERING ───────────────────────────────────────────────────────────────
function smoothStroke(ctx, pts, partial, count) {
    const arr = partial ? pts.slice(0, Math.max(2, count)) : pts;
    if (arr.length < 2) return;
    ctx.moveTo(arr[0].x, arr[0].y);
    for (let i = 1; i < arr.length - 1; i++) {
        const mx = (arr[i].x + arr[i+1].x) / 2;
        const my = (arr[i].y + arr[i+1].y) / 2;
        ctx.quadraticCurveTo(arr[i].x, arr[i].y, mx, my);
    }
    const last = arr[arr.length - 1];
    ctx.lineTo(last.x, last.y);
}

function redrawCanvas(overrideTime) {
    const ctx  = state.ctx;
    const time = overrideTime !== undefined ? overrideTime : state.currentTime;

    // Background
    ctx.fillStyle = state.bgColor;
    ctx.fillRect(0, 0, state.width, state.height);

    // Camera transform from keyframes
    const cam = getCameraAtTime(time);
    ctx.save();
    ctx.translate(state.width  / 2, state.height / 2);
    ctx.scale(cam.scale, cam.scale);
    ctx.translate(-cam.cx, -cam.cy);

    // Draw layers bottom→top
    [...state.layers].reverse().forEach(layer => {
        if (!layer.visible) return;
        const imgs    = state.images.filter(img => img.layerId === layer.id);
        const actions = state.drawingActions.filter(a => a.layerId === layer.id);

        // Images
        imgs.forEach((img, localIdx) => {
            ctx.save();
            ctx.globalAlpha = layer.opacity;
            ctx.drawImage(img.el, img.x, img.y, img.w, img.h);
            // Selection handles
            if (state.tool === 'move' && state.images[state.selectedImageIdx] === img) {
                ctx.globalAlpha = 1;
                ctx.strokeStyle = '#0090ff';
                ctx.lineWidth   = 3 / cam.scale / state.view.scale;
                ctx.strokeRect(img.x, img.y, img.w, img.h);
                ctx.fillStyle = '#0090ff';
                const hs = HANDLE;
                ctx.fillRect(img.x + img.w - hs / 2, img.y + img.h - hs / 2, hs, hs);
            }
            ctx.restore();
        });

        // Strokes
        actions.forEach(action => {
            if (action.type === 'polygon') {
                // Polygon rendering
                const verts = getPolyVertsAtTime(action, time);
                if (!verts) return; // not yet created at this time
                ctx.save();
                ctx.globalAlpha = layer.opacity;
                renderPolygon(ctx, action, verts, action.id === polyEditId && state.tool === 'polygon');
                ctx.restore();
                return;
            }

            // Brush stroke
            if (action.startTime > time) return;
            const pts = action.points;
            if (!pts || pts.length < 2) return;

            ctx.save();
            ctx.beginPath();
            ctx.lineCap  = 'round';
            ctx.lineJoin = 'round';
            ctx.lineWidth = action.size;
            ctx.strokeStyle = action.isEraser ? state.bgColor : action.color;
            ctx.globalAlpha = action.opacity * layer.opacity;
            ctx.globalCompositeOperation = 'source-over';

            if (action.endTime <= time) {
                smoothStroke(ctx, pts, false, 0);
            } else {
                const pct = (time - action.startTime) / Math.max(1, action.endTime - action.startTime);
                smoothStroke(ctx, pts, true, Math.floor(pts.length * pct));
            }
            ctx.stroke();
            ctx.restore();
        });
    });

    // Live preview: brush stroke being drawn
    if (state.isDrawing && currentPath.length > 1) {
        ctx.save();
        ctx.beginPath();
        ctx.lineCap  = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth    = state.tool === 'eraser' ? state.brush.size * 2.5 : state.brush.size;
        ctx.strokeStyle  = state.tool === 'eraser' ? state.bgColor : state.brush.color;
        ctx.globalAlpha  = state.brush.opacity;
        smoothStroke(ctx, currentPath, false, 0);
        ctx.stroke();
        ctx.restore();
    }

    // Live preview: polygon being built
    if (state.tool === 'polygon' && polyBuild && polyBuild.vertices.length >= 1) {
        const verts = polyBuild.vertices;
        ctx.save();
        ctx.setLineDash([8, 6]);
        ctx.lineCap     = 'round';
        ctx.lineJoin    = 'round';
        ctx.lineWidth   = state.polygon.strokeWidth;
        ctx.strokeStyle = state.polygon.color;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.moveTo(verts[0].x, verts[0].y);
        verts.slice(1).forEach(v => ctx.lineTo(v.x, v.y));
        if (polyPreview) ctx.lineTo(polyPreview.x, polyPreview.y); // dashed line to cursor
        ctx.stroke();
        ctx.setLineDash([]);

        // Vertex dots
        verts.forEach((v, i) => {
            const isFirst  = i === 0;
            const nearFirst = isFirst && verts.length >= 3 && polyPreview &&
                Math.hypot(polyPreview.x - v.x, polyPreview.y - v.y) < POLY_SNAP_DIST;
            ctx.beginPath();
            ctx.arc(v.x, v.y, isFirst ? POLY_VTX_HIT * 1.1 : POLY_VTX_HIT * 0.7, 0, Math.PI * 2);
            ctx.fillStyle   = nearFirst ? '#4caf50' : (isFirst ? '#fff' : state.polygon.color);
            ctx.strokeStyle = nearFirst ? '#4caf50' : state.polygon.color;
            ctx.lineWidth   = 2;
            ctx.globalAlpha = 1;
            ctx.fill();
            ctx.stroke();
        });
        ctx.restore();
    }

    ctx.restore();
}

// ─── KEYFRAME SYSTEM (CapCut-style) ──────────────────────────────────────────
/**
 * Camera keyframes store the workspace view so the user can visually set zoom/pan.
 * { id, time, viewX, viewY, viewScale }
 *
 * getCameraAtTime converts these view params → canvas ctx transform:
 *   - view.scale = zoom level
 *   - view.x, view.y = canvas center offsets in view-space
 */
function viewToCamera(viewX, viewY, viewScale) {
    // Canvas pixel under the center of the workspace at this view
    const ppc = state.width / state.canvasDisplayW; // canvas pixels per CSS pixel
    const cx  = state.width  / 2 - (viewX / viewScale) * ppc;
    const cy  = state.height / 2 - (viewY / viewScale) * ppc;
    return { cx, cy, scale: viewScale };
}

function getCameraAtTime(time) {
    const kfs = state.keyframes;
    if (kfs.length === 0) return { cx: state.width / 2, cy: state.height / 2, scale: 1 };

    // Clamp
    if (time <= kfs[0].time) return viewToCamera(kfs[0].viewX, kfs[0].viewY, kfs[0].viewScale);
    if (time >= kfs[kfs.length - 1].time) {
        const k = kfs[kfs.length - 1];
        return viewToCamera(k.viewX, k.viewY, k.viewScale);
    }

    // Find surrounding pair
    let prev = kfs[0], next = kfs[kfs.length - 1];
    for (let i = 0; i < kfs.length - 1; i++) {
        if (kfs[i].time <= time && kfs[i + 1].time > time) {
            prev = kfs[i]; next = kfs[i + 1]; break;
        }
    }

    const t  = (time - prev.time) / (next.time - prev.time);
    // Ease in-out cubic
    const et = t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2;

    return viewToCamera(
        prev.viewX + (next.viewX - prev.viewX) * et,
        prev.viewY + (next.viewY - prev.viewY) * et,
        prev.viewScale + (next.viewScale - prev.viewScale) * et,
    );
}

function captureKeyframe() {
    const id = Date.now();
    state.keyframes.push({
        id,
        time:      state.currentTime,
        viewX:     state.view.x,
        viewY:     state.view.y,
        viewScale: state.view.scale,
    });
    state.keyframes.sort((a, b) => a.time - b.time);
    state.selectedKfId = id;
    renderKeyframesUI();
    updateKfHint();
}

function deleteSelectedKf() {
    if (!state.selectedKfId) return;
    state.keyframes = state.keyframes.filter(k => k.id !== state.selectedKfId);
    state.selectedKfId = null;
    renderKeyframesUI();
    updateKfHint();
    redrawCanvas();
}

function jumpToKeyframe(kf) {
    // Animate workspace view to this keyframe's recorded view
    const startX = state.view.x, startY = state.view.y, startS = state.view.scale;
    const endX   = kf.viewX,    endY   = kf.viewY,    endS   = kf.viewScale;
    const dur    = 350; // ms
    const t0     = performance.now();
    function step(now) {
        const t  = Math.min(1, (now - t0) / dur);
        const et = 1 - Math.pow(1 - t, 3); // ease-out cubic
        state.view.x     = startX + (endX - startX) * et;
        state.view.y     = startY + (endY - startY) * et;
        state.view.scale = startS + (endS - startS) * et;
        applyViewport();
        if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

function updateKfHint() {
    if (state.selectedKfId) {
        const kf = state.keyframes.find(k => k.id === state.selectedKfId);
        if (kf) {
            el.kfHint.style.display = 'flex';
            el.kfLabel.textContent  = `Keyframe @ ${(kf.time / 1000).toFixed(1)}s — Zoom ${Math.round(kf.viewScale * 100)}%`;
            return;
        }
    }
    el.kfHint.style.display = 'none';
}

// ─── TIMELINE ────────────────────────────────────────────────────────────────
let tlScrubbing = false;

function scrubTimeline(e) {
    const rect  = el.tlTrack.getBoundingClientRect();
    const pct   = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const total = getTotalDuration();
    state.currentTime = pct * total;
    if (state.keyframes.length > 0) {
        const cam = getCameraAtTime(state.currentTime);
        const ppc = state.width / state.canvasDisplayW;
        state.view.x     = (state.width  / 2 - cam.cx) * cam.scale / ppc;
        state.view.y     = (state.height / 2 - cam.cy) * cam.scale / ppc;
        state.view.scale = cam.scale;
        applyViewport();
    }
    redrawCanvas();
    updateTimelineUI();
}

el.tlTrack.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('kf-marker')) return; // handled by kf drag
    tlScrubbing = true;
    scrubTimeline(e);
});
window.addEventListener('mousemove', (e) => { if (tlScrubbing) scrubTimeline(e); });
window.addEventListener('mouseup',   ()  => { tlScrubbing = false; });

function updateTimelineUI() {
    const total = getTotalDuration();
    const pct   = total > 0 ? (state.currentTime / total) * 100 : 0;
    el.tlCursor.style.left = pct + '%';
    el.timeDisplay.textContent =
        (state.currentTime / 1000).toFixed(1) + 's / ' +
        (total             / 1000).toFixed(1) + 's';
    renderKeyframesUI();
}

function renderKeyframesUI() {
    el.tlKeyframes.innerHTML = '';
    const total = getTotalDuration();
    if (total === 0) return;

    state.keyframes.forEach(kf => {
        const pct = (kf.time / total) * 100;
        const div = document.createElement('div');
        div.className   = 'kf-marker' + (kf.id === state.selectedKfId ? ' selected' : '');
        div.style.left  = pct + '%';
        div.title       = `Zoom ${Math.round(kf.viewScale * 100)}%  @  ${(kf.time / 1000).toFixed(2)}s\nClick to preview · Drag to reposition`;

        // Click → select + jump
        div.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            const wasSelected = kf.id === state.selectedKfId;
            state.selectedKfId = kf.id;
            renderKeyframesUI();
            updateKfHint();
            jumpToKeyframe(kf);

            // Start drag on this keyframe
            const trackRect = el.tlTrack.getBoundingClientRect();
            function onMove(me) {
                const newPct = Math.max(0, Math.min(1, (me.clientX - trackRect.left) / trackRect.width));
                kf.time = newPct * getTotalDuration();
                state.keyframes.sort((a, b) => a.time - b.time);
                updateKfHint();
                renderKeyframesUI();
                updateTimelineUI();
            }
            function onUp() {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
            }
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
        });

        el.tlKeyframes.appendChild(div);
    });
}

// ─── PLAYBACK ────────────────────────────────────────────────────────────────
function togglePlay() {
    const total = getTotalDuration();
    if (state.isPlaying) {
        state.isPlaying = false;
        cancelAnimationFrame(state.rafId);
        document.getElementById('btn-play').innerHTML = "<i class='bx bx-play'></i>";
    } else {
        if (state.currentTime >= total) state.currentTime = 0;
        state.isPlaying    = true;
        state.lastDrawTime = Date.now();
        document.getElementById('btn-play').innerHTML = "<i class='bx bx-pause'></i>";
        playLoop();
    }
}

function playLoop() {
    if (!state.isPlaying) return;
    const total = getTotalDuration();
    const now   = Date.now();
    const delta = (now - state.lastDrawTime) * state.playbackSpeed;
    state.lastDrawTime  = now;
    state.currentTime  += delta;

    if (state.currentTime >= total) {
        state.currentTime = total;
        state.isPlaying   = false;
        document.getElementById('btn-play').innerHTML = "<i class='bx bx-play'></i>";
    }

    // Animate workspace view with keyframes during playback
    if (state.keyframes.length > 0) {
        const cam = getCameraAtTime(state.currentTime);
        const ppc = state.width / state.canvasDisplayW;
        state.view.x     = (state.width  / 2 - cam.cx) * cam.scale / ppc;
        state.view.y     = (state.height / 2 - cam.cy) * cam.scale / ppc;
        state.view.scale = cam.scale;
        applyViewport();
    }

    redrawCanvas();
    updateTimelineUI();
    if (state.isPlaying) state.rafId = requestAnimationFrame(playLoop);
}

// ─── EXPORT ──────────────────────────────────────────────────────────────────
function savePng() {
    const ec  = document.createElement('canvas');
    ec.width  = state.width;
    ec.height = state.height;
    const origCtx = state.ctx;
    state.ctx = ec.getContext('2d');
    redrawCanvas(getTotalDuration());
    state.ctx = origCtx;
    ec.toBlob(blob => {
        const a = document.createElement('a');
        a.href     = URL.createObjectURL(blob);
        a.download = 'drawing.png';
        a.click();
    }, 'image/png');
}

async function exportVideo() {
    const total = getTotalDuration();
    if (total === 0) { el.exportStatus.textContent = 'Nothing to export.'; return; }
    state.isPlaying = false;
    cancelAnimationFrame(state.rafId);
    document.getElementById('btn-play').innerHTML = "<i class='bx bx-play'></i>";

    el.exportStatus.textContent = 'Preparing...';
    const ec = document.createElement('canvas');
    ec.width  = 1920; ec.height = 1080;
    const stream   = ec.captureStream(60);
    const mimeType = MediaRecorder.isTypeSupported('video/webm; codecs=vp9')
        ? 'video/webm; codecs=vp9' : 'video/webm';
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks   = [];
    recorder.ondataavailable = e => chunks.push(e.data);
    recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const a    = document.createElement('a');
        a.href     = URL.createObjectURL(blob);
        a.download = 'drawing-export.webm';
        a.click();
        el.exportStatus.textContent = 'Done!';
        state.ctx     = el.canvas.getContext('2d', { alpha: false });
        state.width   = state.canvas.width;
        state.height  = state.canvas.height;
        redrawCanvas();
    };

    const origCtx = state.ctx, origW = state.width, origH = state.height;
    state.ctx    = ec.getContext('2d');
    state.width  = 1920; state.height = 1080;

    recorder.start();
    await new Promise(r => setTimeout(r, 150));

    const fps  = 30;   // 30 fps is reliable with MediaRecorder
    const step = 1000 / fps;
    let t = 0;
    while (t <= total + step) {
        const clampedT = Math.min(t, total);
        redrawCanvas(clampedT);
        // Give the browser a real animation frame so the canvas stream captures it
        await new Promise(r => requestAnimationFrame(() => setTimeout(r, 2)));
        el.exportStatus.textContent = 'Rendering ' + Math.min(100, Math.round(clampedT / total * 100)) + '%';
        t += step;
    }
    redrawCanvas(total);
    await new Promise(r => setTimeout(r, 600));
    recorder.stop();

    state.ctx    = origCtx;
    state.width  = origW;
    state.height = origH;
}

// ─── LAYERS UI ───────────────────────────────────────────────────────────────
function renderLayersUI() {
    el.layersList.innerHTML = '';
    state.layers.forEach(layer => {
        const div = document.createElement('div');
        div.className = 'layer-item' + (layer.id === state.activeLayerId ? ' selected' : '');

        const name = document.createElement('span');
        name.className   = 'layer-name';
        name.textContent = layer.name;

        const ops = document.createElement('div');
        ops.className = 'layer-ops';

        // Opacity slider
        const oSlider = document.createElement('input');
        oSlider.type  = 'range';
        oSlider.min   = '0'; oSlider.max = '1'; oSlider.step = '0.05';
        oSlider.value = layer.opacity;
        oSlider.title = 'Opacity';
        oSlider.addEventListener('input', e => { e.stopPropagation(); layer.opacity = +e.target.value; redrawCanvas(); });
        oSlider.addEventListener('click', e => e.stopPropagation());

        // Visibility toggle
        const visI = document.createElement('i');
        visI.className = 'bx ' + (layer.visible ? 'bx-show' : 'bx-hide');
        visI.title     = 'Toggle visibility';
        visI.addEventListener('click', e => {
            e.stopPropagation();
            layer.visible  = !layer.visible;
            visI.className = 'bx ' + (layer.visible ? 'bx-show' : 'bx-hide');
            redrawCanvas();
        });

        // Delete
        const delI = document.createElement('i');
        delI.className = 'bx bx-x del-icon';
        delI.title     = 'Delete layer';
        delI.addEventListener('click', e => {
            e.stopPropagation();
            if (state.layers.length === 1) return;
            state.layers        = state.layers.filter(l => l.id !== layer.id);
            state.drawingActions = state.drawingActions.filter(a => a.layerId !== layer.id);
            state.images         = state.images.filter(img => img.layerId !== layer.id);
            if (state.activeLayerId === layer.id) state.activeLayerId = state.layers[0].id;
            renderLayersUI();
            redrawCanvas();
        });

        ops.append(oSlider, visI, delI);
        div.append(name, ops);
        div.addEventListener('click', () => { state.activeLayerId = layer.id; renderLayersUI(); });
        el.layersList.appendChild(div);
    });
}

// ─── ASSET HANDLING ──────────────────────────────────────────────────────────
function handleAssetImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
        const img = new Image();
        img.onload = () => {
            const w = Math.min(img.width, state.width * 0.4);
            state.images.push({ id: Date.now(), el: img, x: 100, y: 100, w, h: w * (img.height / img.width), layerId: state.activeLayerId });
            redrawCanvas();
        };
        img.src = evt.target.result;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
}

function handleBgImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
        const img = new Image();
        img.onload = () => {
            state.canvas.width  = img.width;
            state.canvas.height = img.height;
            state.width  = img.width;
            state.height = img.height;
            state.images = state.images.filter(i => i.id !== 'bg');
            state.images.unshift({ id: 'bg', el: img, x: 0, y: 0, w: img.width, h: img.height, layerId: state.layers[state.layers.length - 1].id });
            fitCanvasToWorkspace();
            redrawCanvas();
        };
        img.src = evt.target.result;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
}

// ─── EVENT LISTENERS ─────────────────────────────────────────────────────────
function setupEventListeners() {
    // Canvas draw events
    el.workspace.addEventListener('mousedown',  startDrawing);
    el.workspace.addEventListener('mousemove',  onDrawMove);
    window.addEventListener(      'mouseup',    stopDrawing);
    el.workspace.addEventListener('touchstart', e => { e.preventDefault(); startDrawing(e); }, { passive: false });
    el.workspace.addEventListener('touchmove',  e => { e.preventDefault(); onDrawMove(e); },  { passive: false });
    window.addEventListener(      'touchend',   stopDrawing);

    // Tools
    document.getElementById('tool-brush'  ).addEventListener('click', () => setTool('brush'));
    document.getElementById('tool-eraser' ).addEventListener('click', () => setTool('eraser'));
    document.getElementById('tool-polygon').addEventListener('click', () => setTool('polygon'));
    document.getElementById('tool-pan'    ).addEventListener('click', () => setTool('pan'));
    document.getElementById('tool-move'   ).addEventListener('click', () => setTool('move'));

    // Polygon double-click to close
    el.workspace.addEventListener('dblclick', handlePolyDblClick);

    // Polygon properties
    document.getElementById('poly-stroke-color').addEventListener('input', e => {
        state.polygon.color = e.target.value;
        const poly = getPolyById(polyEditId);
        if (poly) { poly.strokeColor = e.target.value; redrawCanvas(); }
    });
    document.getElementById('poly-fill-color').addEventListener('input', e => {
        state.polygon.fillColor = e.target.value;
        const poly = getPolyById(polyEditId);
        if (poly) { poly.fillColor = e.target.value; redrawCanvas(); }
    });
    document.getElementById('poly-stroke-width').addEventListener('input', e => {
        state.polygon.strokeWidth = +e.target.value;
        document.getElementById('poly-stroke-width-val').textContent = e.target.value;
        const poly = getPolyById(polyEditId);
        if (poly) { poly.strokeWidth = +e.target.value; redrawCanvas(); }
    });
    document.getElementById('poly-fill-alpha').addEventListener('input', e => {
        state.polygon.fillAlpha = +e.target.value;
        document.getElementById('poly-fill-alpha-val').textContent = Math.round(e.target.value * 100) + '%';
        const poly = getPolyById(polyEditId);
        if (poly) { poly.fillAlpha = +e.target.value; redrawCanvas(); }
    });

    // Undo/Redo/Clear
    document.getElementById('btn-undo' ).addEventListener('click', undo);
    document.getElementById('btn-redo' ).addEventListener('click', redo);
    document.getElementById('btn-clear').addEventListener('click', clearActiveLayer);

    // Brush props
    document.getElementById('brush-color').addEventListener('input', e => state.brush.color = e.target.value);
    document.getElementById('brush-size' ).addEventListener('input', e => {
        state.brush.size = +e.target.value;
        document.getElementById('brush-size-val').textContent = e.target.value;
    });
    document.getElementById('brush-opacity').addEventListener('input', e => {
        state.brush.opacity = +e.target.value;
        document.getElementById('brush-opacity-val').textContent = Math.round(e.target.value * 100) + '%';
    });

    // Background color
    document.getElementById('bg-color').addEventListener('input', e => { state.bgColor = e.target.value; redrawCanvas(); });

    // Zoom controls
    document.getElementById('btn-zoom-in' ).addEventListener('click', () => zoomStep(1.25));
    document.getElementById('btn-zoom-out').addEventListener('click', () => zoomStep(0.8));
    document.getElementById('btn-zoom-fit').addEventListener('click', fitCanvasToWorkspace);

    // Playback
    document.getElementById('btn-play').addEventListener('click', togglePlay);
    document.getElementById('btn-stop').addEventListener('click', () => {
        state.isPlaying   = false;
        cancelAnimationFrame(state.rafId);
        state.currentTime = 0;
        document.getElementById('btn-play').innerHTML = "<i class='bx bx-play'></i>";
        redrawCanvas(); updateTimelineUI();
    });
    document.getElementById('playback-speed').addEventListener('change', e => state.playbackSpeed = +e.target.value);

    // Keyframes
    document.getElementById('btn-add-keyframe').addEventListener('click', captureKeyframe);
    document.getElementById('kf-delete-btn').addEventListener('click', deleteSelectedKf);

    // Layers
    document.getElementById('btn-add-layer').addEventListener('click', () => {
        const id = Date.now();
        state.layers.unshift({ id, name: 'Layer ' + (state.layers.length + 1), visible: true, opacity: 1, duration: 0 });
        state.activeLayerId = id;
        renderLayersUI();
    });

    // Assets
    document.getElementById('btn-add-asset'   ).addEventListener('click', () => document.getElementById('file-asset').click());
    document.getElementById('file-asset'       ).addEventListener('change', handleAssetImport);
    document.getElementById('btn-remove-asset' ).addEventListener('click', () => {
        if (state.selectedImageIdx !== null) {
            state.images.splice(state.selectedImageIdx, 1);
            state.selectedImageIdx = null;
            el.hudImgActs.style.display = 'none';
            redrawCanvas();
        }
    });

    // Canvas settings
    document.getElementById('btn-import-bg').addEventListener('click', () => document.getElementById('file-import-bg').click());
    document.getElementById('file-import-bg').addEventListener('change', handleBgImport);
    document.getElementById('mode-blank').addEventListener('click', () => {
        state.images = state.images.filter(i => i.id !== 'bg');
        state.canvas.width  = 1920;
        state.canvas.height = 1080;
        state.width  = 1920;
        state.height = 1080;
        fitCanvasToWorkspace();
        redrawCanvas();
    });

    // Export
    document.getElementById('btn-save-png').addEventListener('click', savePng);
    el.exportBtn.addEventListener('click', exportVideo);

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
        if (['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) return;
        if (e.code === 'Space') return; // handled above
        const ctrl = e.ctrlKey || e.metaKey;
        if (ctrl && !e.shiftKey && e.key === 'z') { e.preventDefault(); undo(); return; }
        if ((ctrl && e.key === 'y') || (ctrl && e.shiftKey && e.key === 'z')) { e.preventDefault(); redo(); return; }
        if (e.key === 'b' || e.key === 'B') setTool('brush');
        if (e.key === 'e' || e.key === 'E') setTool('eraser');
        if (e.key === 'v' || e.key === 'V') setTool('polygon');
        if (e.key === 'h' || e.key === 'H') setTool('pan');
        if (e.key === 'm' || e.key === 'M') setTool('move');
        if (e.key === 'f' || e.key === 'F') fitCanvasToWorkspace();
        if (e.key === '+' || e.key === '=') zoomStep(1.25);
        if (e.key === '-') zoomStep(0.8);
        if (e.key === ' ') { e.preventDefault(); togglePlay(); }
        if (e.key === 'Escape') { cancelPolyBuild(); }
        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (state.tool === 'polygon' && polyEditId) {
                saveUndoSnapshot();
                state.drawingActions = state.drawingActions.filter(a => !(a.type === 'polygon' && a.id === polyEditId));
                polyEditId = null; redrawCanvas(); updateTimelineUI();
            } else {
                deleteSelectedKf();
            }
        }
    });

    // Prevent context menu on middle-click so pan works cleanly
    el.workspace.addEventListener('contextmenu', e => e.preventDefault());
    el.workspace.addEventListener('auxclick',    e => { if (e.button === 1) e.preventDefault(); });

    // Window resize
    window.addEventListener('resize', () => {
        fitCanvasToWorkspace();
        redrawCanvas();
    });
}

function setTool(tool) {
    state.tool = tool;
    ['brush','eraser','polygon','pan','move'].forEach(t =>
        document.getElementById('tool-' + t)?.classList.toggle('active', t === tool)
    );
    // Workspace cursor class
    el.workspace.className = 'workspace tool-' + tool;
    if (state.spaceHeld) el.workspace.classList.add('panning');

    // Cancel in-progress polygon build when switching away
    if (tool !== 'polygon') { polyBuild = null; polyEditId = null; }

    // Deselect images when leaving move tool
    if (tool !== 'move') {
        state.selectedImageIdx = null;
        el.hudImgActs.style.display = 'none';
    }

    // Show/hide right-panel sections
    const brushPanel = document.getElementById('brush-panel');
    const polyPanel  = document.getElementById('polygon-panel');
    if (brushPanel) brushPanel.style.display = (tool === 'brush' || tool === 'eraser') ? '' : 'none';
    if (polyPanel)  polyPanel.style.display  = tool === 'polygon' ? '' : 'none';

    redrawCanvas();
}

// ─── BOOT ────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', init);
