/**
 * @file PathfindingWorker.js
 * @description Dedicated Web Worker for A* (A-Star) pathfinding over the 1D road grid.
 * Strictly zero DOM or Three.js dependencies — operates purely on grid indices and coordinates.
 */

let gridSize = 100;
/**
 * 1D Uint8Array where 1 = navigable road node, 0 = non-road
 * @type {Uint8Array}
 */
let roadGraph = new Uint8Array(gridSize * gridSize);

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
 * Rebuilds the local navigable road graph from the main thread's 1D grid array.
 * @param {Array<object|null>|Uint8Array} gridData
 * @param {number} [dimensions=100]
 */
function updateGraph(gridData, dimensions = 100) {
  gridSize = dimensions;
  const total = gridSize * gridSize;

  if (roadGraph.length !== total) {
    roadGraph = new Uint8Array(total);
  } else {
    roadGraph.fill(0);
  }

  if (!gridData) return;

  for (let i = 0; i < total; i++) {
    const cell = gridData[i];
    if (cell && (cell === 1 || cell.type === 'road')) {
      roadGraph[i] = 1;
    }
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
 * Standard A* (A-Star) shortest path algorithm over navigable road tiles.
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

  // Both start and target must be navigable road tiles
  if (roadGraph[startIndex] === 0 || roadGraph[targetIndex] === 0) {
    return [];
  }

  if (startIndex === targetIndex) {
    return [{ x: startX, z: startZ }];
  }

  const totalCells = gridSize * gridSize;
  const closedSet = new Uint8Array(totalCells);
  const inOpenSet = new Uint8Array(totalCells);
  const cameFrom = new Int32Array(totalCells).fill(-1);
  const gScore = new Float32Array(totalCells).fill(Infinity);
  const fScore = new Float32Array(totalCells).fill(Infinity);

  const openList = [startIndex];
  inOpenSet[startIndex] = 1;
  gScore[startIndex] = 0;
  fScore[startIndex] = heuristic(startX, startZ, targetX, targetZ);

  // 4 cardinal directions: North, East, South, West
  const dirX = [0, 1, 0, -1];
  const dirZ = [-1, 0, 1, 0];

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
      const nx = currX + dirX[d];
      const nz = currZ + dirZ[d];

      if (!isValid(nx, nz)) continue;

      const neighborIndex = toIndex(nx, nz);

      // Must be a road tile and not yet evaluated
      if (roadGraph[neighborIndex] === 0 || closedSet[neighborIndex] === 1) {
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
 * - UPDATE_GRAPH: { type: 'UPDATE_GRAPH', grid, dimensions }
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
