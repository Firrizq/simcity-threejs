/**
 * @file Renderer.js
 * @description Manages Three.js Scene, PerspectiveCamera, WebGLRenderer, Lighting,
 * MapControls, Raycaster, Grid Snapping Cursor, Drag-to-Zone Overlay,
 * Phase 3 Procedural Evolution (RCI), and Phase 4 Road Networks & Auto-Tiling (Bitmasking).
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

    // Tool & Drag state management (Phase 2 & Phase 4)
    this.isDragging = false;
    this.dragStartGrid = { x: 0, z: 0 };
    this.dragEndGrid = { x: 0, z: 0 };
    this.currentTool = 'residential'; // 'residential' (Z) | 'road' (R) | 'bulldozer' (X)

    // Reusable objects for matrix composition and raycasting
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.dummyTransform = new THREE.Object3D();
    this._buildingColor = new THREE.Color();
    this._roadColor = new THREE.Color();

    // Track current snapped grid coordinates under the cursor
    this.hoveredGridCoords = null;

    // Bind event listeners and loops to `this`
    this.onWindowResize = this.onWindowResize.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onGameTick = this.onGameTick.bind(this);
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

    // Instantiate core GameState and separate InstancedMesh managers for Buildings and Roads
    this.gameState = new GameState(GRID_DIMENSIONS);
    this._initInstanceManagers();

    // Register DOM event listeners
    window.addEventListener('resize', this.onWindowResize);
    this.canvas.addEventListener('mousemove', this.onMouseMove);
    this.canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);

    // Start Phase 3 Simulation Tick Loop (1 tick per second)
    this.tickInterval = setInterval(() => this.onGameTick(), 1000);

    // Start WebGL render loop
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
   * Configures MapControls with standard camera panning (left drag) and rotation (right drag).
   * When Shift + Left-Click is used for zoning/roads/bulldozing, `this.controls.enabled` is locked to `false`.
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
   * Initializes `this.buildingManager` (for RCI buildings) and `this.roadManager`
   * (flat THREE.BoxGeometry(GRID_SIZE, 0.05, GRID_SIZE) + dark gray THREE.MeshLambertMaterial).
   * @private
   */
  _initInstanceManagers() {
    // 1. Building InstanceManager
    this.buildingManager = new InstanceManager(this.scene, MAX_BUILDINGS);
    this.instanceManager = this.buildingManager;

    // 2. Road InstanceManager (flat BoxGeometry + dark gray MeshLambertMaterial)
    const roadHeight = 0.05;
    const roadGeometry = new THREE.BoxGeometry(GRID_SIZE, roadHeight, GRID_SIZE);
    roadGeometry.translate(0, roadHeight / 2, 0);

    const roadMaterial = new THREE.MeshLambertMaterial({
      color: 0xffffff, // Base white so per-instance dark-gray asphalt colors tint accurately
    });

    this.roadManager = new InstanceManager(
      this.scene,
      MAX_BUILDINGS,
      roadGeometry,
      roadMaterial
    );
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
      color: 0x22c55e,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });

    this.cursorIndicator = new THREE.Mesh(cursorGeometry, this.cursorMaterial);
    this.cursorIndicator.visible = false;
    this.scene.add(this.cursorIndicator);
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
   * Computes `this.dummyTransform` matrix and `this._buildingColor` for a given
   * world position and building tier (0..3).
   *
   * - Tier 0 (Zoned/Empty): Scale Y = 0.1
   * - Tier 1 (Small): Scale Y = 1.0 + Math.random() * 0.5
   * - Tier 2 (Medium): Scale Y = 2.0 + Math.random() * 1.0
   * - Tier 3 (High-density): Scale Y = 4.0 + Math.random() * 2.0
   *
   * @param {number} worldX
   * @param {number} worldZ
   * @param {number} tier
   * @private
   */
  _computeTierTransformAndColor(worldX, worldZ, tier) {
    let scaleY = 0.1;

    if (tier === 0) {
      scaleY = 0.1;
      // Tier 0: Muted green zoned plot pad
      this._buildingColor.setHSL(0.38, 0.45, 0.35);
    } else if (tier === 1) {
      scaleY = 1.0 + Math.random() * 0.5;
      // Tier 1: Low-density residential (soft teal-blue)
      this._buildingColor.setHSL(0.54, 0.55, 0.48);
    } else if (tier === 2) {
      scaleY = 2.0 + Math.random() * 1.0;
      // Tier 2: Medium-density (more saturated & brighter sky-cyan)
      this._buildingColor.setHSL(0.56, 0.72, 0.6);
    } else {
      scaleY = 4.0 + Math.random() * 2.0;
      // Tier 3: High-density skyscraper (vibrant, bright sunlit tower)
      this._buildingColor.setHSL(0.58, 0.85, 0.74);
    }

    this.dummyTransform.position.set(worldX, 0, worldZ);
    this.dummyTransform.rotation.set(0, 0, 0);
    this.dummyTransform.scale.set(1, scaleY, 1);
    this.dummyTransform.updateMatrix();
  }

  /**
   * Computes `this.dummyTransform` matrix and `this._roadColor` for a road tile at `(x, z)`
   * based on its 4-bit cardinal neighbor bitmask (0..15):
   * - North (z - 1) = 1
   * - East  (x + 1) = 2
   * - South (z + 1) = 4
   * - West  (x - 1) = 8
   *
   * Uses the bitmask to adjust the road's X/Z scale and center offset so connected roads
   * visually link flush across tile edges while keeping curb margins on unconnected sides.
   *
   * @param {number} x
   * @param {number} z
   * @param {number} bitmask - 0 to 15
   * @private
   */
  _computeRoadTransformAndColor(x, z, bitmask) {
    const baseWorldX = x * GRID_SIZE - this.halfWorldSize + GRID_SIZE / 2;
    const baseWorldZ = z * GRID_SIZE - this.halfWorldSize + GRID_SIZE / 2;

    const hasNorth = (bitmask & 1) !== 0;
    const hasEast = (bitmask & 2) !== 0;
    const hasSouth = (bitmask & 4) !== 0;
    const hasWest = (bitmask & 8) !== 0;

    // Base road width is 0.76 of a tile; each connected side extends by 0.12 to reach the tile boundary (1.0)
    const extendWest = hasWest ? 0.12 : 0;
    const extendEast = hasEast ? 0.12 : 0;
    const extendNorth = hasNorth ? 0.12 : 0;
    const extendSouth = hasSouth ? 0.12 : 0;

    const scaleX = 0.76 + extendWest + extendEast;
    const scaleZ = 0.76 + extendNorth + extendSouth;

    // Shift center slightly when only one side along an axis is connected so the road meets that neighbor edge
    const offsetX = ((extendEast - extendWest) / 2) * GRID_SIZE;
    const offsetZ = ((extendSouth - extendNorth) / 2) * GRID_SIZE;

    this.dummyTransform.position.set(
      baseWorldX + offsetX,
      0,
      baseWorldZ + offsetZ
    );
    this.dummyTransform.rotation.set(0, 0, 0);
    this.dummyTransform.scale.set(scaleX, 1, scaleZ);
    this.dummyTransform.updateMatrix();

    // Dark gray asphalt color with subtle variation for intersections (3+ connections)
    const connectionCount =
      (hasNorth ? 1 : 0) +
      (hasEast ? 1 : 0) +
      (hasSouth ? 1 : 0) +
      (hasWest ? 1 : 0);

    if (connectionCount >= 3) {
      this._roadColor.setHex(0x475569); // Intersection asphalt highlight
    } else if (connectionCount > 0) {
      this._roadColor.setHex(0x334155); // Connected road asphalt
    } else {
      this._roadColor.setHex(0x1e293b); // Isolated road segment
    }
  }

  /**
   * Recalculates the 4-bit road bitmask for `(x, z)` (if it is a road) and updates or adds
   * its visual representation in `this.roadManager`.
   * @param {number} x
   * @param {number} z
   * @private
   */
  _refreshRoadCellVisual(x, z) {
    if (!this.gameState.isValid(x, z)) {
      return;
    }

    const cell = this.gameState.getCell(x, z);
    if (!cell || cell.type !== 'road') {
      return;
    }

    const gridIndex = this.gameState.getIndex(x, z);
    const bitmask = this.gameState.getNeighbors(x, z, 'road');

    this._computeRoadTransformAndColor(x, z, bitmask);

    if (this.roadManager.gridIndexToInstanceId.has(gridIndex)) {
      this.roadManager.updateInstance(
        gridIndex,
        this.dummyTransform.matrix,
        this._roadColor
      );
    } else {
      this.roadManager.addInstance(
        gridIndex,
        this.dummyTransform.matrix,
        this._roadColor
      );
    }
  }

  /**
   * Updates the road bitmask and visual mesh for `(x, z)` AND its 4 cardinal neighbors.
   * Called whenever a road is placed or removed.
   * @param {number} x
   * @param {number} z
   * @private
   */
  _updateRoadAndNeighbors(x, z) {
    this._refreshRoadCellVisual(x, z);
    this._refreshRoadCellVisual(x, z - 1); // North
    this._refreshRoadCellVisual(x + 1, z); // East
    this._refreshRoadCellVisual(x, z + 1); // South
    this._refreshRoadCellVisual(x - 1, z); // West
  }

  /**
   * Phase 3 Simulation Tick Handler (runs once per second).
   * Queries GameState for evolved cell indices and updates only those instances on the GPU.
   */
  onGameTick() {
    const updatedIndices = this.gameState.simulateStep();
    if (updatedIndices.length === 0) {
      return;
    }

    for (let i = 0; i < updatedIndices.length; i++) {
      const gridIndex = updatedIndices[i];
      const cell = this.gameState.grid[gridIndex];
      if (!cell || cell.type === 'road') {
        continue;
      }

      // Mathematically reverse 1D gridIndex back to 2D (gridX, gridZ)
      const gridX = gridIndex % GRID_DIMENSIONS;
      const gridZ = Math.floor(gridIndex / GRID_DIMENSIONS);

      // Convert 2D grid coordinates to 3D World Coordinates
      const worldX = gridX * GRID_SIZE - this.halfWorldSize + GRID_SIZE / 2;
      const worldZ = gridZ * GRID_SIZE - this.halfWorldSize + GRID_SIZE / 2;

      // Update dummyTransform and color based on the cell's new tier
      this._computeTierTransformAndColor(worldX, worldZ, cell.tier);

      // Update the GPU instance in O(1) time
      this.buildingManager.updateInstance(
        gridIndex,
        this.dummyTransform.matrix,
        this._buildingColor
      );
    }
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
   * Updates cursor and drag overlay colors to reflect the active tool:
   * - 'residential': Green (0x22c55e) when buildable, Red (0xf87171) when occupied
   * - 'road': Amber/Blue (0x38bdf8) when buildable, Red (0xf87171) when occupied
   * - 'bulldozer': Red/Orange (0xef4444)
   * @param {boolean} canBuild
   * @private
   */
  _updateToolFeedbackColors(canBuild) {
    if (this.currentTool === 'bulldozer') {
      this.cursorMaterial.color.setHex(0xef4444);
      this.dragOverlayMaterial.color.setHex(0xef4444);
    } else if (this.currentTool === 'road') {
      this.cursorMaterial.color.setHex(canBuild ? 0x94a3b8 : 0xf87171);
      this.dragOverlayMaterial.color.setHex(0x94a3b8);
    } else {
      this.cursorMaterial.color.setHex(canBuild ? 0x22c55e : 0xf87171);
      this.dragOverlayMaterial.color.setHex(0x22c55e);
    }
  }

  /**
   * Starts a Drag-to-Zone / Drag-to-Road / Drag-to-Bulldoze operation
   * ONLY when holding Shift + Left Click.
   * @param {MouseEvent} event
   */
  onMouseDown(event) {
    if (event.button !== 0 || !event.shiftKey) {
      return;
    }

    const snapped = this._getSnappedGridFromEvent(event);
    if (!snapped) {
      return;
    }

    // Lock camera controls while drawing the zone/road
    this.controls.enabled = false;

    this.isDragging = true;
    this.dragStartGrid.x = snapped.gridX;
    this.dragStartGrid.z = snapped.gridZ;
    this.dragEndGrid.x = snapped.gridX;
    this.dragEndGrid.z = snapped.gridZ;

    const canBuild = this.gameState.canBuild(snapped.gridX, snapped.gridZ);
    this._updateToolFeedbackColors(canBuild);

    this._updateDragOverlayTransform(snapped.gridX, snapped.gridZ);
    this.dragOverlayMesh.visible = true;
  }

  /**
   * Updates the cursorIndicator (only visible when Shift is held or while dragging)
   * and updates the dragOverlayMesh bounding box while dragging.
   * @param {MouseEvent} event
   */
  onMouseMove(event) {
    // Only show cursorIndicator if holding Shift or actively dragging
    if (!event.shiftKey && !this.isDragging) {
      this.cursorIndicator.visible = false;
      return;
    }

    const snapped = this._getSnappedGridFromEvent(event);

    if (!snapped) {
      this.cursorIndicator.visible = false;
      this.hoveredGridCoords = null;
      return;
    }

    // 1. Update single cursorIndicator position and visibility
    this.hoveredGridCoords = snapped;
    this.cursorIndicator.position.set(snapped.worldX, 0.01, snapped.worldZ);
    this.cursorIndicator.visible = true;

    const canBuild = this.gameState.canBuild(snapped.gridX, snapped.gridZ);
    this._updateToolFeedbackColors(canBuild);

    // 2. If dragging, dynamically stretch and center dragOverlayMesh
    if (this.isDragging) {
      this.dragEndGrid.x = snapped.gridX;
      this.dragEndGrid.z = snapped.gridZ;
      this._updateDragOverlayTransform(snapped.gridX, snapped.gridZ);
    }
  }

  /**
   * Finalizes the drag selection on mouse up:
   * - 'residential': builds Tier 0 zone in `GameState` and `this.buildingManager`
   * - 'road': builds road in `GameState`, calculates 4-bit bitmasks for the road and its
   *   adjacent road neighbors, and updates `this.roadManager`
   * - 'bulldozer': checks cell's `type` before removing from `buildingManager` or `roadManager`,
   *   and recalculates adjacent road bitmasks if a road was demolished.
   * @param {MouseEvent} event
   */
  onMouseUp(event) {
    if (!this.isDragging) {
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

        if (this.currentTool === 'bulldozer') {
          const existingCell = this.gameState.getCell(x, z);
          if (!existingCell) {
            continue;
          }

          const removedType = existingCell.type;
          const removed = this.gameState.removeZone(x, z);
          if (removed) {
            if (removedType === 'road') {
              this.roadManager.removeInstance(gridIndex);
              // Recalculate bitmasks for the 4 adjacent road neighbors
              this._updateRoadAndNeighbors(x, z);
            } else {
              this.buildingManager.removeInstance(gridIndex);
            }
          }
        } else if (this.currentTool === 'road') {
          if (this.gameState.canBuild(x, z)) {
            const built = this.gameState.buildZone(x, z, 'road');
            if (built) {
              // Calculate bitmask for this road cell AND recalculate bitmasks for its adjacent road neighbors
              this._updateRoadAndNeighbors(x, z);
            }
          }
        } else {
          // Default 'residential' zoning tool
          if (this.gameState.canBuild(x, z)) {
            const built = this.gameState.buildZone(x, z, this.currentTool);
            if (built) {
              const worldX = x * GRID_SIZE - this.halfWorldSize + GRID_SIZE / 2;
              const worldZ = z * GRID_SIZE - this.halfWorldSize + GRID_SIZE / 2;

              // Register initially at Tier 0 (Scale Y = 0.1 flat ground plot)
              this._computeTierTransformAndColor(worldX, worldZ, 0);

              this.buildingManager.addInstance(
                gridIndex,
                this.dummyTransform.matrix,
                this._buildingColor
              );
            }
          }
        }
      }
    }

    // Reset drag state, hide overlay, and re-enable MapControls
    this.isDragging = false;
    this.dragOverlayMesh.visible = false;
    this.controls.enabled = true;

    // Hide cursor indicator if Shift was released before mouseup
    if (!event.shiftKey) {
      this.cursorIndicator.visible = false;
    } else if (this.hoveredGridCoords) {
      const canBuildNow = this.gameState.canBuild(
        this.hoveredGridCoords.gridX,
        this.hoveredGridCoords.gridZ
      );
      this._updateToolFeedbackColors(canBuildNow);
    }
  }

  /**
   * Handles keyboard shortcuts for tool switching:
   * - 'R' -> 'road'
   * - 'Z' -> 'residential'
   * - 'X' -> 'bulldozer'
   * @param {KeyboardEvent} event
   */
  onKeyDown(event) {
    const key = event.key.toUpperCase();

    if (key === 'R') {
      this.currentTool = 'road';
      console.log('[Tool Switched] Active Tool: road');
    } else if (key === 'Z') {
      this.currentTool = 'residential';
      console.log('[Tool Switched] Active Tool: residential');
    } else if (key === 'X') {
      this.currentTool = 'bulldozer';
      console.log('[Tool Switched] Active Tool: bulldozer');
    }

    // Refresh cursor indicator color immediately if hovering
    if (this.hoveredGridCoords && (event.shiftKey || this.isDragging)) {
      const canBuild = this.gameState.canBuild(
        this.hoveredGridCoords.gridX,
        this.hoveredGridCoords.gridZ
      );
      this._updateToolFeedbackColors(canBuild);
    }
  }

  /**
   * Hides the cursorIndicator immediately when the user releases the Shift key
   * (unless actively dragging a zone).
   * @param {KeyboardEvent} event
   */
  onKeyUp(event) {
    if (event.key === 'Shift' && !this.isDragging) {
      this.cursorIndicator.visible = false;
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
