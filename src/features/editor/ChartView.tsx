import { useMemo } from "react";
import { EMU_PER_INCH, formatChartValue, resolveChartData, type ChartElement, type Slide } from "../../core/document-model";

/**
 * The canvas view of a native chart.
 *
 * The export writes a real chart object, so the canvas has to show the same
 * categories, the same values and the same unit as the exported chart. The
 * numbers are read from the reviewed metric blocks, never from a copy inside
 * the element, so the canvas cannot show a number the content does not carry.
 */
export function ChartView({ element, slide, scale, compact = false }: { element: ChartElement; slide: Slide; scale: number; compact?: boolean }) {
  // The data only depends on the reviewed blocks the chart points at, so it can
  // be reused while the element and its page keep the same identity.
  const resolved = useMemo(() => resolveChartData(slide, element), [slide, element]);
  const fontSize = Math.max(4, element.style.fontSizePt * scale * EMU_PER_INCH / 72);
  if (!resolved) {
    return <div className="chart-view chart-missing" style={{ fontSize, color: element.style.textColor }}>图表数据缺失</div>;
  }
  const values = resolved.data.map((datum) => Math.abs(datum.value));
  const max = Math.max(...values, 1);
  const color = (index: number) => element.style.seriesColors[index % element.style.seriesColors.length] ?? "#3366CC";
  const valueLabel = (value: number) => (element.style.showValueLabels ? formatChartValue(value, resolved.unit) : "");

  if (element.kind === "bar") {
    return (
      <div className={`chart-view chart-horizontal${compact ? " compact" : ""}`}>
        {resolved.data.map((datum, index) => (
          <div className="chart-row" key={`${datum.category}-${index}`}>
            <span className="chart-category" style={{ fontSize, color: element.style.textColor }}>{datum.category}</span>
            <span className="chart-track"><span className="chart-bar" style={{ width: `${(Math.abs(datum.value) / max) * 100}%`, background: color(index) }} /></span>
            {element.style.showValueLabels && <span className="chart-value" style={{ fontSize, color: element.style.textColor }}>{valueLabel(datum.value)}</span>}
          </div>
        ))}
      </div>
    );
  }

  if (element.kind === "pie") {
    const total = values.reduce((sum, value) => sum + value, 0) || 1;
    let cursor = 0;
    const stops = resolved.data.map((datum, index) => {
      const from = cursor;
      cursor += (Math.abs(datum.value) / total) * 100;
      return `${color(index)} ${from.toFixed(2)}% ${cursor.toFixed(2)}%`;
    });
    return (
      <div className={`chart-view chart-pie${compact ? " compact" : ""}`}>
        <span className="chart-pie-disc" style={{ background: `conic-gradient(${stops.join(", ")})` }} />
        <span className="chart-legend">
          {resolved.data.map((datum, index) => (
            <span className="chart-legend-item" key={`${datum.category}-${index}`}>
              <i style={{ background: color(index) }} />
              <span style={{ fontSize, color: element.style.textColor }}>{datum.category} {valueLabel(datum.value)}</span>
            </span>
          ))}
        </span>
      </div>
    );
  }

  if (element.kind === "line") {
    const points = resolved.data.map((datum, index) => {
      const x = resolved.data.length === 1 ? 0 : (index / (resolved.data.length - 1)) * 100;
      const y = 100 - (Math.abs(datum.value) / max) * 100;
      return `${x},${y}`;
    }).join(" ");
    return (
      <div className={`chart-view chart-line${compact ? " compact" : ""}`}>
        <svg className="chart-line-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polyline points={points} fill="none" stroke={color(0)} strokeWidth={compact ? 4 : 2} vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="chart-axis">
          {resolved.data.map((datum, index) => (
            <span className="chart-axis-item" key={`${datum.category}-${index}`}>
              <span className="chart-category" style={{ fontSize, color: element.style.textColor }}>{datum.category}</span>
              {element.style.showValueLabels && <span className="chart-value" style={{ fontSize, color: element.style.textColor }}>{valueLabel(datum.value)}</span>}
            </span>
          ))}
        </span>
      </div>
    );
  }

  return (
    <div className={`chart-view chart-vertical${compact ? " compact" : ""}`}>
      {resolved.data.map((datum, index) => (
        <div className="chart-column" key={`${datum.category}-${index}`}>
          {element.style.showValueLabels && <span className="chart-value" style={{ fontSize, color: element.style.textColor }}>{valueLabel(datum.value)}</span>}
          <span className="chart-bar" style={{ height: `${(Math.abs(datum.value) / max) * 100}%`, background: color(index) }} />
          <span className="chart-category" style={{ fontSize, color: element.style.textColor }}>{datum.category}</span>
        </div>
      ))}
    </div>
  );
}
