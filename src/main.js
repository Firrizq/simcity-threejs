/**
 * @file main.js
 * @description Entry point for Phase 1. Initializes the Renderer with #game-canvas.
 */

import { Renderer } from './render/Renderer.js';

const canvas = document.getElementById('game-canvas');
if (canvas) {
  new Renderer(canvas);
} else {
  console.error('Failed to find #game-canvas element in DOM.');
}
