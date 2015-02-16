/**
 * @license
 * Copyright 2012 Dan Vanderkam (danvdk@gmail.com)
 * MIT-licensed (http://opensource.org/licenses/MIT)
 */
/*global Dygraph:false */

Dygraph.Plugins.Tooltip = (function() {
/*
Current bits of jankiness:
- Uses two private APIs:
    1. Dygraph.optionsViewForAxis_
    2. dygraph.plotter_.area
- Registers for a "predraw" event, which should be renamed.
- I call calculateEmWidthInDiv more often than needed.
*/

/*global Dygraph:false */
"use strict";


/**
 * Creates the tooltip, which appears when the user hovers over the chart.
 * The tooltip can be either a user-specified or generated div.
 *
 * @constructor
 */
var tooltip = function() {
  this.tooltip_div_ = null;
  this.is_generated_div_ = false;  // do we own this div, or was it user-specified?
};

tooltip.prototype.toString = function() {
  return "Tooltip Plugin";
};

// (defined below)
var generateTooltipDashHTML;

/**
 * This is called during the dygraph constructor, after options have been set
 * but before the data is available.
 *
 * Proper tasks to do here include:
 * - Reading your own options
 * - DOM manipulation
 * - Registering event listeners
 *
 * @param {Dygraph} g Graph instance.
 * @return {object.<string, function(ev)>} Mapping of event names to callbacks.
 */
tooltip.prototype.activate = function(g) {
  var div;
  var divWidth = g.getOption('tooltipDivWidth');

  var userLabelsDiv = g.getOption('tooltipDiv');
  if (userLabelsDiv && null !== userLabelsDiv) {
    if (typeof(userLabelsDiv) == "string" || userLabelsDiv instanceof String) {
      div = document.getElementById(userLabelsDiv);
    } else {
      div = userLabelsDiv;
    }
  } else {
    // Default tooltip styles. These can be overridden in CSS by adding
    // "!important" after your rule, e.g. "left: 30px !important;"
    var messagestyle = {
      "position": "absolute",
      "fontSize": "14px",
      "zIndex": 10,
      "width": divWidth + "px",
      "top": "0px",
      "left": (g.size().width - divWidth - 2) + "px",
      "background": "white",
      "lineHeight": "normal",
      "textAlign": "left",
      "overflow": "hidden"};

    // TODO(danvk): get rid of labelsDivStyles? CSS is better.
    Dygraph.update(messagestyle, g.getOption('labelsDivStyles'));
    div = document.createElement("div");
    div.className = "dygraph-tooltip";
    for (var name in messagestyle) {
      if (!messagestyle.hasOwnProperty(name)) continue;

      try {
        div.style[name] = messagestyle[name];
      } catch (e) {
        console.warn("You are using unsupported css properties for your " +
            "browser in labelsDivStyles");
      }
    }

    // TODO(danvk): come up with a cleaner way to expose this.
    g.graphDiv.appendChild(div);
    this.is_generated_div_ = true;
  }

  this.tooltip_div_ = div;
  this.one_em_width_ = 10;  // just a guess, will be updated.

  return {
    select: this.select,
    deselect: this.deselect,
    // TODO(danvk): rethink the name "predraw" before we commit to it in any API.
    predraw: this.predraw,
    didDrawChart: this.didDrawChart
  };
};

// Needed for dashed lines.
var calculateEmWidthInDiv = function(div) {
  var sizeSpan = document.createElement('span');
  sizeSpan.setAttribute('style', 'margin: 0; padding: 0 0 0 1em; border: 0;');
  div.appendChild(sizeSpan);
  var oneEmWidth=sizeSpan.offsetWidth;
  div.removeChild(sizeSpan);
  return oneEmWidth;
};

var escapeHTML = function(str) {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
};

tooltip.prototype.select = function(e) {
  var xValue = e.selectedX;
  var points = e.selectedPoints;
  var row = e.selectedRow;

  var tooltipMode = e.dygraph.getOption('tooltip');
  if (tooltipMode === 'never') {
    this.tooltip_div_.style.display = 'none';
    return;
  }

  if (tooltipMode === 'follow') {
    // create floating tooltip div
    var area = e.dygraph.plotter_.area;
    var tooltipDivWidth = e.dygraph.getOption('tooltipDivWidth');
    var yAxisLabelWidth = e.dygraph.getOptionForAxis('axisLabelWidth', 'y');
    // determine floating [left, top] coordinates of the tooltip div
    // within the plotter_ area
    // offset 20 px to the right and down from the first selection point
    // 20 px is guess based on mouse cursor size
    var leftTooltip = points[0].x * area.w + 20;
    var topTooltip  = points[0].y * area.h - 20;

    // if tooltip floats to end of the window area, it flips to the other
    // side of the selection point
    if ((leftTooltip + tooltipDivWidth + 1) > (window.scrollX + window.innerWidth)) {
      leftTooltip = leftTooltip - 2 * 20 - tooltipDivWidth - (yAxisLabelWidth - area.x);
    }

    e.dygraph.graphDiv.appendChild(this.tooltip_div_);
    this.tooltip_div_.style.left = yAxisLabelWidth + leftTooltip + "px";
    this.tooltip_div_.style.top = topTooltip + "px";
  }

  var html = tooltip.generateTooltipHTML(e.dygraph, xValue, points, this.one_em_width_, row);
  this.tooltip_div_.innerHTML = html;
  this.tooltip_div_.style.display = '';
};

tooltip.prototype.deselect = function(e) {
  var tooltipMode = e.dygraph.getOption('tooltip');
  // Have to do this every time, since styles might have changed.
  var oneEmWidth = calculateEmWidthInDiv(this.tooltip_div_);
  this.one_em_width_ = oneEmWidth;

  var html = tooltip.generateTooltipHTML(e.dygraph, undefined, undefined, oneEmWidth, null);
  this.tooltip_div_.innerHTML = html;
};

tooltip.prototype.didDrawChart = function(e) {
  this.deselect(e);
};

// Right edge should be flush with the right edge of the charting area (which
// may not be the same as the right edge of the div, if we have two y-axes.
// TODO(danvk): is any of this really necessary? Could just set "right" in "activate".
/**
 * Position the labels div so that:
 * - its right edge is flush with the right edge of the charting area
 * - its top edge is flush with the top edge of the charting area
 * @private
 */
tooltip.prototype.predraw = function(e) {
  // Don't touch a user-specified labelsDiv.
  if (!this.is_generated_div_) return;

  // TODO(danvk): only use real APIs for this.
  e.dygraph.graphDiv.appendChild(this.tooltip_div_);
  var area = e.dygraph.plotter_.area;
  var tooltipDivWidth = e.dygraph.getOption("tooltipDivWidth");
  this.tooltip_div_.style.left = area.x + area.w - tooltipDivWidth - 1 + "px";
  this.tooltip_div_.style.top = area.y + "px";
  this.tooltip_div_.style.width = tooltipDivWidth + "px";
};

/**
 * Called when dygraph.destroy() is called.
 * You should null out any references and detach any DOM elements.
 */
tooltip.prototype.destroy = function() {
  this.tooltip_div_ = null;
};

/**
 * @private
 * Generates HTML for the tooltip which is displayed when hovering over the
 * chart. If no selected points are specified, a default tooltip is returned
 * (this may just be the empty string).
 * @param {number} x The x-value of the selected points.
 * @param {Object} sel_points List of selected points for the given
 *   x-value. Should have properties like 'name', 'yval' and 'canvasy'.
 * @param {number} oneEmWidth The pixel width for 1em in the tooltip. Only
 *   relevant when displaying a tooltip with no selection (i.e. {tooltip:
 *   'always'}) and with dashed lines.
 * @param {number} row The selected row index.
 */
tooltip.generateTooltipHTML = function(g, x, sel_points, oneEmWidth, row) {
  // TODO(danvk): deprecate this option in place of {tooltip: 'never'}
  if (g.getOption('showLabelsOnHighlight') !== true) return '';

  // If no points are selected, we display a default tooltip. Traditionally,
  // this has been blank. But a better default would be a conventional tooltip,
  // which provides essential information for a non-interactive chart.
  var html, sepLines, i, dash, strokePattern;
  var labels = g.getLabels();

  if (typeof(x) === 'undefined') {
    html = '';
    for (i = 1; i < labels.length; i++) {
      var series = g.getPropertiesForSeries(labels[i]);
      if (!series.visible) continue;

      if (html !== '') html += '<br/>';
      strokePattern = g.getOption("strokePattern", labels[i]);
      dash = generateTooltipDashHTML(strokePattern, series.color, oneEmWidth);
      html += "<span style='font-weight: bold; color: " + series.color + ";'>" +
          dash + " <span class=\"label\">" + escapeHTML(labels[i]) + "</span></span>";
    }
    return html;
  }

  // TODO(danvk): remove this use of a private API
  var xOptView = g.optionsViewForAxis_('x');
  var xvf = xOptView('valueFormatter');
  html = xvf.call(g, x, xOptView, labels[0], g, row, 0);
  if (html !== '') {
    html += ':';
  }

  var yOptViews = [];
  var num_axes = g.numAxes();
  for (i = 0; i < num_axes; i++) {
    // TODO(danvk): remove this use of a private API
    yOptViews[i] = g.optionsViewForAxis_('y' + (i ? 1 + i : ''));
  }
  var showZeros = g.getOption("labelsShowZeroValues");
  var highlightSeries = g.getHighlightSeries();
  for (i = 0; i < sel_points.length; i++) {
    var pt = sel_points[i];
    if (pt.yval === 0 && !showZeros) continue;
    if (!Dygraph.isOK(pt.canvasy)) continue;
    html += "<br/>";

    var series = g.getPropertiesForSeries(pt.name);
    var yOptView = yOptViews[series.axis - 1];
    var fmtFunc = yOptView('valueFormatter');
    var yval = fmtFunc.call(g, pt.yval, yOptView, pt.name, g, row, labels.indexOf(pt.name)) ;

    var cls = (pt.name == highlightSeries) ? " class='highlight'" : "";

    // TODO(danvk): use a template string here and make it an attribute.
    html += "<span" + cls + ">" + " <b><span style='color: " + series.color + ";'>" +
        escapeHTML(pt.name) + "</span></b>:&#160;" + yval + "</span>";
  }
  return html;
};


/**
 * Generates html for the "dash" displayed on the tooltip when using "tooltip: always".
 * In particular, this works for dashed lines with any stroke pattern. It will
 * try to scale the pattern to fit in 1em width. Or if small enough repeat the
 * pattern for 1em width.
 *
 * @param strokePattern The pattern
 * @param color The color of the series.
 * @param oneEmWidth The width in pixels of 1em in the tooltip.
 * @private
 */
generateTooltipDashHTML = function(strokePattern, color, oneEmWidth) {
  // Easy, common case: a solid line
  if (!strokePattern || strokePattern.length <= 1) {
    return "<div style=\"display: inline-block; position: relative; " +
    "bottom: .5ex; padding-left: 1em; height: 1px; " +
    "border-bottom: 2px solid " + color + ";\"></div>";
  }

  var i, j, paddingLeft, marginRight;
  var strokePixelLength = 0, segmentLoop = 0;
  var normalizedPattern = [];
  var loop;

  // Compute the length of the pixels including the first segment twice, 
  // since we repeat it.
  for (i = 0; i <= strokePattern.length; i++) {
    strokePixelLength += strokePattern[i%strokePattern.length];
  }

  // See if we can loop the pattern by itself at least twice.
  loop = Math.floor(oneEmWidth/(strokePixelLength-strokePattern[0]));
  if (loop > 1) {
    // This pattern fits at least two times, no scaling just convert to em;
    for (i = 0; i < strokePattern.length; i++) {
      normalizedPattern[i] = strokePattern[i]/oneEmWidth;
    }
    // Since we are repeating the pattern, we don't worry about repeating the
    // first segment in one draw.
    segmentLoop = normalizedPattern.length;
  } else {
    // If the pattern doesn't fit in the tooltip we scale it to fit.
    loop = 1;
    for (i = 0; i < strokePattern.length; i++) {
      normalizedPattern[i] = strokePattern[i]/strokePixelLength;
    }
    // For the scaled patterns we do redraw the first segment.
    segmentLoop = normalizedPattern.length+1;
  }

  // Now make the pattern.
  var dash = "";
  for (j = 0; j < loop; j++) {
    for (i = 0; i < segmentLoop; i+=2) {
      // The padding is the drawn segment.
      paddingLeft = normalizedPattern[i%normalizedPattern.length];
      if (i < strokePattern.length) {
        // The margin is the space segment.
        marginRight = normalizedPattern[(i+1)%normalizedPattern.length];
      } else {
        // The repeated first segment has no right margin.
        marginRight = 0;
      }
      dash += "<div style=\"display: inline-block; position: relative; " +
        "bottom: .5ex; margin-right: " + marginRight + "em; padding-left: " +
        paddingLeft + "em; height: 1px; border-bottom: 2px solid " + color +
        ";\"></div>";
    }
  }
  return dash;
};


return tooltip;
})();
