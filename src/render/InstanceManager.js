/**
 * @file InstanceManager.js
 * @description Wraps THREE.InstancedMesh and implements O(1) Swap-and-Pop
 * instance insertion, in-place tier updates, and removal using 2-way lookup maps.
 */

import * as THREE from 'three';
import { GRID_SIZE, MAX_BUILDINGS } from '../core/Config.js';

export class InstanceManager {
  /**
   * @param {THREE.Scene} scene
   * @param {number} [maxInstances=MAX_BUILDINGS]
   */
  constructor(scene, maxInstances = MAX_BUILDINGS) {
    this.scene = scene;
    this.maxInstances = maxInstances;
    this.count = 0;

    // 2-way O(1) binding maps for Swap-and-Pop
    this.gridIndexToInstanceId = new Map();
    this.instanceIdToGridIndex = new Map();

    // Scratch buffers for Swap-and-Pop matrix and color transfers (zero GC allocation)
    this._lastMatrix = new THREE.Matrix4();
    this._lastColor = new THREE.Color();
    this._tempColor = new THREE.Color();

    // Create unit cube geometry with pivot at the base (y = 0) so Y-scaling grows upward from the ground
    const cubeSize = GRID_SIZE * 0.9;
    this.geometry = new THREE.BoxGeometry(cubeSize, GRID_SIZE, cubeSize);
    this.geometry.translate(0, GRID_SIZE / 2, 0);

    this.material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.6,
      metalness: 0.1,
    });

    this.mesh = new THREE.InstancedMesh(
      this.geometry,
      this.material,
      this.maxInstances
    );
    // Keep alias for backward compatibility
    this.instancedMesh = this.mesh;

    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;

    // Initialize the instanceColor buffer upfront so setColorAt/getColorAt always work cleanly
    const defaultColor = new THREE.Color(0xffffff);
    for (let i = 0; i < this.maxInstances; i++) {
      this.mesh.setColorAt(i, defaultColor);
    }
    if (this.mesh.instanceColor) {
      this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }

    // Start with 0 rendered instances
    this.mesh.count = 0;
    this.scene.add(this.mesh);
  }

  /**
   * Adds a new building instance in O(1) time.
   * @param {number} gridIndex - 1D index from GameState
   * @param {THREE.Matrix4} matrix - World transform matrix for the instance
   * @param {THREE.Color | number | string} [color=0x38bdf8] - Color for the instance
   * @returns {boolean}
   */
  addInstance(gridIndex, matrix, color = 0x38bdf8) {
    if (
      this.gridIndexToInstanceId.has(gridIndex) ||
      this.count >= this.maxInstances
    ) {
      return false;
    }

    const instanceId = this.count;

    // Write transform matrix
    this.mesh.setMatrixAt(instanceId, matrix);

    // Write color
    if (color instanceof THREE.Color) {
      this._tempColor.copy(color);
    } else {
      this._tempColor.set(color);
    }
    this.mesh.setColorAt(instanceId, this._tempColor);

    // Record 2-way binding
    this.gridIndexToInstanceId.set(gridIndex, instanceId);
    this.instanceIdToGridIndex.set(instanceId, gridIndex);

    // Increment active instance count
    this.count++;
    this.mesh.count = this.count;

    // Flag GPU buffers for upload
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
    }

    return true;
  }

  /**
   * Updates an existing instance's matrix and color in O(1) time when a building evolves tiers.
   * @param {number} gridIndex - 1D index from GameState
   * @param {THREE.Matrix4} matrix - Updated world transform matrix
   * @param {THREE.Color | number | string} color - Updated color
   * @returns {boolean}
   */
  updateInstance(gridIndex, matrix, color) {
    const id = this.gridIndexToInstanceId.get(gridIndex);
    if (id === undefined) {
      return false;
    }

    this.mesh.setMatrixAt(id, matrix);

    if (color instanceof THREE.Color) {
      this._tempColor.copy(color);
    } else {
      this._tempColor.set(color);
    }
    this.mesh.setColorAt(id, this._tempColor);

    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
    }

    return true;
  }

  /**
   * Removes a building instance in O(1) time using the Swap-and-Pop algorithm.
   * Copies the last active instance into the removed instance's slot, updates the 2-way
   * binding maps, and decrements the active instance count.
   * @param {number} gridIndex - 1D index from GameState
   * @returns {boolean}
   */
  removeInstance(gridIndex) {
    if (!this.gridIndexToInstanceId.has(gridIndex) || this.count === 0) {
      return false;
    }

    const instanceIdToRemove = this.gridIndexToInstanceId.get(gridIndex);
    const lastInstanceId = this.count - 1;

    // If the removed instance is not already the last active element, swap with the last element
    if (instanceIdToRemove !== lastInstanceId) {
      const lastGridIndex = this.instanceIdToGridIndex.get(lastInstanceId);

      // Copy matrix from lastInstanceId -> instanceIdToRemove
      this.mesh.getMatrixAt(lastInstanceId, this._lastMatrix);
      this.mesh.setMatrixAt(instanceIdToRemove, this._lastMatrix);

      // Copy color from lastInstanceId -> instanceIdToRemove
      if (this.mesh.instanceColor) {
        this.mesh.getColorAt(lastInstanceId, this._lastColor);
        this.mesh.setColorAt(instanceIdToRemove, this._lastColor);
      }

      // Update 2-way binding maps for the swapped tail element
      this.gridIndexToInstanceId.set(lastGridIndex, instanceIdToRemove);
      this.instanceIdToGridIndex.set(instanceIdToRemove, lastGridIndex);
    }

    // Pop the removed element and clear the old tail entry
    this.gridIndexToInstanceId.delete(gridIndex);
    this.instanceIdToGridIndex.delete(lastInstanceId);

    this.count--;
    this.mesh.count = this.count;

    // Flag GPU buffers for upload
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
    }

    return true;
  }
}
