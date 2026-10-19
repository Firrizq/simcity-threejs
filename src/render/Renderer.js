/**
 * @file Renderer.js
 * @description Manages Three.js Scene, PerspectiveCamera, WebGLRenderer, Lighting,
 * MapControls, Raycaster, Grid Snapping Cursor, Drag-to-Zone Overlay,
 * Phase 3 Procedural Evolution (RCI), Phase 4 Road Networks & Auto-Tiling (Bitmasking),
 * Phase 5 Web Worker A* Pathfinding, Phase 6 UI Integration, and
 * Phase 7 High-Res Offset CatmullRomCurve3 & Curve-Parameter (t) V2V Braking.
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

    // Tool & Drag state management (Phase 2, Phase 4, Phase 6)
    this.isDragging = false;
    this.dragStartGrid = { x: 0, z: 0 };
    this.dragEndGrid = { x: 0, z: 0 };
    this.currentTool = 'residential'; // 'residential' | 'road' | 'bulldozer'

    // Reusable objects for matrix composition and raycasting
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.dummyTransform = new THREE.Object3D();
    this._buildingColor = new THREE.Color();
    this._roadColor = new THREE.Color();
    this._lookAtTarget = new THREE.Vector3();

    // Phase 5 & Phase 7: Vehicle Agent tracking
    this.activeVehicles = [];
    this.maxVehicles = 100;
    this._nextVehicleId = 1;
    this._clock = new THREE.Clock();
    this._vehiclePalette = [
      0xfef08a, // Taxi Yellow
      0xf87171, // Sport Red
      0x38bdf8, // Electric Blue
      0x4ade80, // Mint Green
      0xfb923c, // Coupe Orange
      0xf8fafc, // Pearl White
      0xc084fc, // Violet Sedan
    ];

    // Track current snapped grid coordinates under the cursor
    this.hoveredGridCoords = null;

    // Bind event listeners and loops to `this`
    this.onWindowResize = this.onWindowResize.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onGameTick = this.onGameTick.bind(this);
    this.onWorkerMessage = this.onWorkerMessage.bind(this);
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

    // Instantiate core GameState and separate InstancedMesh managers for Buildings, Roads, and Vehicles
    this.gameState = new GameState(GRID_DIMENSIONS);
    this._initInstanceManagers();
    this._initPathfindingWorker();

    // Register DOM event listeners
    window.addEventListener('resize', this.onWindowResize);
    this.canvas.addEventListener('mousemove', this.onMouseMove);
    this.canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('keyup', this.onKeyUp);

    // Start Phase 3 Simulation Tick Loop (1 tick per second)
    this.tickInterval = setInterval(() => this.onGameTick(), 1000);

    // Start WebGL render loop
    this.animate();
  }

  /**
   * Sets the active tool ('residential' | 'road' | 'bulldozer') from UIManager callbacks.
   * @param {string} toolName
   */
  setTool(toolName) {
    this.currentTool = toolName;
    if (this.hoveredGridCoords) {
      const canBuild = this.gameState.canBuild(
        this.hoveredGridCoords.gridX,
        this.hoveredGridCoords.gridZ
      );
      this._updateToolFeedbackColors(canBuild);
    }
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
    this.gridHelper = new THREE.GridHelper(
      this.worldSize,
      GRID_DIMENSIONS,
      0x475569,
      0x1e293b
    );
    this.scene.add(this.gridHelper);

    const planeGeometry = new THREE.PlaneGeometry(this.worldSize, this.worldSize);
    planeGeometry.rotateX(-Math.PI / 2);

    const planeMaterial = new THREE.MeshBasicMaterial({
      visible: false,
    });

    this.groundPlane = new THREE.Mesh(planeGeometry, planeMaterial);
    this.scene.add(this.groundPlane);
  }

  /**
   * Initializes separate `InstanceManager` instances for:
   * 1. `this.buildingManager` (RCI buildings)
   * 2. `this.roadManager` (flat 1 x 0.05 x 1 road segments)
   * 3. `this.vehicleManager` (0.32 x 0.2 x 0.65 vehicle agents sized cleanly for dual lanes)
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
      color: 0xffffff,
    });

    this.roadManager = new InstanceManager(
      this.scene,
      MAX_BUILDINGS,
      roadGeometry,
      roadMaterial
    );

    // 3. Vehicle InstanceManager (0.32 width x 0.2 height x 0.65 length so opposing lanes never clip)
    const vehicleGeometry = new THREE.BoxGeometry(0.32, 0.2, 0.65);
    vehicleGeometry.translate(0, 0.1, 0);

    const vehicleMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.4,
      metalness: 0.2,
    });

    this.vehicleManager = new InstanceManager(
      this.scene,
      this.maxVehicles,
      vehicleGeometry,
      vehicleMaterial
    );
  }

  /**
   * Initializes the Phase 5 Web Worker using Vite's standard `new URL(..., import.meta.url)`
   * and synchronizes the initial road graph.
   * @private
   */
  _initPathfindingWorker() {
    this.pathWorker = new Worker(
      new URL('../workers/PathfindingWorker.js', import.meta.url),
      { type: 'module' }
    );
    this.pathfindingWorker = this.pathWorker;

    this.pathWorker.onmessage = this.onWorkerMessage;
    this._syncGraphWithWorker();
  }

  /**
   * Maps `this.gameState.grid` into a lightweight `Uint8Array` (`1` for road, `0` for obstacle/empty).
   * @returns {Uint8Array}
   * @private
   */
  _createNavigableRoadUint8Array() {
    return this.gameState.toNavigableUint8Array();
  }

  /**
   * Sends a single `UPDATE_GRAPH` message to `this.pathWorker` using a lightweight `Uint8Array`
   * rather than cloning the heavy `GameState.grid` object array.
   * @private
   */
  _syncGraphWithWorker() {
    if (!this.pathWorker) return;

    const roadUint8Array = this._createNavigableRoadUint8Array();
    this.pathWorker.postMessage(
      {
        type: 'UPDATE_GRAPH',
        grid: roadUint8Array,
        dimensions: GRID_DIMENSIONS,
      },
      [roadUint8Array.buffer]
    );
  }

  /**
   * Converts 2D `(gridX, gridZ)` coordinates to 3D world-space tile center `{ x, z }`.
   * @param {number} gridX
   * @param {number} gridZ
   * @returns {{ x: number, z: number }}
   * @private
   */
  _gridToWorld(gridX, gridZ) {
    return {
      x: gridX * GRID_SIZE - this.halfWorldSize + GRID_SIZE / 2,
      z: gridZ * GRID_SIZE - this.halfWorldSize + GRID_SIZE / 2,
    };
  }

  /**
   * Phase 7 Stable Lane Offset Curve:
   * 1. Creates a `CatmullRomCurve3` from the raw center coordinates FIRST.
   * 2. Samples evenly spaced points via `centerCurve.getSpacedPoints(rawGridPath.length * 2)`.
   * 3. Iterates through `centerPoints`, calculates the 2D tangent to the next point,
   *    computes the perpendicular normal `(-dz, dx)`, and applies the `0.25` offset.
   * 4. Creates the final `CatmullRomCurve3` from those offset points.
   *
   * @param {Array<{ x: number, z: number }>} rawGridPath
   * @returns {{ curve: THREE.CatmullRomCurve3, totalLength: number } | null}
   * @private
   */
  _buildLeftHandTrafficCurve(rawGridPath) {
    if (!rawGridPath || rawGridPath.length < 2) {
      return null;
    }

    // 1. Create a CatmullRomCurve3 from the raw center coordinates FIRST
    const rawCenterPoints = [];
    for (let i = 0; i < rawGridPath.length; i++) {
      const w = this._gridToWorld(rawGridPath[i].x, rawGridPath[i].z);
      rawCenterPoints.push(new THREE.Vector3(w.x, 0.05, w.z));
    }

    const centerCurve = new THREE.CatmullRomCurve3(rawCenterPoints);

    // 2. Sample evenly spaced points from this center curve
    const centerPoints = centerCurve.getSpacedPoints(rawGridPath.length * 2);

    // 3. Iterate through centerPoints, calculate 2D tangent to the next point, and apply (-dz, dx) * 0.25 offset
    const offsetPoints = [];
    let lastPx = 0;
    let lastPz = 0;

    for (let i = 0; i < centerPoints.length; i++) {
      const A = centerPoints[i].clone();

      if (i < centerPoints.length - 1) {
        const B = centerPoints[i + 1];

        let dx = B.x - A.x;
        let dz = B.z - A.z;
        const length = Math.hypot(dx, dz);

        if (length > 0.00001) {
          dx /= length;
          dz /= length;
        }

        const px = -dz;
        const pz = dx;

        lastPx = px;
        lastPz = pz;

        A.x += px * 0.25;
        A.z += pz * 0.25;
      } else {
        A.x += lastPx * 0.25;
        A.z += lastPz * 0.25;
      }

      offsetPoints.push(A);
    }

    // 4. Create the final CatmullRomCurve3 from these offset points
    const finalCurve = new THREE.CatmullRomCurve3(offsetPoints);
    const totalLength = Math.max(0.01, finalCurve.getLength());

    return { curve: finalCurve, totalLength };
  }

  /**
   * Collects all road tiles and all road tiles adjacent to zoned buildings
   * so vehicles can commute between buildings or along road networks.
   * @returns {{ allRoads: Array<{x: number, z: number}>, buildingAccessRoads: Array<{x: number, z: number}> }}
   * @private
   */
  _getNavigableRoadEndpoints() {
    const allRoads = [];
    const buildingAccessRoads = [];
    const grid = this.gameState.grid;
    const total = grid.length;

    for (let i = 0; i < total; i++) {
      const cell = grid[i];
      if (!cell) continue;

      if (cell.type === 'road') {
        allRoads.push({ x: cell.x, z: cell.z });
      } else {
        const neighbors = [
          { x: cell.x, z: cell.z - 1 },
          { x: cell.x + 1, z: cell.z },
          { x: cell.x, z: cell.z + 1 },
          { x: cell.x - 1, z: cell.z },
        ];
        for (let n = 0; n < neighbors.length; n++) {
          const nb = neighbors[n];
          const nbCell = this.gameState.getCell(nb.x, nb.z);
          if (nbCell && nbCell.type === 'road') {
            buildingAccessRoads.push({ x: nb.x, z: nb.z });
            break;
          }
        }
      }
    }

    return { allRoads, buildingAccessRoads };
  }

  /**
   * Requests a new A* route from `this.pathWorker` for a given vehicle.
   * @param {object} vehicle
   * @param {{ allRoads: Array<{x: number, z: number}>, buildingAccessRoads: Array<{x: number, z: number}> }} [cachedEndpoints]
   * @private
   */
  _requestNewPathForVehicle(vehicle, cachedEndpoints = null) {
    if (vehicle.waitingForPath) return;

    const endpoints = cachedEndpoints || this._getNavigableRoadEndpoints();
    const { allRoads, buildingAccessRoads } = endpoints;
    if (allRoads.length < 2) {
      return;
    }

    const candidatePool =
      buildingAccessRoads.length >= 2 ? buildingAccessRoads : allRoads;

    const startCoord = vehicle.currentGrid
      ? { x: vehicle.currentGrid.x, z: vehicle.currentGrid.z }
      : candidatePool[Math.floor(Math.random() * candidatePool.length)];

    const startCell = this.gameState.getCell(startCoord.x, startCoord.z);
    const validStart =
      startCell && startCell.type === 'road'
        ? startCoord
        : allRoads[Math.floor(Math.random() * allRoads.length)];

    let targetCoord =
      candidatePool[Math.floor(Math.random() * candidatePool.length)];
    for (let attempt = 0; attempt < 6; attempt++) {
      if (targetCoord.x !== validStart.x || targetCoord.z !== validStart.z) {
        break;
      }
      targetCoord = allRoads[Math.floor(Math.random() * allRoads.length)];
    }

    vehicle.waitingForPath = true;
    this.pathWorker.postMessage({
      type: 'FIND_PATH',
      vehicleId: vehicle.id,
      start: validStart,
      target: targetCoord,
    });
  }

  /**
   * Spawns vehicle agents proportional to the city's road/building network
   * and dispatches initial path requests to `this.pathWorker`.
   * @private
   */
  _manageVehiclePopulation() {
    const endpoints = this._getNavigableRoadEndpoints();
    const { allRoads } = endpoints;

    if (allRoads.length < 2) {
      if (this.activeVehicles.length > 0) {
        for (let i = 0; i < this.activeVehicles.length; i++) {
          this.vehicleManager.removeInstance(this.activeVehicles[i].id);
        }
        this.activeVehicles.length = 0;
      }
      return;
    }

    const desiredCount = Math.min(
      this.maxVehicles,
      Math.max(1, Math.floor(allRoads.length / 4))
    );

    if (this.activeVehicles.length < desiredCount) {
      const spawnRoad = allRoads[Math.floor(Math.random() * allRoads.length)];
      const worldPos = this._gridToWorld(spawnRoad.x, spawnRoad.z);
      const id = this._nextVehicleId++;
      const colorHex =
        this._vehiclePalette[id % this._vehiclePalette.length];

      const maxSpeed = 2.0 + Math.random() * 1.0;
      const dummy = new THREE.Object3D();
      dummy.position.set(worldPos.x, 0.05, worldPos.z);
      dummy.scale.set(1, 1, 1);
      dummy.lookAt(worldPos.x, 0.05, worldPos.z + 1);
      dummy.updateMatrix();

      const vehicle = {
        id,
        dummy,
        color: new THREE.Color(colorHex),
        currentGrid: { x: spawnRoad.x, z: spawnRoad.z },
        tangent: new THREE.Vector3(0, 0, 1),
        path: [],
        targetNodeString: '',
        curve: null,
        curveLength: 1,
        t: 0,
        maxSpeed,
        currentSpeed: maxSpeed,
        waitingForPath: false,
      };

      this.vehicleManager.addInstance(
        vehicle.id,
        vehicle.dummy.matrix,
        vehicle.color
      );
      this.activeVehicles.push(vehicle);

      this._requestNewPathForVehicle(vehicle, endpoints);
    }

    // Re-dispatch idle vehicles that finished or lost their curve
    for (let i = 0; i < this.activeVehicles.length; i++) {
      const v = this.activeVehicles[i];
      if (!v.waitingForPath && !v.curve) {
        this._requestNewPathForVehicle(v, endpoints);
      }
    }
  }

  /**
   * Receives `PATH_RESULT` messages from `PathfindingWorker.js`, builds the stable LHT offset
   * `THREE.CatmullRomCurve3` ONCE, and initializes `vehicle.t = 0`.
   * @param {MessageEvent} event
   */
  onWorkerMessage(event) {
    const data = event.data;
    if (!data || data.type !== 'PATH_RESULT') return;

    const vehicle = this.activeVehicles.find((v) => v.id === data.vehicleId);
    if (!vehicle) return;

    vehicle.waitingForPath = false;

    const curveData = this._buildLeftHandTrafficCurve(data.path);
    if (!curveData) {
      vehicle.path = [];
      vehicle.targetNodeString = '';
      vehicle.curve = null;
      vehicle.t = 0;
      const { allRoads } = this._getNavigableRoadEndpoints();
      if (allRoads.length > 0) {
        const randomRoad =
          allRoads[Math.floor(Math.random() * allRoads.length)];
        vehicle.currentGrid = { x: randomRoad.x, z: randomRoad.z };
        const worldPos = this._gridToWorld(randomRoad.x, randomRoad.z);
        vehicle.dummy.position.set(worldPos.x, 0.05, worldPos.z);
        vehicle.dummy.updateMatrix();
        this.vehicleManager.updateInstance(
          vehicle.id,
          vehicle.dummy.matrix,
          vehicle.color
        );
      }
      return;
    }

    vehicle.path = data.path;
    const lastNode = vehicle.path[vehicle.path.length - 1];
    vehicle.targetNodeString = lastNode.x + ',' + lastNode.z;
    vehicle.curve = curveData.curve;
    vehicle.curveLength = curveData.totalLength;
    vehicle.t = 0;
    vehicle.currentSpeed = vehicle.maxSpeed;

    const startNode = data.path[0];
    vehicle.currentGrid = { x: startNode.x, z: startNode.z };

    // Evaluate initial position and tangent at t = 0 along the offset CatmullRomCurve3
    vehicle.curve.getPointAt(0, vehicle.dummy.position);
    vehicle.curve.getTangentAt(0, vehicle.tangent);

    this._lookAtTarget.copy(vehicle.dummy.position).add(vehicle.tangent);
    vehicle.dummy.lookAt(this._lookAtTarget);
    vehicle.dummy.updateMatrix();

    this.vehicleManager.updateInstance(
      vehicle.id,
      vehicle.dummy.matrix,
      vehicle.color
    );
  }

  /**
   * Phase 7 Animation Loop for Vehicles (`requestAnimationFrame`):
   * 1. Curve Tangent + Distance Collision Detection:
   *    - `dist = v1.dummy.position.distanceTo(v2.dummy.position)`
   *    - If `dist < 1.2 && dist > 0.001`:
   *      - `dirToV2 = v2.dummy.position.clone().sub(v1.dummy.position).normalize()`
   *      - `forward = v1.tangent.clone().normalize()`
   *      - `dot = forward.dot(dirToV2)`
   *      - If `dot > 0.65`: `v1.currentSpeed = 0; shouldBrake = true; break;`
   * 2. Advances `v1.t` along `v1.curve` (`CatmullRomCurve3`) using `v1.currentSpeed`.
   * 3. Updates `v1.dummy.position` via `curve.getPointAt(t)` and orientation via `curve.getTangentAt(t)` + `lookAt`.
   * @param {number} dt - Frame delta time in seconds
   * @private
   */
  _updateVehicles(dt) {
    if (this.activeVehicles.length === 0) return;

    // Step 1: Curve Tangent + Physical Distance Collision Detection
    for (let i = 0; i < this.activeVehicles.length; i++) {
      const v1 = this.activeVehicles[i];
      if (!v1.curve) continue;

      let shouldBrake = false;
      const forward = v1.tangent.clone().normalize();

      for (let j = 0; j < this.activeVehicles.length; j++) {
        if (i === j) continue;

        const v2 = this.activeVehicles[j];
        if (!v2.curve) continue;

        const dist = v1.dummy.position.distanceTo(v2.dummy.position);
        if (dist < 1.2 && dist > 0.001) {
          const dirToV2 = v2.dummy.position
            .clone()
            .sub(v1.dummy.position)
            .normalize();
          const dot = forward.dot(dirToV2);

          if (dot > 0.65) {
            v1.currentSpeed = 0;
            shouldBrake = true;
            break;
          }
        }
      }

      if (!shouldBrake) {
        v1.currentSpeed = v1.maxSpeed;
      }
    }

    // Step 2: Advance vehicles along their high-res offset CatmullRomCurve3 and update InstancedMesh
    for (let i = 0; i < this.activeVehicles.length; i++) {
      const v1 = this.activeVehicles[i];
      if (!v1.curve) continue;

      if (v1.currentSpeed > 0) {
        const deltaT = (v1.currentSpeed * dt) / v1.curveLength;
        v1.t += deltaT;
      }

      if (v1.t >= 1.0) {
        v1.curve.getPointAt(1.0, v1.dummy.position);
        v1.curve.getTangentAt(1.0, v1.tangent);

        const lastNode = v1.path[v1.path.length - 1];
        if (lastNode) {
          v1.currentGrid = { x: lastNode.x, z: lastNode.z };
        }

        v1.curve = null;
        v1.path = [];
        v1.targetNodeString = '';
        v1.t = 0;

        this._requestNewPathForVehicle(v1);
      } else {
        v1.curve.getPointAt(v1.t, v1.dummy.position);
        v1.curve.getTangentAt(v1.t, v1.tangent);

        const approxIdx = Math.min(
          v1.path.length - 1,
          Math.floor(v1.t * (v1.path.length - 1))
        );
        const currentNode = v1.path[approxIdx];
        if (currentNode) {
          v1.currentGrid.x = currentNode.x;
          v1.currentGrid.z = currentNode.z;
        }
      }

      this._lookAtTarget.copy(v1.dummy.position).add(v1.tangent);
      v1.dummy.lookAt(this._lookAtTarget);
      v1.dummy.updateMatrix();

      this.vehicleManager.updateInstance(
        v1.id,
        v1.dummy.matrix,
        v1.color
      );
    }
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
   * @param {number} worldX
   * @param {number} worldZ
   * @param {number} tier
   * @private
   */
  _computeTierTransformAndColor(worldX, worldZ, tier) {
    let scaleY = 0.1;

    if (tier === 0) {
      scaleY = 0.1;
      this._buildingColor.setHSL(0.38, 0.45, 0.35);
    } else if (tier === 1) {
      scaleY = 1.0 + Math.random() * 0.5;
      this._buildingColor.setHSL(0.54, 0.55, 0.48);
    } else if (tier === 2) {
      scaleY = 2.0 + Math.random() * 1.0;
      this._buildingColor.setHSL(0.56, 0.72, 0.6);
    } else {
      scaleY = 4.0 + Math.random() * 2.0;
      this._buildingColor.setHSL(0.58, 0.85, 0.74);
    }

    this.dummyTransform.position.set(worldX, 0, worldZ);
    this.dummyTransform.rotation.set(0, 0, 0);
    this.dummyTransform.scale.set(1, scaleY, 1);
    this.dummyTransform.updateMatrix();
  }

  /**
   * Computes `this.dummyTransform` matrix and `this._roadColor` for a road tile at `(x, z)`
   * based on its 4-bit cardinal neighbor bitmask (0..15).
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

    const extendWest = hasWest ? 0.12 : 0;
    const extendEast = hasEast ? 0.12 : 0;
    const extendNorth = hasNorth ? 0.12 : 0;
    const extendSouth = hasSouth ? 0.12 : 0;

    const scaleX = 0.76 + extendWest + extendEast;
    const scaleZ = 0.76 + extendNorth + extendSouth;

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

    const connectionCount =
      (hasNorth ? 1 : 0) +
      (hasEast ? 1 : 0) +
      (hasSouth ? 1 : 0) +
      (hasWest ? 1 : 0);

    if (connectionCount >= 3) {
      this._roadColor.setHex(0x475569);
    } else if (connectionCount > 0) {
      this._roadColor.setHex(0x334155);
    } else {
      this._roadColor.setHex(0x1e293b);
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
   * Simulation Tick Handler (runs once per second):
   * 1. Evolves zoned RCI buildings and updates GPU instances
   * 2. Spawns / dispatches vehicle agents along the road network
   */
  onGameTick() {
    const updatedIndices = this.gameState.simulateStep();
    for (let i = 0; i < updatedIndices.length; i++) {
      const gridIndex = updatedIndices[i];
      const cell = this.gameState.grid[gridIndex];
      if (!cell || cell.type === 'road') {
        continue;
      }

      const gridX = gridIndex % GRID_DIMENSIONS;
      const gridZ = Math.floor(gridIndex / GRID_DIMENSIONS);

      const worldX = gridX * GRID_SIZE - this.halfWorldSize + GRID_SIZE / 2;
      const worldZ = gridZ * GRID_SIZE - this.halfWorldSize + GRID_SIZE / 2;

      this._computeTierTransformAndColor(worldX, worldZ, cell.tier);

      this.buildingManager.updateInstance(
        gridIndex,
        this.dummyTransform.matrix,
        this._buildingColor
      );
    }

    this._manageVehiclePopulation();
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

    const minWorldX = minX * GRID_SIZE - this.halfWorldSize + GRID_SIZE / 2;
    const maxWorldX = maxX * GRID_SIZE - this.halfWorldSize + GRID_SIZE / 2;
    const minWorldZ = minZ * GRID_SIZE - this.halfWorldSize + GRID_SIZE / 2;
    const maxWorldZ = maxZ * GRID_SIZE - this.halfWorldSize + GRID_SIZE / 2;

    const centerX = (minWorldX + maxWorldX) / 2;
    const centerZ = (minWorldZ + maxWorldZ) / 2;

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

    const gridX = Math.floor((point.x + this.halfWorldSize) / GRID_SIZE);
    const gridZ = Math.floor((point.z + this.halfWorldSize) / GRID_SIZE);

    if (!this.gameState.isValid(gridX, gridZ)) {
      return null;
    }

    const worldX = gridX * GRID_SIZE - this.halfWorldSize + GRID_SIZE / 2;
    const worldZ = gridZ * GRID_SIZE - this.halfWorldSize + GRID_SIZE / 2;

    return { gridX, gridZ, worldX, worldZ };
  }

  /**
   * Updates cursor and drag overlay colors to reflect the active tool.
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
   * ONLY when holding Shift + Left Click directly on the canvas.
   * @param {MouseEvent} event
   */
  onMouseDown(event) {
    if (event.target !== this.canvas || event.button !== 0 || !event.shiftKey) {
      return;
    }

    const snapped = this._getSnappedGridFromEvent(event);
    if (!snapped) {
      return;
    }

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

    this.hoveredGridCoords = snapped;
    this.cursorIndicator.position.set(snapped.worldX, 0.01, snapped.worldZ);
    this.cursorIndicator.visible = true;

    const canBuild = this.gameState.canBuild(snapped.gridX, snapped.gridZ);
    this._updateToolFeedbackColors(canBuild);

    if (this.isDragging) {
      this.dragEndGrid.x = snapped.gridX;
      this.dragEndGrid.z = snapped.gridZ;
      this._updateDragOverlayTransform(snapped.gridX, snapped.gridZ);
    }
  }

  /**
   * Finalizes the drag selection on mouse up, updates GameState and InstanceManagers,
   * and fires `UPDATE_GRAPH` strictly ONCE after the entire drag-to-zone loop finishes.
   * @param {MouseEvent} event
   */
  onMouseUp(event) {
    if (!this.isDragging) {
      return;
    }

    const snapped = this._getSnappedGridFromEvent(event);
    const finalX = snapped ? snapped.gridX : this.dragEndGrid.x;
    const finalZ = snapped ? snapped.gridZ : this.dragEndGrid.z;

    const minX = Math.min(this.dragStartGrid.x, finalX);
    const maxX = Math.max(this.dragStartGrid.x, finalX);
    const minZ = Math.min(this.dragStartGrid.z, finalZ);
    const maxZ = Math.max(this.dragStartGrid.z, finalZ);

    let roadGraphModified = false;

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
              this._updateRoadAndNeighbors(x, z);
              roadGraphModified = true;
            } else {
              this.buildingManager.removeInstance(gridIndex);
            }
          }
        } else if (this.currentTool === 'road') {
          if (this.gameState.canBuild(x, z)) {
            const built = this.gameState.buildZone(x, z, 'road');
            if (built) {
              this._updateRoadAndNeighbors(x, z);
              roadGraphModified = true;
            }
          }
        } else {
          // Default 'residential' zoning tool
          if (this.gameState.canBuild(x, z)) {
            const built = this.gameState.buildZone(x, z, this.currentTool);
            if (built) {
              const worldX = x * GRID_SIZE - this.halfWorldSize + GRID_SIZE / 2;
              const worldZ = z * GRID_SIZE - this.halfWorldSize + GRID_SIZE / 2;

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

    // Fire UPDATE_GRAPH strictly ONCE after the entire nested drag loop finishes
    if (roadGraphModified) {
      this._syncGraphWithWorker();
      this._manageVehiclePopulation();
    }

    // Reset drag state, hide overlay, and re-enable MapControls
    this.isDragging = false;
    this.dragOverlayMesh.visible = false;
    this.controls.enabled = true;

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
   * Main 60 FPS render & vehicle interpolation loop.
   */
  animate() {
    requestAnimationFrame(this.animate);

    const dt = Math.min(this._clock.getDelta(), 0.1);
    this._updateVehicles(dt);

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
