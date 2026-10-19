/**
 * @file PathfindingWorker.js
 * @description Dedicated Web Worker for A* (A-Star) pathfinding over a lightweight Uint8Array road graph.
 * Strictly zero DOM or Three.js dependencies — operates purely on raw TypedArrays, grid indices, and coordinates.
 * Pre-allocates A* working buffers to eliminate per-search garbage collection spikes.
 */

let gridSize = 100;
let totalCells = gridSize * gridSize;

/**
 * 1D Uint8Array where `1` = navigable road node, `0` = obstacle / empty.
 * @type {Uint8Array}
 */
let roadGraph = new Uint8Array(totalCells);

// Pre-allocated A* scratch buffers (reused across every FIND_PATH call for zero GC overhead)
let closedSet = new Uint8Array(totalCells);
let inOpenSet = new Uint8Array(totalCells);
let cameFrom = new Int32Array(totalCells);
let gScore = new Float32Array(totalCells);
let fScore = new Float32Array(totalCells);

// 4 cardinal directions: North, East, South, West
const DIR_X = [0, 1, 0, -1];
const DIR_Z = [-1, 0, 1, 0];

/**
 * Ensures pre-allocated A* working buffers match the current grid dimensions.
 * @param {number} newTotal
 */
function ensureBuffersCapacity(newTotal) {
  if (closedSet.length !== newTotal) {
    closedSet = new Uint8Array(newTotal);
    inOpenSet = new Uint8Array(newTotal);
    cameFrom = new Int32Array(newTotal);
    gScore = new Float32Array(newTotal);
    fScore = new Float32Array(newTotal);
  }
}

/**
 * Converts 2D (x, z) coordinates to a 1D index.
 * @param {number} x
 * @param {number} z
 * @returns {number}
 */
function toIndex(x, z) {
  return z * gridSize + x;
}

/**
 * Checks if (x, z) is within the grid bounds.
 * @param {number} x
 * @param {number} z
 * @returns {boolean}
 */
function isValid(x, z) {
  return x >= 0 && x < gridSize && z >= 0 && z < gridSize;
}

/**
 * Updates the local `Uint8Array` navigable road graph from the main thread's lightweight payload.
 * @param {Uint8Array | ArrayLike<number>} uint8Grid
 * @param {number} [dimensions=100]
 */
function updateGraph(uint8Grid, dimensions = 100) {
  gridSize = dimensions;
  totalCells = gridSize * gridSize;
  ensureBuffersCapacity(totalCells);

  if (uint8Grid instanceof Uint8Array && uint8Grid.length === totalCells) {
    // Adopt transferred Uint8Array directly without extra copy
    roadGraph = uint8Grid;
    return;
  }

  if (roadGraph.length !== totalCells) {
    roadGraph = new Uint8Array(totalCells);
  } else {
    roadGraph.fill(0);
  }

  if (!uint8Grid) return;

  for (let i = 0; i < totalCells; i++) {
    roadGraph[i] = uint8Grid[i] === 1 ? 1 : 0;
  }
}

/**
 * Manhattan distance heuristic for 4-way cardinal grid movement.
 * @param {number} x1
 * @param {number} z1
 * @param {number} x2
 * @param {number} z2
 * @returns {number}
 */
function heuristic(x1, z1, x2, z2) {
  return Math.abs(x1 - x2) + Math.abs(z1 - z2);
}

/**
 * Standard A* (A-Star) shortest path algorithm reading directly from the `Uint8Array` roadGraph.
 * Returns an array of `{ x, z }` grid coordinates from `start` to `target` (inclusive),
 * or an empty array if no valid road path exists.
 *
 * @param {{ x: number, z: number }} start
 * @param {{ x: number, z: number }} target
 * @returns {Array<{ x: number, z: number }>}
 */
function findPathAStar(start, target) {
  if (!start || !target) return [];

  const startX = start.x;
  const startZ = start.z;
  const targetX = target.x;
  const targetZ = target.z;

  if (!isValid(startX, startZ) || !isValid(targetX, targetZ)) {
    return [];
  }

  const startIndex = toIndex(startX, startZ);
  const targetIndex = toIndex(targetX, targetZ);

  // Both start and target must be navigable road tiles (value === 1 in Uint8Array)
  if (roadGraph[startIndex] !== 1 || roadGraph[targetIndex] !== 1) {
    return [];
  }

  if (startIndex === targetIndex) {
    return [{ x: startX, z: startZ }];
  }

  // Reset pre-allocated scratch buffers in native C++/WASM speed
  closedSet.fill(0);
  inOpenSet.fill(0);
  cameFrom.fill(-1);
  gScore.fill(Infinity);
  fScore.fill(Infinity);

  const openList = [startIndex];
  inOpenSet[startIndex] = 1;
  gScore[startIndex] = 0;
  fScore[startIndex] = heuristic(startX, startZ, targetX, targetZ);

  while (openList.length > 0) {
    // Find node in openList with lowest fScore
    let bestOpenIdx = 0;
    let current = openList[0];
    let lowestF = fScore[current];

    for (let i = 1; i < openList.length; i++) {
      const candidate = openList[i];
      if (fScore[candidate] < lowestF) {
        lowestF = fScore[candidate];
        current = candidate;
        bestOpenIdx = i;
      }
    }

    // Reached destination -> reconstruct path
    if (current === targetIndex) {
      const path = [];
      let curr = current;
      while (curr !== -1) {
        const cx = curr % gridSize;
        const cz = Math.floor(curr / gridSize);
        path.push({ x: cx, z: cz });
        curr = cameFrom[curr];
      }
      path.reverse();
      return path;
    }

    // Remove current from openList using O(1) swap-and-pop
    const lastOpen = openList.pop();
    if (bestOpenIdx < openList.length) {
      openList[bestOpenIdx] = lastOpen;
    }
    inOpenSet[current] = 0;
    closedSet[current] = 1;

    const currX = current % gridSize;
    const currZ = Math.floor(current / gridSize);
    const currentG = gScore[current];

    // Explore 4 cardinal neighbors
    for (let d = 0; d < 4; d++) {
      const nx = currX + DIR_X[d];
      const nz = currZ + DIR_Z[d];

      if (!isValid(nx, nz)) continue;

      const neighborIndex = toIndex(nx, nz);

      // Must be a navigable road tile (1) and not yet in closedSet
      if (roadGraph[neighborIndex] !== 1 || closedSet[neighborIndex] === 1) {
        continue;
      }

      const tentativeG = currentG + 1;

      if (tentativeG < gScore[neighborIndex]) {
        cameFrom[neighborIndex] = current;
        gScore[neighborIndex] = tentativeG;
        fScore[neighborIndex] = tentativeG + heuristic(nx, nz, targetX, targetZ);

        if (inOpenSet[neighborIndex] === 0) {
          openList.push(neighborIndex);
          inOpenSet[neighborIndex] = 1;
        }
      }
    }
  }

  // No path found
  return [];
}

/**
 * Worker message handler supporting:
 * - UPDATE_GRAPH: { type: 'UPDATE_GRAPH', grid: Uint8Array, dimensions: number }
 * - FIND_PATH: { type: 'FIND_PATH', vehicleId, start: { x, z }, target: { x, z } }
 */
self.onmessage = function (event) {
  const data = event.data;
  if (!data || !data.type) return;

  if (data.type === 'UPDATE_GRAPH') {
    updateGraph(data.grid, data.dimensions || 100);
  } else if (data.type === 'FIND_PATH') {
    const path = findPathAStar(data.start, data.target);
    self.postMessage({
      type: 'PATH_RESULT',
      vehicleId: data.vehicleId,
      path,
    });
  }
};
