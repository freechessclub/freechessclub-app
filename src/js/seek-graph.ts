import type * as d3 from 'd3';
import { createContextMenu, isMobile } from './utils';
declare const d3: typeof import("d3");

// Seek data used by graph points
type DataItem = {
  id: number;
  initialTime: number;
  increment: number;
  rating: number;
  category: string;
  text: string;
};

/** Draw a seek graph for the lobby panel */
export class SeekGraph {
  private margin = { top: 5, right: 15, bottom: 35, left: 60 }; // Margins around the graph
  private pointSize = 150; // The size of each point
  private xTicks = [0, 3, 15, 30]; // Time categories (lightning, blitz, standard) on the x-axis
  private yTicks = [0, 750, 1000, 1250, 1500, 1750, 2000, 2250, 2500]; // Rating tick marks on the y-axis
  private container: HTMLElement; // The HTML element containing the graph
  private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>; // Main svg element
  private g: d3.Selection<SVGGElement, unknown, null, undefined>; // Main graph element
  private xScale: d3.ScaleLinear<number, number>; // Function for converting times to pixel coordinates
  private yScale: d3.ScaleLinear<number, number>; // Function for converting ratings to pixel coordinates
  private width: number; // Width of the graph, not including labels
  private height: number; // Height of the graph, not including labels
  private data: DataItem[] = []; // The seek data 
  // state
  private hoveredIds: Set<number> = new Set(); // Stores the data points currently being hovered, in order to determine when this changes
  private tooltipParent: HTMLElement; // The data-point element which is currently showing a tooltip
  private mouseX: number; // Mouse coordinates relative to g 
  private mouseY: number;
  private redraw: boolean = true; // Redraws the entire graph if this is true when update() is called. Always true the first time.

  // Draws the graph or re-scales it after the container is resized
  public update() {
    if(!$('#lobby-graph-container').is(':visible'))
      return;

    if(this.redraw) {
      this.redraw = false;
      this.draw(); // Clears and recreates the graph
    }
    else 
      this.render(); // Re-scales / repositions the graph elements
  }

  /** Create the graph */
  public draw() {
    const container = this.container = document.getElementById('lobby-graph-container');
    container.innerHTML = '';

    const svg = this.svg = d3.select(container).append('svg');
    const margin = this.margin;

    const g = this.g = svg.append('g')
      .attr('class', 'main-group')
      .attr('transform', `translate(${margin.left}, ${margin.top})`);

    // --- GROUPS ---
    g.append('g').attr('class', 'v-grid'); // Grid lines
    g.append('g').attr('class', 'h-grid');
    g.append('line').attr('class', 'seek-graph-guest-separator');
    g.append('g').attr('class', 'x-labels');
    g.append('g').attr('class', 'y-labels');
    g.append('rect') // Graph border
      .attr('class', 'seek-graph-border')
      .attr('fill', 'none');
    g.append('g').attr('class', 'points');

    g.select('.v-grid')
      .selectAll('line')
      .data(this.xTicks.slice(1, -1)) // time grid lines
      .join('line')
      .attr('class', 'seek-graph-grid-line')
      .attr('stroke-dasharray', '8,4');

    g.select('.h-grid')
      .selectAll('line')
      .data(this.yTicks.slice(2, -1)) // rating grid lines
      .join('line')
      .attr('class', 'seek-graph-grid-line')
      .attr('stroke-dasharray', '8,4');

    const xLabels = [
      { label: 'Lightning', x: (this.xTicks[0] + this.xTicks[1]) / 2 },
      { label: 'Blitz', x: (this.xTicks[1] + this.xTicks[2]) / 2 },
      { label: 'Standard', x: (this.xTicks[2] + this.xTicks[3]) / 2 }
    ];

    g.select('.x-labels')
      .selectAll('text')
      .data(xLabels)
      .join('text')
      .attr('class', 'seek-graph-label')
      .attr('text-anchor', 'middle')
      .text(d => d.label);

    const yLabels = [
      { label: 'Guest', y: (this.yTicks[1] - this.yTicks[0]) / 2 },
      ...this.yTicks.slice(2, -1).map(d => ({ label: String(d), y: d }))
    ];

    g.select('.y-labels')
      .selectAll('text')
      .data(yLabels)
      .join('text')
      .attr('class', 'seek-graph-label')
      .attr('x', -28)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .text(d => d.label);

    // On desktop diplay a tooltip when points are hovered
    if(!isMobile()) {
      svg.on('mousemove', (event) => {
        const [mx, my] = d3.pointer(event, g.node());
        this.mouseX = mx;
        this.mouseY = my;
        this.updateTooltip(mx, my);
      });
    }

    // Point clicked
    svg.on('click', (event) => {
      const [mx, my] = d3.pointer(event, g.node());
      this.selectPoints(mx, my, event.clientX, event.clientY);
    });

    // Scale graph elements
    this.render();
  }

  /**
   * Scales and positions graph elements
   */
  public render() {
    const container = this.container;
    const svg = this.svg;
    const g = this.g;
    const margin = this.margin;

    if(!container || !$(container).is(':visible'))
      return;

    const outerWidth = container.getBoundingClientRect().width;
    const outerHeight = container.getBoundingClientRect().height;

    const width = this.width = outerWidth - margin.left - margin.right;
    const height = this.height = outerHeight - margin.top - margin.bottom;

    svg
      .attr('width', outerWidth)
      .attr('height', outerHeight);

    // --- SCALES ---

    // x-axis scales, i.e. What percentagte of total graph width each time category takes up
    const xRanges = [0, 0.2, 0.6, 1].map(p => p * width);
    const xScale = this.xScale = d3.scaleLinear()
      .domain(this.xTicks)
      .range(xRanges);

    // y-axis scales, i.e. What percentagte of total graph height each rating range takes up
    const guestRangeSize = 27; // The guest area has a fixed pixel size
    let fixedYRanges = [0, guestRangeSize].map(p => height - p);
    const numRatingDomains = this.yTicks.length - 2;
    let variableYRanges = this.yTicks.slice(2).map((_, index) => (numRatingDomains - index - 1) * (1/numRatingDomains) * (height - guestRangeSize));    
    
    const yScale = this.yScale = d3.scaleLinear()
      .domain(this.yTicks)
      .range([...fixedYRanges, ...variableYRanges]);

    // --- VERTICAL GRID ---
    g.select('.v-grid')
      .selectAll('line')
      .attr('x1', d => xScale(d))
      .attr('x2', d => xScale(d))
      .attr('y1', 0)
      .attr('y2', height);

    // --- HORIZONTAL GRID ---
    g.select('.h-grid')
      .selectAll('line')
      .attr('x1', 0)
      .attr('x2', width)
      .attr('y1', d => yScale(d))
      .attr('y2', d => yScale(d));

    // --- GUEST SEPARATOR ---
    g.select('.seek-graph-guest-separator')
      .attr('x1', 0)
      .attr('x2', width)
      .attr('y1', yScale(this.yTicks[1]))
      .attr('y2', yScale(this.yTicks[1]));

    // --- LABELS ---
    g.select('.x-labels')
      .selectAll('text')
      .attr('x', d => xScale(d.x))
      .attr('y', height + 20)

    g.select('.y-labels')
      .selectAll('text')
      .attr('y', d => yScale(d.y))

    // --- BORDER ---
    g.select('.seek-graph-border')
      .attr('width', width)
      .attr('height', height);

    this.renderPoints();
  }

  // Render data points
  public renderPoints() {
    if(!this.container || !$(this.container).is(':visible'))
      return;

    const g = this.g;
    const xScale = this.xScale;
    const yScale = this.yScale;
    const radius = Math.sqrt(this.pointSize / Math.PI); // Approximate point radius used for hit testing
    const symbol = d3.symbol().size(this.pointSize); // Point symbol
    const ratingBottom = yScale(this.yTicks[1]) - radius; // The minimum rating a point can have

    g.select('.points')
      .selectAll('path')
      .data(this.data, d => d.id)
      .join('path')
      .attr('class', 'seek-graph-point')
      .classed('seek-graph-point-human-rated', d => d.title !== 'C' && d.ratedUnrated === 'r')
      .classed('seek-graph-point-human-unrated', d => d.title !== 'C' && d.ratedUnrated === 'u') 
      .classed('seek-graph-point-computer-rated', d => d.title === 'C' && d.ratedUnrated === 'r')
      .classed('seek-graph-point-computer-unrated', d => d.title === 'C' && d.ratedUnrated === 'u')
      .attr('transform', d => {
        const time = d.initialTime + d.increment * 2/3;
        // Calculate x-coordinate in pixels of data point ensuring it fits fully within the graph boundaries
        d.px = Math.max(Math.min(xScale(time), this.width - radius), radius);
        
        // Calculate y-coordinate in pixels of data point ensuring it fits fully within the graph boundaries
        let rating = parseInt(d.rating.match(/\d+/)?.[0] ?? '0', 10);
        if(rating === 0) { // Put guest seeks in the guest region
          rating = (this.yTicks[1] - this.yTicks[0]) / 2;
          d.py = yScale(rating);
        }
        else 
          d.py = Math.min(Math.max(yScale(rating), radius), ratingBottom);

        return `translate(${d.px}, ${d.py})`;
      })
      .attr('d', d => {
        d.radius = radius;
        let shape = d3.symbolCircle;
        const category = d.category;
        if(category === 'losers')
          shape = d3.symbolStar;
        else if(category === 'suicide')
          shape = d3.symbolTriangle;
        else if(category === 'crazyhouse')
          shape = d3.symbolDiamond;
        else if(category === 'atomic')
          shape = d3.symbolWye;
        else if(category.startsWith('wild'))
          shape = d3.symbolSquare;       
        return symbol.type(shape)();
      });
  }

  /**
   * Add seek item to graph
   */
  public addPoint(item: any) {
    this.data = this.data.filter(d => d.id !== item.id);
    this.data.push(item);
    this.renderPoints();
    if(this.tooltipParent) // Check if currently shown tooltip needs to be changed or removed
      this.updateTooltip(this.mouseX, this.mouseY);
  }

  public removePoint(id: number) {
    this.data = this.data.filter(d => d.id !== id);
    this.renderPoints();
    if(this.tooltipParent) 
      this.updateTooltip(this.mouseX, this.mouseY);
  }

  public removeAllPoints() {
    this.data = [];
    this.renderPoints();  
    if(this.tooltipParent) 
      this.updateTooltip(this.mouseX, this.mouseY);
  }

  /**
   * Get all point elements that are under the mouse cursor
   * @param mx mouse x coordinate relative to the main g element
   * @param my mouse y coordinate relative to the main g element
   * @returns Array of point elements
   */
  private getPointsUnderCursor(mx: number, my: number) {
    const nodes = this.g.select('.points')
      .selectAll('path')
      .nodes();

    const hits = nodes.filter(node => {
      const d = d3.select(node).datum();

      const radius = d.radius + 2; // Use a circle around the shape for hit testing

      const dx = mx - d.px;
      const dy = my - d.py;

      return dx * dx + dy * dy <= radius * radius;
    });

    return hits;
  }

  /**
   * Called when one or more overlapping points are clicked
   * @param mx mouse pointer's x-coordinate relative to g element
   * @param my mouse pointer's y-coordinate relative to g element
   * @param clientX mouse pointer's window x-coordinate
   * @param clientY mouse pointer's window y-coordinate
   */
  private selectPoints(mx: number, my: number, clientX: number, clientY: number) {
    const points = this.getPointsUnderCursor(mx, my);    
    if(points.length) {
      if(isMobile() || points.length > 1) { 
        // If more than one point selected, show context menu, where user can select which one they wanted
        // Context menu is always shown on mobile to confirm choice, since we can't show them a tooltip on hover
        $(this.tooltipParent)?.tooltip('dispose');
        this.tooltipParent = null;
        const data = points.map(p => p.__data__);
        this.createSelectPointsMenu(clientX, clientY, data);
      }
      else
        (window as any).acceptSeek(points[0].__data__.id); // Only one point selected, so accept the seek immediately
    }
  }

  /**
   * Create a context menu at the mouse pointer which lets the user confirm which point they clicked
   * @param x window x-coordinate to display menu
   * @param y window y-coordinate to display menu
   * @param items seek descriptions for each overlapping point clicked
   */
  private createSelectPointsMenu(x: number, y: number, items: DataItem[]) {
    const menu = $('<ul class="context-menu dropdown-menu"></ul>');
    items.forEach(item => {
      menu.append(`<li><a class="dropdown-item noselect" data-id="${item.id}">${item.text}</a></li>`);
    });      
   
    // Menu item clicked, accept that seek
    const itemSelectedCallback = (event: any) => {
      const id = $(event.target).data('id');
      (window as any).acceptSeek(id);
    }
  
    // On desktop move menu under the mouse pointer so that an item is hovered straight away
    createContextMenu(menu, isMobile() ? x : x - 5, isMobile() ? y : y + 15, itemSelectedCallback, null, 'top', ['top-start', 'top-end', 'bottom-start', 'bottom-end']);
  }

  /**
   * Check if the currently displayed data-point tooltip needs updating or removing.
   * For example, if the seek gets removed, or another overlapping point appears under the cursor.
   * @param mx mouse x-coordinate relative to g element
   * @param my mouse y-coordinate relative to g element
   */
  private updateTooltip(mx: number, my: number) {
    const points = this.getPointsUnderCursor(mx, my);
    
    const currIds = new Set<number>(points.map(n => n.__data__.id));

    // Check if points under the mouse cursor have changed
    let changed = false;
    if(currIds.size !== this.hoveredIds.size)
      changed = true;
    for(const v of currIds) {
      if(!this.hoveredIds.has(v)) 
        changed = true;
    }

    this.hoveredIds = currIds;

    if(changed) {
      $(this.tooltipParent)?.tooltip('dispose');
      this.tooltipParent = null;

      if(points.length) {
        this.tooltipParent = points[0];
        let tooltipText = '';
        points.forEach(p => {
          tooltipText = tooltipText + p.__data__.text + '<br>'
        });    
        $(this.tooltipParent).tooltip({
          placement: 'top',
          trigger: 'manual',
          title: tooltipText,
          customClass: 'seek-graph-tooltip',
          html: true
        }).tooltip('show');
      }
    }
  }
}
