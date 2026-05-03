import React from 'react';
import fs from 'fs';

export function makeZellijPatch() {
  const code = fs.readFileSync('src/components/ZellijApp.jsx', 'utf8');

  // Add the new snap marker hit detection logic to onPointerDown
  const oldPointerDown = `if (handles.length > 0 && ptrState.current.pointers.size === 0) {
              const hitRadiusWorld = (HANDLE_R + HANDLE_HIT_PAD) / view.scale;
              let nearest = null;
              let nearestD = hitRadiusWorld;
              for (const h of handles) {
                const d = dist(worldP, h);
                if (d < nearestD) { nearestD = d; nearest = h; }
              }
              if (nearest) {
                e.target.setPointerCapture?.(e.pointerId);
                ptrState.current.pointers.set(e.pointerId, {
                  ...pos, downAt: Date.now(), moved: false, startScreen: pos, startWorld: worldP,
                });
                ptrState.current.action = { kind: 'dragHandle', handle: nearest, startView: { ...view } };
                setIsDragging(true);
                return;
              }
            }`;

  const newPointerDown = `if (handles.length > 0 && ptrState.current.pointers.size === 0) {
              const hitRadiusWorld = (HANDLE_R + HANDLE_HIT_PAD) / view.scale;
              let nearest = null;
              let nearestD = hitRadiusWorld;
              for (const h of handles) {
                const d = dist(worldP, h);
                if (d < nearestD) { nearestD = d; nearest = h; }
              }
              if (nearest) {
                e.target.setPointerCapture?.(e.pointerId);
                ptrState.current.pointers.set(e.pointerId, {
                  ...pos, downAt: Date.now(), moved: false, startScreen: pos, startWorld: worldP,
                });
                ptrState.current.action = { kind: 'dragHandle', handle: nearest, startView: { ...view } };
                setIsDragging(true);
                return;
              }
            }

            if (showSnapButtons && ptrState.current.pointers.size === 0) {
              const targets = computeSnapTargets();
              const hitRadiusWorld = 10 / view.scale;
              let hitSnap = null;
              for (const p of targets.points) {
                if (dist(worldP, p) < hitRadiusWorld) {
                  hitSnap = p;
                  break;
                }
              }
              if (hitSnap) {
                e.target.setPointerCapture?.(e.pointerId);
                ptrState.current.pointers.set(e.pointerId, {
                  ...pos, downAt: Date.now(), moved: false, startScreen: pos, startWorld: hitSnap,
                });
                ptrState.current.action = { kind: 'pan', startScreen: pos, startView: { ...view } };
                return;
              }
            }`;

  let newCode = code.replace(oldPointerDown, newPointerDown);

  const startSvg = '<svg\\n          ref={svgRef}';
  const endSvg = '</svg>';
  
  const regex = new RegExp('<svg\\\\n\\\\s*ref=\\\\{svgRef\\\\}[\\\\s\\\\S]*?</svg>');
  
  const newSvgReplacement = `<div
          ref={svgRef}
          style={{ width: '100%', height: '100%', touchAction: 'none' }}
          onPointerDown={(e) => {
            // Defensive: if a child handler has already initiated a non-pan action
            // for this pointerdown, don't override it.
            if (ptrState.current.action?.kind === 'dragHandle') return;
            const pos = getEventPos(e);
            const worldP = screenToWorld(pos.x, pos.y);

            // Nearest-handle hit detection: if a handle is within hit radius of the tap, drag it.
            // "Closest wins" — works correctly when handle hit areas overlap, no z-order surprises.
            // Only check this for the first finger; pinch/2-finger gestures go through pinch logic.
            if (handles.length > 0 && ptrState.current.pointers.size === 0) {
              const hitRadiusWorld = (HANDLE_R + HANDLE_HIT_PAD) / view.scale;
              let nearest = null;
              let nearestD = hitRadiusWorld;
              for (const h of handles) {
                const d = dist(worldP, h);
                if (d < nearestD) { nearestD = d; nearest = h; }
              }
              if (nearest) {
                e.target.setPointerCapture?.(e.pointerId);
                ptrState.current.pointers.set(e.pointerId, {
                  ...pos, downAt: Date.now(), moved: false, startScreen: pos, startWorld: worldP,
                });
                ptrState.current.action = { kind: 'dragHandle', handle: nearest, startView: { ...view } };
                setIsDragging(true);
                return;
              }
            }

            if (showSnapButtons && ptrState.current.pointers.size === 0) {
              const targets = computeSnapTargets();
              const hitRadiusWorld = 10 / view.scale;
              let hitSnap = null;
              for (const p of targets.points) {
                if (dist(worldP, p) < hitRadiusWorld) {
                  hitSnap = p;
                  break;
                }
              }
              if (hitSnap) {
                e.target.setPointerCapture?.(e.pointerId);
                ptrState.current.pointers.set(e.pointerId, {
                  ...pos, downAt: Date.now(), moved: false, startScreen: pos, startWorld: hitSnap,
                });
                ptrState.current.action = { kind: 'pan', startScreen: pos, startView: { ...view } };
                return;
              }
            }

            ptrState.current.pointers.set(e.pointerId, {
              ...pos, downAt: Date.now(), moved: false, startScreen: pos, startWorld: worldP,
            });
            e.target.setPointerCapture?.(e.pointerId);
            if (ptrState.current.pointers.size === 2) {
              const pts = [...ptrState.current.pointers.values()];
              const cx = (pts[0].x + pts[1].x) / 2;
              const cy = (pts[0].y + pts[1].y) / 2;
              const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
              ptrState.current.action = { kind: 'pinch', startDist: d, startCenter: { x: cx, y: cy }, startView: { ...view } };
            } else {
              // Always allow single-finger pan; tap vs drag distinguished by \`moved\` on pointer up.
              ptrState.current.action = { kind: 'pan', startScreen: pos, startView: { ...view } };
            }
          }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <CanvasRenderer
            view={view}
            lines={lines}
            circles={circles}
            placed={placed}
            tiles={tiles}
            inks={inks}
            planarFaces={planarFaces}
            coloredFaces={coloredFaces}
            polyDraft={polyDraft}
            polyRejected={polyRejected}
            draft={draft}
            handles={handles}
            snapIndicator={snapIndicator}
            snapTargets={showSnapButtons ? computeSnapTargets() : null}
            showSnapButtons={showSnapButtons}
            showCons={showCons}
            isDragging={isDragging}
            containerSize={containerSize}
            sharedEdgeKeys={sharedEdgeKeys}
            inkPaths={inkPaths}
            combinedSilhouettePath={combinedSilhouettePath}
            editing={editing}
          />
        </div>`;

  const regex2 = /<svg[\s\S]*?<\/svg>/;
  newCode = newCode.replace(regex2, newSvgReplacement);

  fs.writeFileSync('src/components/ZellijApp.jsx', newCode);
}
makeZellijPatch();
