const { MarkdownView, Modal, Plugin } = require('obsidian');

class PaneZoomLevelsPlugin extends Plugin {
    async onload() {
        this.zoomLevels = new Map();
        this.zoomStep = 0.1;
        this.reapplyTimer = null;

        this.addCommand({
            id: 'set-pane-zoom',
            name: 'Set Custom Zoom Level for Current Pane',
            callback: async () => {
                const leaf = this.app.workspace.activeLeaf;
                if (!leaf) return;

                const currentZoom = this.zoomLevels.get(leaf.id)?.scale ?? 1;
                const input = await this.promptForZoom(currentZoom);
                if (input !== null) {
                    this.setZoomForPane(leaf, { scale: input / 100 });
                }
            }
        });

        this.addCommand({
            id: 'zoom-in',
            name: 'Zoom In',
            callback: () => this.incrementalZoom(true),
            hotkeys: [{ modifiers: ['Alt'], key: '=' }]
        });

        this.addCommand({
            id: 'zoom-out',
            name: 'Zoom Out',
            callback: () => this.incrementalZoom(false),
            hotkeys: [{ modifiers: ['Alt'], key: '-' }]
        });

        this.registerEvent(
            this.app.workspace.on('layout-change', () => this.reapplyZoomLevels())
        );

        this.registerEvent(
            this.app.workspace.on('file-open', () => this.reapplyZoomLevels())
        );

        this.registerEvent(
            this.app.workspace.on('active-leaf-change', (leaf) => {
                if (leaf) this.reapplyZoomForLeaf(leaf);
            })
        );

        this.observeLayoutMutations();
        this.app.workspace.onLayoutReady(() => this.reapplyZoomLevels());
    }

    observeLayoutMutations() {
        const workspaceEl = this.app.workspace.containerEl;
        if (!workspaceEl || typeof MutationObserver === 'undefined') return;

        const observer = new MutationObserver((mutations) => {
            let shouldReapply = false;
            const relevantSelector = '.markdown-reading-view, .markdown-preview-view, .markdown-source-view';

            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
                    const touchesMarkdownContainer = changedNodes.some((node) => {
                        if (!(node instanceof HTMLElement)) return false;
                        return node.matches(relevantSelector) || !!node.querySelector(relevantSelector);
                    });

                    if (touchesMarkdownContainer) {
                        shouldReapply = true;
                        break;
                    }
                }

                if (mutation.type === 'attributes' && mutation.target instanceof HTMLElement) {
                    const className = mutation.target.className;
                    if (
                        typeof className === 'string' &&
                        (
                            className.includes('markdown-reading-view') ||
                            className.includes('markdown-preview-view') ||
                            className.includes('markdown-source-view')
                        )
                    ) {
                        shouldReapply = true;
                        break;
                    }
                }
            }

            if (!shouldReapply) return;

            if (this.reapplyTimer !== null) {
                window.clearTimeout(this.reapplyTimer);
            }
            this.reapplyTimer = window.setTimeout(() => {
                this.reapplyTimer = null;
                this.reapplyZoomLevels();
            }, 50);
        });

        observer.observe(workspaceEl, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['class']
        });

        this.register(() => {
            if (this.reapplyTimer !== null) {
                window.clearTimeout(this.reapplyTimer);
                this.reapplyTimer = null;
            }
            observer.disconnect();
        });
    }

    async promptForZoom(currentZoom) {
        const input = await new Promise((resolve) => {
            const modal = new Modal(this.app);
            modal.contentEl.createEl('h2', { text: 'Set Zoom Level' });
            const inputEl = modal.contentEl.createEl('input', {
                type: 'number',
                value: Math.round(currentZoom * 100),
                placeholder: 'Enter zoom level (e.g., 150 for 150%)'
            });
            const buttonEl = modal.contentEl.createEl('button', { text: 'Set' });

            buttonEl.onclick = () => {
                modal.close();
                resolve(inputEl.value);
            };

            inputEl.addEventListener('keydown', (evt) => {
                if (evt.key === 'Enter') {
                    modal.close();
                    resolve(inputEl.value);
                }
            });

            modal.open();
            inputEl.focus();
            inputEl.select();
        });

        if (input === null || input === undefined || input === '') return null;
        const numericInput = parseFloat(input);
        return Number.isNaN(numericInput) ? null : Math.max(10, numericInput);
    }

    incrementalZoom(zoomIn) {
        const leaf = this.app.workspace.activeLeaf;
        if (!leaf) return;

        const currentZoom = this.zoomLevels.get(leaf.id)?.scale ?? 1;
        const newZoom = zoomIn ? currentZoom + this.zoomStep : currentZoom - this.zoomStep;
        this.setZoomForPane(leaf, { scale: Math.max(0.1, newZoom) });
    }

    setZoomForPane(leaf, zoomLevel) {
        if (!leaf) return;

        if (zoomLevel) {
            this.zoomLevels.set(leaf.id, zoomLevel);
        } else {
            this.zoomLevels.delete(leaf.id);
        }

        this.reapplyZoomForLeaf(leaf);
    }

    getZoomTargetForLeaf(leaf) {
        const contentEl = leaf?.view?.contentEl;
        if (!contentEl) return null;

        if (leaf.view instanceof MarkdownView) {
            if (leaf.view.getMode() === 'preview') {
                return (
                    contentEl.querySelector('.markdown-reading-view') ||
                    contentEl.querySelector('.markdown-preview-view')
                );
            }

            return (
                contentEl.querySelector('.markdown-source-view') ||
                contentEl.querySelector('.markdown-preview-view')
            );
        }

        return (
            contentEl.querySelector('.markdown-reading-view') ||
            contentEl.querySelector('.markdown-source-view') ||
            contentEl.querySelector('.markdown-preview-view')
        );
    }

    resetLeafZoom(contentEl) {
        const targets = contentEl.querySelectorAll(
            '.markdown-reading-view, .markdown-source-view, .markdown-preview-view'
        );

        targets.forEach((target) => {
            target.style.transform = '';
            target.style.transformOrigin = '';
            target.style.width = '';
            target.style.height = '';
        });
    }

    reapplyZoomForLeaf(leaf) {
        const contentEl = leaf?.view?.contentEl;
        if (!contentEl) return;

        this.resetLeafZoom(contentEl);

        const zoomLevel = this.zoomLevels.get(leaf.id);
        if (!zoomLevel) return;

        const target = this.getZoomTargetForLeaf(leaf);
        if (!target) return;

        target.style.transform = `scale(${zoomLevel.scale})`;
        target.style.transformOrigin = 'top left';
        target.style.width = `${100 / zoomLevel.scale}%`;
        target.style.height = `${100 / zoomLevel.scale}%`;
    }

    reapplyZoomLevels() {
        const existingLeafIds = new Set();

        this.app.workspace.iterateAllLeaves((leaf) => {
            existingLeafIds.add(leaf.id);
            if (this.zoomLevels.has(leaf.id)) {
                this.reapplyZoomForLeaf(leaf);
            }
        });

        for (const leafId of this.zoomLevels.keys()) {
            if (!existingLeafIds.has(leafId)) {
                this.zoomLevels.delete(leafId);
            }
        }
    }

    onunload() {
        if (this.reapplyTimer !== null) {
            window.clearTimeout(this.reapplyTimer);
            this.reapplyTimer = null;
        }

        this.app.workspace.iterateAllLeaves((leaf) => {
            const contentEl = leaf?.view?.contentEl;
            if (contentEl) this.resetLeafZoom(contentEl);
        });

        this.zoomLevels.clear();
    }
}

module.exports = PaneZoomLevelsPlugin;
