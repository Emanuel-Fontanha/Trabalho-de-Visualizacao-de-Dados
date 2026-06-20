import * as d3 from 'd3';

// View "When": volume mensal de reviews. Arrastar (brush) sobre o gráfico
// filtra os imóveis para os que receberam pelo menos uma review no
// intervalo selecionado — é assim que a dimensão temporal se propaga para
// o mapa e o histograma (nenhum dos dois tem, sozinho, noção de tempo).
export function createTimeline(selector, { onBrush } = {}) {
    const svg = d3.select(selector);
    const width = +svg.attr('width');
    const height = +svg.attr('height');
    const margin = { top: 10, right: 16, bottom: 24, left: 40 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
    const areaG = g.append('g').attr('class', 'area');
    const axisX = g.append('g').attr('class', 'axis axis-x').attr('transform', `translate(0,${innerH})`);
    const axisY = g.append('g').attr('class', 'axis axis-y');

    const x = d3.scaleTime().range([0, innerW]);
    const y = d3.scaleLinear().range([innerH, 0]);
    const parseMonth = d3.timeParse('%Y-%m');

    const area = d3.area()
        .x((d) => x(d.date))
        .y0(innerH)
        .y1((d) => y(d.n_reviews))
        .curve(d3.curveMonotoneX);

    const line = d3.line()
        .x((d) => x(d.date))
        .y((d) => y(d.n_reviews))
        .curve(d3.curveMonotoneX);

    const brush = d3.brushX().extent([[0, 0], [innerW, innerH]]).on('end', brushed);
    const brushG = g.append('g').attr('class', 'brush').call(brush);

    function brushed(event) {
        if (!onBrush) return;
        const sel = event.selection;
        if (!sel) {
            onBrush(null); // brush limpo -> remove o filtro "when"
            return;
        }
        const [start, end] = sel.map(x.invert);
        onBrush([toISO(start), toISO(end)]);
    }

    function toISO(date) {
        return date.toISOString().slice(0, 10);
    }

    function clearBrush() {
        brushG.call(brush.move, null);
    }

    function update(rows) {
        const data = (rows || [])
            .map((d) => ({ date: parseMonth(d.month), n_reviews: +d.n_reviews }))
            .filter((d) => d.date instanceof Date && !isNaN(d.date))
            .sort((a, b) => a.date - b.date);

        if (data.length === 0) {
            areaG.selectAll('*').remove();
            return;
        }

        x.domain(d3.extent(data, (d) => d.date));
        y.domain([0, d3.max(data, (d) => d.n_reviews) || 1]).nice();

        axisX.call(d3.axisBottom(x).ticks(6).tickFormat(d3.timeFormat('%Y')));
        axisY.call(d3.axisLeft(y).ticks(4));

        const areaPath = areaG.selectAll('path.fill').data([data]);
        areaPath.enter().append('path').attr('class', 'fill')
            .merge(areaPath)
            .attr('fill', 'var(--accent-teal)')
            .attr('fill-opacity', 0.35)
            .attr('d', area);

        const linePath = areaG.selectAll('path.line').data([data]);
        linePath.enter().append('path').attr('class', 'line')
            .merge(linePath)
            .attr('fill', 'none')
            .attr('stroke', 'var(--accent-teal)')
            .attr('stroke-width', 1.6)
            .attr('d', line);

        brushG.raise();
    }

    return { update, clearBrush };
}