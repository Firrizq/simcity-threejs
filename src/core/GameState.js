/**
 * @file GameState.js
 * @description Manages a 1D Flat Array for the 2D city grid and procedural RCI simulation ticks.
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
   * Places a zone in the 1D flat grid array at (x, z), initialized at Tier 0 (empty zoned plot).
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
    this.grid[index] = {
      type,
      tier: 0,
      x,
      z,
      createdAt: Date.now(),
    };
    return true;
  }

  /**
   * Removes a zone/building from the 1D flat grid array at (x, z).
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
    return true;
  }

  /**
   * Runs one simulation tick over the entire 1D grid array.
   * Any zoned cell with tier < 3 has a 10% probability to evolve to the next tier.
   * @returns {number[]} Array of `gridIndex` numbers that changed tiers during this tick
   */
  simulateStep() {
    const updatedIndices = [];
    const totalCells = this.grid.length;

    for (let i = 0; i < totalCells; i++) {
      const cell = this.grid[i];
      if (cell !== null && cell.tier < 3) {
        if (Math.random() < 0.1) {
          cell.tier += 1;
          updatedIndices.push(i);
        }
      }
    }

    return updatedIndices;
  }
}
