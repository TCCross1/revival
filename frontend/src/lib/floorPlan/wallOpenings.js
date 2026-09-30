import { inches, round2, snapTo } from "./units";
import { roomOutsideBounds, wallLength } from "./model";
import { thicknessForRoomSide } from "./segmentedRoomDimension";

/**
 * Wall-local axis from geometric start (x1,y1) → end (x2,y2).
 * Opening.offset is measured along this axis from the start.
 */
export function wallAxis(wall) {
  const x1 = inches(wall.x1);
  const y1 = inches(wall.y1);
  const x2 = inches(wall.x2);
  const y2 = inches(wall.y2);
  const len = Math.max(wallLength(wall), 0.01);
  return {
    x1,
    y1,
    x2,
    y2,
    len,
    ux: (x2 - x1) / len,
    uy: (y2 - y1) / len,
  };
}

export function pointAlongWall(wall, alongInches) {
  const axis = wallAxis(wall);
  return {
    x: round2(axis.x1 + axis.ux * alongInches),
    y: round2(axis.y1 + axis.uy * alongInches),
  };
}

function roomForWall(level, wall) {
  if (!wall?.source_room_id) return null;
  return (level?.rooms || []).find((r) => r.id === wall.source_room_id) || null;
}

/**
 * Interior clear range along the wall axis (inches from geometric start).
 * Opening-position spans are measured inside this range — never from outside corners.
 */
export function wallInteriorClear(level, wall) {
  const axis = wallAxis(wall);
  const len = axis.len;
  const room = roomForWall(level, wall);
  if (!room) {
    return {
      clearStart: 0,
      clearEnd: round2(len),
      clearLength: round2(len),
    };
  }
  const side = wall.room_side || inferSide(wall, room);
  if (side === "north") {
    const startT = thicknessForRoomSide(level, room, "west");
    const endT = thicknessForRoomSide(level, room, "east");
    return packClear(startT, len - endT, len);
  }
  if (side === "south") {
    // South wall runs right → left; start is the east outside corner.
    const startT = thicknessForRoomSide(level, room, "east");
    const endT = thicknessForRoomSide(level, room, "west");
    return packClear(startT, len - endT, len);
  }
  // East/west room walls are already shortened between N/S interior faces.
  if (side === "east" || side === "west") {
    return packClear(0, len, len);
  }
  return packClear(0, len, len);
}

function packClear(clearStart, clearEnd, len) {
  const start = round2(Math.max(0, clearStart));
  const end = round2(Math.min(len, Math.max(start, clearEnd)));
  return {
    clearStart: start,
    clearEnd: end,
    clearLength: round2(end - start),
  };
}

function inferSide(wall, room) {
  const { left, top, right, bottom } = roomOutsideBounds(room);
  const mx = (inches(wall.x1) + inches(wall.x2)) / 2;
  const my = (inches(wall.y1) + inches(wall.y2)) / 2;
  const scores = {
    north: Math.abs(my - top),
    south: Math.abs(my - bottom),
    west: Math.abs(mx - left),
    east: Math.abs(mx - right),
  };
  return Object.entries(scores).sort((a, b) => a[1] - b[1])[0][0];
}

export function openingRange(opening) {
  const start = round2(inches(opening.offset));
  const width = round2(Math.max(1, inches(opening.width)));
  return { start, width, end: round2(start + width) };
}

export function clampOpeningOffset(level, wall, opening, rawOffset, snap = 1) {
  const clear = wallInteriorClear(level, wall);
  const width = round2(Math.max(1, inches(opening.width)));
  const min = clear.clearStart;
  const max = Math.max(min, clear.clearEnd - width);
  const snapped = snapTo(inches(rawOffset), snap);
  return round2(Math.max(min, Math.min(max, snapped)));
}

export function openingPositionSpans(level, wall, opening) {
  const clear = wallInteriorClear(level, wall);
  const range = openingRange(opening);
  const startSpan = round2(range.start - clear.clearStart);
  const endSpan = round2(clear.clearEnd - range.end);
  return {
    clear,
    startSpan,
    endSpan,
    openingWidth: range.width,
    openingStart: range.start,
    openingEnd: range.end,
  };
}

export function assertOpeningSpanInvariant(level, wall, opening, tol = 0.05) {
  const { clear, startSpan, endSpan, openingWidth } = openingPositionSpans(level, wall, opening);
  const sum = round2(startSpan + openingWidth + endSpan);
  return Math.abs(sum - clear.clearLength) <= tol;
}

/**
 * Chained feature dimensions along a wall's interior clear length.
 * For N openings: startSpan + w1 + between + w2 + ... + endSpan = clearLength.
 */
export function buildOpeningDimensionChain(level, wall) {
  const clear = wallInteriorClear(level, wall);
  const openings = [...(wall.openings || [])]
    .filter((o) => o && (o.type === "door" || o.type === "window" || o.type === "cased"))
    .map((o) => ({ opening: o, ...openingRange(o) }))
    .sort((a, b) => a.start - b.start);

  const segments = [];
  let cursor = clear.clearStart;
  openings.forEach(({ opening, start, end, width }) => {
    const span = round2(start - cursor);
    if (span > 0.05) {
      segments.push({
        kind: "span",
        role: segments.length === 0 ? "start" : "between",
        start: cursor,
        end: start,
        length: span,
        openingId: null,
      });
    }
    segments.push({
      kind: "opening",
      role: "opening",
      start,
      end,
      length: width,
      openingId: opening.id,
      openingType: opening.type,
      opening,
    });
    cursor = end;
  });
  const tail = round2(clear.clearEnd - cursor);
  if (tail > 0.05 || !openings.length) {
    segments.push({
      kind: "span",
      role: "end",
      start: cursor,
      end: clear.clearEnd,
      length: Math.max(0, tail),
      openingId: openings.length ? openings[openings.length - 1].opening.id : null,
    });
  }

  // Attach start/end span ownership for single-opening edit UX
  if (openings.length === 1) {
    segments.forEach((seg) => {
      if (seg.kind === "span" && seg.role === "start") seg.openingId = openings[0].opening.id;
      if (seg.kind === "span" && seg.role === "end") seg.openingId = openings[0].opening.id;
    });
  }

  const sum = round2(segments.reduce((acc, s) => acc + s.length, 0));
  return {
    wallId: wall.id,
    clear,
    segments,
    sum,
    invariantOk: Math.abs(sum - clear.clearLength) <= 0.05,
  };
}

export function setOpeningStartSpan(level, wallId, openingId, startSpanInches, snap = 0.25) {
  return mutateOpening(level, wallId, openingId, (wall, opening, clear) => {
    const width = inches(opening.width);
    const nextStart = round2(clear.clearStart + inches(startSpanInches));
    const maxStart = clear.clearEnd - width;
    if (nextStart < clear.clearStart - 0.01 || nextStart > maxStart + 0.01) {
      return { ok: false, reason: "Span exceeds available clear length." };
    }
    return {
      ok: true,
      opening: { ...opening, offset: snapTo(Math.max(clear.clearStart, Math.min(maxStart, nextStart)), snap) },
    };
  });
}

export function setOpeningEndSpan(level, wallId, openingId, endSpanInches, snap = 0.25) {
  return mutateOpening(level, wallId, openingId, (wall, opening, clear) => {
    const width = inches(opening.width);
    const nextEndSpan = inches(endSpanInches);
    const nextStart = round2(clear.clearEnd - nextEndSpan - width);
    const maxStart = clear.clearEnd - width;
    if (nextStart < clear.clearStart - 0.01 || nextStart > maxStart + 0.01) {
      return { ok: false, reason: "Span exceeds available clear length." };
    }
    return {
      ok: true,
      opening: { ...opening, offset: snapTo(Math.max(clear.clearStart, Math.min(maxStart, nextStart)), snap) },
    };
  });
}

export function setOpeningWidth(level, wallId, openingId, widthInches, snap = 0.25) {
  return mutateOpening(level, wallId, openingId, (wall, opening, clear) => {
    const width = Math.max(12, inches(widthInches));
    const start = inches(opening.offset);
    if (start + width > clear.clearEnd + 0.01) {
      const shifted = clear.clearEnd - width;
      if (shifted < clear.clearStart - 0.01) {
        return { ok: false, reason: "Opening is wider than the clear wall." };
      }
      return {
        ok: true,
        opening: {
          ...opening,
          width: snapTo(width, snap),
          offset: snapTo(Math.max(clear.clearStart, shifted), snap),
        },
      };
    }
    return { ok: true, opening: { ...opening, width: snapTo(width, snap) } };
  });
}

/** Resize opening while preserving centerline when possible. */
export function setOpeningWidthPreserveCenter(level, wallId, openingId, widthInches, snap = 0.25) {
  return mutateOpening(level, wallId, openingId, (wall, opening, clear) => {
    const width = Math.max(12, round2(inches(widthInches)));
    if (width > clear.clearLength + 0.01) {
      return { ok: false, reason: "Door is wider than the available clear wall length." };
    }
    const oldCenter = inches(opening.offset) + inches(opening.width) / 2;
    let nextStart = round2(oldCenter - width / 2);
    const min = clear.clearStart;
    const max = clear.clearEnd - width;
    nextStart = Math.max(min, Math.min(max, nextStart));
    return {
      ok: true,
      opening: {
        ...opening,
        width: snapTo(width, snap),
        offset: snapTo(nextStart, snap),
      },
    };
  });
}

/** Apply a full door-spec patch (width centered) onto a hosted opening. */
export function applyDoorOpeningPatch(level, wallId, openingId, patch, snap = 0.25) {
  const wall = (level.walls || []).find((w) => w.id === wallId);
  const opening = wall?.openings?.find((o) => o.id === openingId);
  if (!wall || !opening) return { ok: false, level, reason: "Opening not found." };

  const widthChanged = patch.width != null && Math.abs(inches(patch.width) - inches(opening.width)) > 0.01;
  let nextLevel = level;
  if (widthChanged) {
    const sized = setOpeningWidthPreserveCenter(level, wallId, openingId, patch.width, snap);
    if (!sized.ok) return sized;
    nextLevel = sized.level;
  }

  nextLevel = {
    ...nextLevel,
    walls: (nextLevel.walls || []).map((w) => {
      if (w.id !== wallId) return w;
      return {
        ...w,
        openings: (w.openings || []).map((o) => {
          if (o.id !== openingId) return o;
          const { offset, width, ...rest } = patch;
          const merged = { ...o, ...rest, id: o.id };
          // Keep geometry from preserve-center path when width changed.
          if (widthChanged) {
            const current = (nextLevel.walls || []).find((x) => x.id === wallId)?.openings?.find((x) => x.id === openingId);
            if (current) {
              merged.offset = current.offset;
              merged.width = current.width;
            }
          } else if (width != null) {
            merged.width = width;
          }
          if (!widthChanged && offset != null) merged.offset = offset;
          return merged;
        }),
      };
    }),
  };

  return { ok: true, level: nextLevel, wallId, openingId };
}

export function slideOpening(level, wallId, openingId, offsetInches, snap = 1) {
  return mutateOpening(level, wallId, openingId, (wall, opening) => ({
    ok: true,
    opening: {
      ...opening,
      offset: clampOpeningOffset(level, wall, opening, offsetInches, snap),
    },
  }));
}

/**
 * Move an opening onto another wall, projecting the world point onto the new axis.
 * Preserves width / swing / handing; returns new host wall id + selection info.
 */
export function rehostOpening(level, fromWallId, openingId, toWallId, worldX, worldY, snap = 1) {
  if (fromWallId === toWallId) {
    return slideOpening(level, fromWallId, openingId, projectOffset(level, toWallId, worldX, worldY, openingId), snap);
  }
  const fromWall = (level.walls || []).find((w) => w.id === fromWallId);
  const toWall = (level.walls || []).find((w) => w.id === toWallId);
  if (!fromWall || !toWall) return { ok: false, level, reason: "Wall not found." };
  const opening = (fromWall.openings || []).find((o) => o.id === openingId);
  if (!opening) return { ok: false, level, reason: "Opening not found." };

  const axis = wallAxis(toWall);
  const along = ((worldX - axis.x1) * axis.ux + (worldY - axis.y1) * axis.uy);
  const centered = along - inches(opening.width) / 2;
  const nextOpening = {
    ...opening,
    offset: clampOpeningOffset(level, toWall, opening, centered, snap),
  };

  const nextLevel = {
    ...level,
    walls: (level.walls || []).map((w) => {
      if (w.id === fromWallId) {
        return { ...w, openings: (w.openings || []).filter((o) => o.id !== openingId) };
      }
      if (w.id === toWallId) {
        return { ...w, openings: [...(w.openings || []), nextOpening] };
      }
      return w;
    }),
  };
  return {
    ok: true,
    level: nextLevel,
    wallId: toWallId,
    openingId,
    opening: nextOpening,
  };
}

function projectOffset(level, wallId, worldX, worldY, openingId) {
  const wall = (level.walls || []).find((w) => w.id === wallId);
  if (!wall) return 0;
  const opening = (wall.openings || []).find((o) => o.id === openingId);
  const axis = wallAxis(wall);
  const along = (worldX - axis.x1) * axis.ux + (worldY - axis.y1) * axis.uy;
  return along - (opening ? inches(opening.width) / 2 : 0);
}

function mutateOpening(level, wallId, openingId, mutator) {
  const wall = (level.walls || []).find((w) => w.id === wallId);
  if (!wall) return { ok: false, level, reason: "Wall not found." };
  const opening = (wall.openings || []).find((o) => o.id === openingId);
  if (!opening) return { ok: false, level, reason: "Opening not found." };
  const clear = wallInteriorClear(level, wall);
  const result = mutator(wall, opening, clear);
  if (!result?.ok) return { ok: false, level, reason: result?.reason || "Invalid." };
  return {
    ok: true,
    level: {
      ...level,
      walls: (level.walls || []).map((w) => {
        if (w.id !== wallId) return w;
        return {
          ...w,
          openings: (w.openings || []).map((o) => (o.id === openingId ? result.opening : o)),
        };
      }),
    },
    wallId,
    openingId,
    opening: result.opening,
  };
}

/** Exterior face world coordinate + orientation for dimension placement. */
export function wallExteriorFace(level, wall) {
  const room = roomForWall(level, wall);
  const side = wall.room_side || (room ? inferSide(wall, room) : null);
  if (!room || !side) {
    const axis = wallAxis(wall);
    return {
      side: null,
      orientation: Math.abs(axis.ux) >= Math.abs(axis.uy) ? "horizontal" : "vertical",
      faceWorld: Math.abs(axis.ux) >= Math.abs(axis.uy) ? axis.y1 : axis.x1,
      exteriorToward: -1,
      alongStart: 0,
      alongEnd: axis.len,
    };
  }
  const { left, top, right, bottom } = roomOutsideBounds(room);
  if (side === "north") {
    return {
      side,
      orientation: "horizontal",
      faceWorld: top,
      exteriorToward: -1,
      // Dimension chain along X uses room exterior X, not wall-parameter (south reverses).
      worldAlongFromParam: (along) => left + along,
      paramFromWorldAlong: (x) => x - left,
    };
  }
  if (side === "south") {
    return {
      side,
      orientation: "horizontal",
      faceWorld: bottom,
      exteriorToward: 1,
      // South wall param 0 is at right; world X decreases as param increases.
      worldAlongFromParam: (along) => right - along,
      paramFromWorldAlong: (x) => right - x,
    };
  }
  if (side === "west") {
    return {
      side,
      orientation: "vertical",
      faceWorld: left,
      exteriorToward: -1,
      // West wall runs bottom → top.
      worldAlongFromParam: (along) => bottom - along,
      paramFromWorldAlong: (y) => bottom - y,
    };
  }
  return {
    side: "east",
    orientation: "vertical",
    faceWorld: right,
    exteriorToward: 1,
    // East wall runs top → bottom.
    worldAlongFromParam: (along) => top + along,
    paramFromWorldAlong: (y) => y - top,
  };
}
