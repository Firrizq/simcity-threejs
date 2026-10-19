/**
 * @file UIManager.js
 * @description Manages the HTML/CSS Glassmorphic overlay toolbar.
 * Strictly decoupled from Three.js — communicates tool selection changes via callback.
 */

export class UIManager {
  /**
   * @param {(toolName: string) => void} [onToolSelect] - Callback invoked when the user selects a tool
   */
  constructor(onToolSelect = null) {
    this.onToolSelect = onToolSelect;
    this.currentTool = 'residential';

    this.toolbar = document.querySelector('.glass-toolbar');
    this.buttons = Array.from(document.querySelectorAll('.tool-btn[data-tool]'));

    // Bind handlers to `this`
    this._onButtonClick = this._onButtonClick.bind(this);
    this._stopPropagation = this._stopPropagation.bind(this);

    this._initEvents();
  }

  /**
   * Attaches click listeners to each tool button and shields the toolbar
   * from leaking mouse/pointer events into the underlying WebGL canvas or window.
   * @private
   */
  _initEvents() {
    if (this.toolbar) {
      // Prevent any clicks or drags on the toolbar from triggering canvas/window raycasting
      this.toolbar.addEventListener('mousedown', this._stopPropagation);
      this.toolbar.addEventListener('mouseup', this._stopPropagation);
      this.toolbar.addEventListener('pointerdown', this._stopPropagation);
      this.toolbar.addEventListener('pointerup', this._stopPropagation);
    }

    for (let i = 0; i < this.buttons.length; i++) {
      this.buttons[i].addEventListener('click', this._onButtonClick);
    }
  }

  /**
   * Stops DOM mouse/pointer events on the UI from propagating to window/canvas listeners.
   * @param {Event} event
   * @private
   */
  _stopPropagation(event) {
    event.stopPropagation();
  }

  /**
   * Handles clicks on tool buttons (`residential`, `road`, `bulldozer`).
   * @param {MouseEvent} event
   * @private
   */
  _onButtonClick(event) {
    event.stopPropagation();
    const button = event.currentTarget;
    if (!button || !button.dataset.tool) {
      return;
    }

    const selectedTool = button.dataset.tool;
    this.setActiveTool(selectedTool);
  }

  /**
   * Updates the active visual state on the DOM buttons and fires the registered callback.
   * @param {string} toolName - 'residential' | 'road' | 'bulldozer'
   */
  setActiveTool(toolName) {
    this.currentTool = toolName;

    for (let i = 0; i < this.buttons.length; i++) {
      const btn = this.buttons[i];
      const isMatch = btn.dataset.tool === toolName;
      btn.classList.toggle('active', isMatch);
      btn.setAttribute('aria-pressed', isMatch ? 'true' : 'false');
    }

    if (typeof this.onToolSelect === 'function') {
      this.onToolSelect(toolName);
    }
  }
}
