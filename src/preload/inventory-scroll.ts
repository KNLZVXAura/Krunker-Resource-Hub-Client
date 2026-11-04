// Keeps your place in "My Inventory" after a quicksell, listing or destroy.
//
// Krunker rebuilds the inventory from page one after those actions and its sentinel observer never fires again,
// so the list jumps to the top and stops loading more. This keeps the view where it was and refills the pages
// through the game's own loader. Ported from Kute 1.3.0 (https://github.com/NullDev/Kute, GPL-3.0, NullDev).

// measured: the list resets ~0.7 s after the popup's button, a slow server answers later
const RESET_AFTER_POPUP_MS = 5000;
const RESTORE_LIMIT_MS = 10000;
// no new page for this long: the inventory has no more
const PAGE_WAIT_MS = 1500;
// quicksell and destroy open a view stack overlay, listing a modal overlay
const POPUPS = '.view-stack-overlay, .modal-overlay';

interface Restore {
  scroller: HTMLElement;
  grid: HTMLElement;
  /** Every sentinel styled: the inventory's end removes it and the reset makes a new one. */
  sentinels: Set<HTMLElement>;
  top: number;
  /** Items before the reset. */
  count: number;
  until: number;
  pageTimer: number;
  /** The removed cards, shown over the grid until it is full again. */
  picture: HTMLElement;
}

function sentinelOf(grid: HTMLElement): HTMLElement | null {
  const next = grid.nextElementSibling;
  return next instanceof HTMLElement && next.matches('.market-grid-sentinel') ? next : null;
}

const nextFrame = (): Promise<void> => new Promise((resolve) => { requestAnimationFrame(() => resolve()); });

async function frames(count: number): Promise<void> {
  for (let frame = 0; frame < count; frame++) await nextFrame();
}

class InventoryScroll {
  private watched = new WeakSet<Element>();
  private popupClickAt = -Infinity;
  private lastTop = 0;
  private lastHeight = 0;
  private restore: Restore | null = null;
  private onWheel = (): void => this.finish(false);

  constructor() {
    document.addEventListener('scroll', (event) => this.onScroll(event), { capture: true, passive: true });
    document.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest(POPUPS)) this.popupClickAt = performance.now();
    }, { capture: true, passive: true });
  }

  private onScroll(event: Event): void {
    const scroller = event.target;
    if (!(scroller instanceof HTMLElement)) return;
    if (this.restore) {
      // every arriving page pulled the view up. scroll events run before the frame is drawn, so putting it back here never shows
      if (scroller === this.restore.scroller && scroller.scrollTop !== this.restore.top) scroller.scrollTop = this.restore.top;
      return;
    }
    const grid = scroller.querySelector(':scope > .market-grid');
    if (!(grid instanceof HTMLElement)) return;
    this.watch(scroller, grid);
    this.lastTop = scroller.scrollTop;
    this.lastHeight = grid.offsetHeight;
  }

  private watch(scroller: HTMLElement, grid: HTMLElement): void {
    if (this.watched.has(grid)) return;
    this.watched.add(grid);
    let count = grid.children.length;
    // childList of the grid only, goes away with the grid
    new MutationObserver((records) => {
      const removed = records.reduce((sum, record) => sum + record.removedNodes.length, 0);
      const before = count;
      count = grid.children.length;
      if (this.restore?.grid === grid) {
        if (count > before) this.pageArrived();
        return;
      }
      const reset = before > 0 && removed >= before;
      if (reset && this.lastTop > scroller.clientHeight && performance.now() - this.popupClickAt < RESET_AFTER_POPUP_MS) {
        this.start(scroller, grid, before, records.flatMap((record) => [...record.removedNodes]));
      }
    }).observe(grid, { childList: true });
  }

  /** Runs in the mutation callback, before the browser lays out the emptied grid and clamps the scroll position. */
  private start(scroller: HTMLElement, grid: HTMLElement, count: number, removed: Node[]): void {
    // the pages come back one by one over ~150 ms, blank or half filled frames read as a jump
    const picture = document.createElement('div');
    picture.className = grid.className;
    picture.style.cssText = grid.style.cssText;
    picture.append(...removed);
    const restore: Restore = { scroller, grid, sentinels: new Set(), top: this.lastTop, count, until: performance.now() + RESTORE_LIMIT_MS, pageTimer: 0, picture };
    this.restore = restore;
    grid.style.minHeight = `${this.lastHeight}px`;
    // the held height stretched the few rows there are into huge gaps
    grid.style.alignContent = 'start';
    Object.assign(picture.style, {
      position: 'absolute',
      top: `${grid.offsetTop}px`,
      left: `${grid.offsetLeft}px`,
      width: `${grid.offsetWidth}px`,
      margin: '0',
      zIndex: '1',
      pointerEvents: 'none',
    });
    // the grid's sibling, so both measure from the same offset parent
    scroller.append(picture);
    scroller.style.overflowAnchor = 'none';
    scroller.scrollTop = this.lastTop;
    scroller.addEventListener('wheel', this.onWheel, { passive: true });
    this.waitForPage();
    this.blink(restore).catch((error) => console.error('[KRH] inventory scroll:', error));
  }

  private pageArrived(): void {
    const { restore } = this;
    if (!restore) return;
    // a quicksell or destroy leaves one item less
    if (restore.grid.children.length >= restore.count - 1 || performance.now() > restore.until) this.finish(true);
    else this.waitForPage();
  }

  private waitForPage(): void {
    const { restore } = this;
    if (!restore) return;
    clearTimeout(restore.pageTimer);
    restore.pageTimer = window.setTimeout(() => this.finish(true), PAGE_WAIT_MS);
  }

  private async blink(restore: Restore): Promise<void> {
    while (this.restore === restore) {
      // the end of the inventory removes the sentinel and the reset makes a new one, so it is looked up every time
      const sentinel = sentinelOf(restore.grid);
      if (sentinel) {
        // stuck to the bottom of the view the sentinel is always in it, every blink then asks for the next page
        restore.sentinels.add(sentinel);
        sentinel.style.position = 'sticky';
        sentinel.style.bottom = '0';
        sentinel.style.display = 'none';
        await frames(2);
        sentinel.style.display = '';
      }
      // the loader ignores the sentinel while the game is busy with the list call and then never hears of it again,
      // so it blinks until the pages are back. observers run after rAF, so the visible state needs two frames
      await frames(2);
    }
  }

  /** @param putBack false when the player scrolled meanwhile */
  private finish(putBack: boolean): void {
    const { restore } = this;
    if (!restore) return;
    this.restore = null;
    clearTimeout(restore.pageTimer);
    restore.scroller.removeEventListener('wheel', this.onWheel);
    restore.picture.remove();
    restore.grid.style.minHeight = '';
    restore.grid.style.alignContent = '';
    restore.scroller.style.overflowAnchor = '';
    for (const sentinel of restore.sentinels) {
      sentinel.style.position = '';
      sentinel.style.bottom = '';
      sentinel.style.display = '';
    }
    if (putBack) restore.scroller.scrollTop = restore.top;
    this.lastTop = restore.scroller.scrollTop;
    this.lastHeight = restore.grid.offsetHeight;
  }
}

let instance: InventoryScroll | null = null;

export function installInventoryScroll(): void {
  if (!instance) instance = new InventoryScroll();
}
