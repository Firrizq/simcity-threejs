/**
 * @file Renderer.js
 * @description Manages Three.js Scene, PerspectiveCamera, WebGLRenderer, Lighting,
 * MapControls, Raycaster, Grid Snapping Cursor, Drag-to-Zone Overlay, and coordinates
 * GameState + InstanceManager.
 */

import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { GRID_SIZE, GRID_DIMENSIONS, MAX_BUILDINGS } from '../core/Config.js';
import { GameState } from '../core/GameState.js';
import { InstanceManager } from './InstanceManager.js';

export class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    if (!canvas) {
      throw new Error('Renderer requires a valid <canvas> element.');
    }
    this.canvas = canvas;

    // World dimensions derived from config
    this.worldSize = GRID_DIMENSIONS * GRID_SIZE;
    this.halfWorldSize = this.worldSize / 2;

    // Tool & Drag state management (Phase 2)
    this.isDragging = false;
    this.dragStartGrid = { x: 0, z: 0 };
    this.dragEndGrid = { x: 0, z: 0 };
    this.currentTool = 'build';

    // Reusable objects for matrix composition and raycasting
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this._dummy = new THREE.Object3D();
    this._buildingColor = new THREE.Color();

    // Track current snapped grid coordinates under the cursor
    this.hoveredGridCoords = null;

    // Bind event listeners and animation loop to `this`
    this.onWindowResize = this.onWindowResize.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
    this.animate = this.animate.bind(this);

    // Initialize subsystems
    this._initScene();
    this._initCamera();
    this._initWebGLRenderer();
    this._initLighting();
    this._initControls();
    this._initGridAndGround();
    this._initCursorIndicator();
    this._initDragOverlay();

    // Instantiate core GameState and InstancedMesh manager
    this.gameState = new GameState(GRID_DIMENSIONS);
    this.instanceManager = new InstanceManager(this.scene, MAX_BUILDINGS);

    // Register DOM event listeners
    window.addEventListener('resize', this.onWindowResize);
    this.canvas.addEventListener('mousemove', this.onMouseMove);
    this.canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);

    // Start render loop
    this.animate();
  }

  /**
   * @private
   */
  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x111827);
  }

  /**
   * @private
   */
  _initCamera() {
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
    this.camera.position.set(35, 40, 35);
    this.camera.lookAt(0, 0, 0);
  }

  /**
   * @private
   */
  _initWebGLRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }

  /**
   * @private
   */
  _initLighting() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(50, 80, 40);
    dirLight.castShadow = true;

    const shadowExtent = this.halfWorldSize;
    dirLight.shadow.camera.left = -shadowExtent;
    dirLight.shadow.camera.right = shadowExtent;
    dirLight.shadow.camera.top = shadowExtent;
    dirLight.shadow.camera.bottom = -shadowExtent;
    dirLight.shadow.camera.near = 1;
    dirLight.shadow.camera.far = 250;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;

    this.scene.add(dirLight);
  }

  /**
   * Configures MapControls:
   * - Left mouse button is freed for Drag-to-Zone selection on the grid.
   * - Right mouse drag orbits/rotates the camera; Middle mouse drag (or Shift+Right) pans.
   * @private
   */
  _initControls() {
    this.controls = new MapControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = false;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 200;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
    this.controls.mouseButtons = {
      LEFT: null,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  /**
   * Creates the visual grid helper and an invisible ground plane for raycasting.
   * @private
   */
  _initGridAndGround() {
    // Visual Grid Helper
    this.gridHelper = new THREE.GridHelper(
      this.worldSize,
      GRID_DIMENSIONS,
      0x475569,
      0x1e293b
    );
    this.scene.add(this.gridHelper);

    // Invisible ground plane for raycasting
    const planeGeometry = new THREE.PlaneGeometry(this.worldSize, this.worldSize);
    planeGeometry.rotateX(-Math.PI / 2);

    const planeMaterial = new THREE.MeshBasicMaterial({
      visible: false,
    });

    this.groundPlane = new THREE.Mesh(planeGeometry, planeMaterial);
    this.scene.add(this.groundPlane);
  }

  /**
   * Creates a transparent single-tile cursor indicator mesh that snaps to GRID_SIZE.
   * @private
   */
  _initCursorIndicator() {
    const cursorGeometry = new THREE.BoxGeometry(
      GRID_SIZE,
      GRID_SIZE * 0.2,
      GRID_SIZE
    );
    cursorGeometry.translate(0, (GRID_SIZE * 0.2) / 2, 0);

    this.cursorMaterial = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });

    this.cursorMesh = new THREE.Mesh(cursorGeometry, this.cursorMaterial);
    this.cursorMesh.visible = false;
    this.scene.add(this.cursorMesh);
  }

  /**
   * Creates the Phase 2 Drag-to-Zone visualizer mesh (height: 0.2, transparent green, opacity: 0.4).
   * @private
   */
  _initDragOverlay() {
    const overlayHeight = 0.2;
    const overlayGeometry = new THREE.BoxGeometry(
      GRID_SIZE,
      overlayHeight,
      GRID_SIZE
    );

    this.dragOverlayMaterial = new THREE.MeshBasicMaterial({
      color: 0x22c55e,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });

    this.dragOverlayMesh = new THREE.Mesh(
      overlayGeometry,
      this.dragOverlayMaterial
    );
    this.dragOverlayMesh.visible = false;
    this.scene.add(this.dragOverlayMesh);
  }

  /**
   * Updates the dragOverlayMesh position and scale to cover the bounding box
   * between `this.dragStartGrid` and `(endX, endZ)`.
   * @param {number} endX
   * @param {number} endZ
   * @private
   */
  _updateDragOverlayTransform(endX, endZ) {
    const minX = Math.min(this.dragStartGrid.x, endX);
    const maxX = Math.max(this.dragStartGrid.x, endX);
    const minZ = Math.min(this.dragStartGrid.z, endZ);
    const maxZ = Math.max(this.dragStartGrid.z, endZ);

    const spanX = maxX - minX + 1;
    const spanZ = maxZ - minZ + 1;

    // World-space center of the min tile and max tile
    const minWorldX = minX * GRID_SIZE - this.halfWorldSize + GRID_SIZE / 2;
    const maxWorldX = maxX * GRID_SIZE - this.halfWorldSize + GRID_SIZE / 2;
    const minWorldZ = minZ * GRID_SIZE - this.halfWorldSize + GRID_SIZE / 2;
    const maxWorldZ = maxZ * GRID_SIZE - this.halfWorldSize + GRID_SIZE / 2;

    const centerX = (minWorldX + maxWorldX) / 2;
    const centerZ = (minWorldZ + maxWorldZ) / 2;

    // Height is 0.2, so y = 0.1 places the bottom face flush with the ground (y = 0)
    this.dragOverlayMesh.position.set(centerX, 0.1, centerZ);
    this.dragOverlayMesh.scale.set(spanX, 1, spanZ);
  }

  /**
   * Raycasts from pointer screen position onto the invisible ground plane
   * and computes snapped world and 2D grid coordinates.
   * @param {MouseEvent} event
   * @returns {{ gridX: number, gridZ: number, worldX: number, worldZ: number } | null}
   * @private
   */
  _getSnappedGridFromEvent(event) {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return null;
    }

    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObject(this.groundPlane, false);

    if (intersects.length === 0) {
      return null;
    }

    const point = intersects[0].point;

    // Convert 3D world point to 2D grid coordinates [0, GRID_DIMENSIONS - 1]
    const gridX = Math.floor((point.x + this.halfWorldSize) / GRID_SIZE);
    const gridZ = Math.floor((point.z + this.halfWorldSize) / GRID_SIZE);

    if (!this.gameState.isValid(gridX, gridZ)) {
      return null;
    }

    // Snap back to exact tile center in 3D world space
    const worldX = gridX * GRID_SIZE - this.halfWorldSize + GRID_SIZE / 2;
    const worldZ = gridZ * GRID_SIZE - this.halfWorldSize + GRID_SIZE / 2;

    return { gridX, gridZ, worldX, worldZ };
  }

  /**
   * Starts a Drag-to-Zone operation on left mouse button down.
   * @param {MouseEvent} event
   */
  onMouseDown(event) {
    if (event.button !== 0) {
      return;
    }

    const snapped = this._getSnappedGridFromEvent(event);
    if (!snapped) {
      return;
    }

    this.isDragging = true;
    this.dragStartGrid.x = snapped.gridX;
    this.dragStartGrid.z = snapped.gridZ;
    this.dragEndGrid.x = snapped.gridX;
    this.dragEndGrid.z = snapped.gridZ;

    this._updateDragOverlayTransform(snapped.gridX, snapped.gridZ);
    this.dragOverlayMesh.visible = true;
  }

  /**
   * Updates the single cursor indicator and, when dragging, updates the dragOverlayMesh
   * bounding box position and scale.
   * @param {MouseEvent} event
   */
  onMouseMove(event) {
    const snapped = this._getSnappedGridFromEvent(event);

    if (!snapped) {
      this.cursorMesh.visible = false;
      this.hoveredGridCoords = null;
      return;
    }

    // 1. Keep single cursorIndicator logic active
    this.hoveredGridCoords = snapped;
    this.cursorMesh.position.set(snapped.worldX, 0.01, snapped.worldZ);
    this.cursorMesh.visible = true;

    const canBuild = this.gameState.canBuild(snapped.gridX, snapped.gridZ);
    this.cursorMaterial.color.setHex(canBuild ? 0x38bdf8 : 0xf87171);

    // 2. If dragging, dynamically stretch and center dragOverlayMesh
    if (this.isDragging) {
      this.dragEndGrid.x = snapped.gridX;
      this.dragEndGrid.z = snapped.gridZ;
      this._updateDragOverlayTransform(snapped.gridX, snapped.gridZ);
    }
  }

  /**
   * Finalizes the Drag-to-Zone selection on mouse up, iterating through the bounding box
   * and populating buildings in GameState and InstanceManager.
   * @param {MouseEvent} event
   */
  onMouseUp(event) {
    if (event.button !== 0 || !this.isDragging) {
      return;
    }

    // Use current mouse position if valid on the grid; otherwise fall back to last valid dragEndGrid
    const snapped = this._getSnappedGridFromEvent(event);
    const finalX = snapped ? snapped.gridX : this.dragEndGrid.x;
    const finalZ = snapped ? snapped.gridZ : this.dragEndGrid.z;

    const minX = Math.min(this.dragStartGrid.x, finalX);
    const maxX = Math.max(this.dragStartGrid.x, finalX);
    const minZ = Math.min(this.dragStartGrid.z, finalZ);
    const maxZ = Math.max(this.dragStartGrid.z, finalZ);

    // Nested loop covering every grid cell in the selected bounding box
    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
        if (!this.gameState.isValid(x, z)) {
          continue;
        }

        const gridIndex = this.gameState.getIndex(x, z);
        if (gridIndex === -1) {
          continue;
        }

        if (this.currentTool === 'demolish') {
          if (this.gameState.removeZone(x, z)) {
            this.instanceManager.removeInstance(gridIndex);
          }
        } else {
          // Default 'build' tool: check gameState.canBuild and place zone + instance
          if (this.gameState.canBuild(x, z)) {
            const built = this.gameState.buildZone(x, z, this.currentTool);
            if (built) {
              const worldX = x * GRID_SIZE - this.halfWorldSize + GRID_SIZE / 2;
              const worldZ = z * GRID_SIZE - this.halfWorldSize + GRID_SIZE / 2;

              this._dummy.position.set(worldX, 0, worldZ);
              this._dummy.rotation.set(0, 0, 0);
              this._dummy.scale.set(1, 1, 1);
              this._dummy.updateMatrix();

              this._buildingColor.setHSL(
                ((x * 13 + z * 29) % 360) / 360,
                0.65,
                0.6
              );
              this.instanceManager.addInstance(
                gridIndex,
                this._dummy.matrix,
                this._buildingColor
              );
            }
          }
        }
      }
    }

    // Reset drag state and hide overlay
    this.isDragging = false;
    this.dragOverlayMesh.visible = false;

    // Refresh cursor indicator color if still hovering over a valid tile
    if (this.hoveredGridCoords) {
      const canBuildNow = this.gameState.canBuild(
        this.hoveredGridCoords.gridX,
        this.hoveredGridCoords.gridZ
      );
      this.cursorMaterial.color.setHex(canBuildNow ? 0x38bdf8 : 0xf87171);
    }
  }

  /**
   * Handles viewport resizing.
   */
  onWindowResize() {
    const width = window.innerWidth;
    const height = Math.max(1, window.innerHeight);

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  /**
   * Main render loop.
   */
  animate() {
    requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
