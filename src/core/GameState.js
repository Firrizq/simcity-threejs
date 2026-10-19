/**
 * @file GameState.js
 * @description Manages a 1D Flat Array for the 2D city grid, procedural RCI simulation ticks,
 * 4-bit cardinal auto-tiling (bitmasking) for road networks, and O(1) Uint8Array
 * serialization for Web Worker IPC.
 * Strictly NO Three.js imports here.
 */

import { GRID_DIMENSIONS } from './Config.js';

export class GameState {
  /**
   * @param {number} [size=GRID_DIMENSIONS]
   */
  constructor(size = GRID_DIMENSIONS) {
    this.size = size;
    this.grid = new Array(size * size).fill(null);

    /**
     * Live O(1) flat Uint8Array mirror of navigable roads for fast IPC cloning.
     * 1 = navigable road, 0 = empty / obstacle.
     * @type {Uint8Array}
     */
    this._roadMaskBuffer = new Uint8Array(size * size);
  }

  /**
   * Checks if 2D grid coordinates (x, z) are within valid bounds [0, size - 1].
   * @param {number} x
   * @param {number} z
   * @returns {boolean}
   */
  isValid(x, z) {
    return (
      Number.isInteger(x) &&
      Number.isInteger(z) &&
      x >= 0 &&
      x < this.size &&
      z >= 0 &&
      z < this.size
    );
  }

  /**
   * Converts 2D grid coordinates (x, z) into a 1D flat array index.
   * Returns -1 if coordinates are out of bounds.
   * @param {number} x
   * @param {number} z
   * @returns {number}
   */
  getIndex(x, z) {
    if (!this.isValid(x, z)) {
      return -1;
    }
    return z * this.size + x;
  }

  /**
   * Converts a 1D flat array index back into 2D `{ x, z }` coordinates.
   * @param {number} index
   * @returns {{ x: number, z: number } | null}
   */
  getCoords(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.grid.length) {
      return null;
    }
    return {
      x: index % this.size,
      z: Math.floor(index / this.size),
    };
  }

  /**
   * Returns the cell object at (x, z), or null if out of bounds / empty.
   * @param {number} x
   * @param {number} z
   * @returns {object | null}
   */
  getCell(x, z) {
    const index = this.getIndex(x, z);
    if (index === -1) {
      return null;
    }
    return this.grid[index];
  }

  /**
   * Checks whether a tile is within bounds and currently empty (null).
   * @param {number} x
   * @param {number} z
   * @returns {boolean}
   */
  canBuild(x, z) {
    if (!this.isValid(x, z)) {
      return false;
    }
    const index = this.getIndex(x, z);
    return this.grid[index] === null;
  }

  /**
   * Places a zone or road in the 1D flat grid array at (x, z).
   * - If `type === 'road'`, initializes a road cell (no `tier`, ignored by RCI growth).
   * - Otherwise initializes a zone cell at `tier: 0`.
   * @param {number} x
   * @param {number} z
   * @param {string} [type='residential']
   * @returns {boolean} True if placed, false if invalid or occupied
   */
  buildZone(x, z, type = 'residential') {
    if (!this.canBuild(x, z)) {
      return false;
    }
    const index = this.getIndex(x, z);

    if (type === 'road') {
      this.grid[index] = {
        type: 'road',
        x,
        z,
        bitmask: 0,
        createdAt: Date.now(),
      };
      this._roadMaskBuffer[index] = 1;
    } else {
      this.grid[index] = {
        type,
        tier: 0,
        x,
        z,
        createdAt: Date.now(),
      };
      this._roadMaskBuffer[index] = 0;
    }

    return true;
  }

  /**
   * Removes a zone or road from the 1D flat grid array at (x, z).
   * @param {number} x
   * @param {number} z
   * @returns {boolean} True if removed, false if invalid or already empty
   */
  removeZone(x, z) {
    if (!this.isValid(x, z)) {
      return false;
    }
    const index = this.getIndex(x, z);
    if (this.grid[index] === null) {
      return false;
    }
    this.grid[index] = null;
    this._roadMaskBuffer[index] = 0;
    return true;
  }

  /**
   * Returns a lightweight `Uint8Array` snapshot (`1` = navigable road, `0` = obstacle/empty)
   * using native TypedArray copy (`slice()`) in O(1) native memory copy time.
   * @returns {Uint8Array}
   */
  toNavigableUint8Array() {
    return this._roadMaskBuffer.slice();
  }

  /**
   * Checks the 4 cardinal neighbors of (x, z) matching `type` and returns a 4-bit bitmask (0..15):
   * - North / Top (z - 1)   = 1
   * - East / Right (x + 1)  = 2
   * - South / Bottom (z + 1)= 4
   * - West / Left (x - 1)   = 8
   *
   * @param {number} x
   * @param {number} z
   * @param {string} [type='road']
   * @returns {number} Bitmask integer from 0 to 15
   */
  getNeighbors(x, z, type = 'road') {
    let mask = 0;

    // North / Top (z - 1) -> bit 1
    if (this.isValid(x, z - 1)) {
      const northCell = this.grid[this.getIndex(x, z - 1)];
      if (northCell !== null && northCell.type === type) {
        mask |= 1;
      }
    }

    // East / Right (x + 1) -> bit 2
    if (this.isValid(x + 1, z)) {
      const eastCell = this.grid[this.getIndex(x + 1, z)];
      if (eastCell !== null && eastCell.type === type) {
        mask |= 2;
      }
    }

    // South / Bottom (z + 1) -> bit 4
    if (this.isValid(x, z + 1)) {
      const southCell = this.grid[this.getIndex(x, z + 1)];
      if (southCell !== null && southCell.type === type) {
        mask |= 4;
      }
    }

    // West / Left (x - 1) -> bit 8
    if (this.isValid(x - 1, z)) {
      const westCell = this.grid[this.getIndex(x - 1, z)];
      if (westCell !== null && westCell.type === type) {
        mask |= 8;
      }
    }

    // Store updated bitmask on the cell if it matches `type`
    if (this.isValid(x, z)) {
      const centerCell = this.grid[this.getIndex(x, z)];
      if (centerCell !== null && centerCell.type === type) {
        centerCell.bitmask = mask;
      }
    }

    return mask;
  }

  /**
   * Runs one simulation tick over the entire 1D grid array.
   * Ignores roads (`cell.type === 'road'`). Any zoned RCI cell with tier < 3
   * has a 10% probability to evolve to the next tier.
   * @returns {number[]} Array of `gridIndex` numbers that changed tiers during this tick
   */
  simulateStep() {
    const updatedIndices = [];
    const totalCells = this.grid.length;

    for (let i = 0; i < totalCells; i++) {
      const cell = this.grid[i];
      if (
        cell !== null &&
        cell.type !== 'road' &&
        typeof cell.tier === 'number' &&
        cell.tier < 3
      ) {
        if (Math.random() < 0.1) {
          cell.tier += 1;
          updatedIndices.push(i);
        }
      }
    }

    return updatedIndices;
  }
}
