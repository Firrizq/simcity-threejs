/**
 * @file main.js
 * @description Entry point for the City Builder simulation.
 * Connects the decoupled Glassmorphism UIManager to the Three.js Renderer.
 */

import { Renderer } from './render/Renderer.js';
import { UIManager } from './ui/UIManager.js';

const canvas = document.getElementById('game-canvas');

if (canvas) {
  const renderer = new Renderer(canvas);

  // Initialize UIManager and connect tool selection callbacks to Renderer
  new UIManager((selectedTool) => {
    renderer.setTool(selectedTool);
  });
} else {
  console.error('Failed to find #game-canvas element in DOM.');
}
