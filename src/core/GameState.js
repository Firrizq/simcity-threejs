/**
 * @file GameState.js
 * @description Manages a 1D Flat Array for the 2D city grid.
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
   * Places a zone/building in the 1D flat grid array at (x, z).
   * @param {number} x
   * @param {number} z
   * @param {string | object} [type='building']
   * @returns {boolean} True if placed, false if invalid or occupied
   */
  buildZone(x, z, type = 'building') {
    if (!this.canBuild(x, z)) {
      return false;
    }
    const index = this.getIndex(x, z);
    this.grid[index] = {
      type,
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
}
