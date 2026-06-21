import * as d3 from 'd3';

export function createTimeline(selector, { onBrush, onZoomChange } = {}) {
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

    const brush = d3.brushX()
        .extent([[0, 0], [innerW, innerH]])
        .on('brush', brushing)   // dispara continuamente enquanto o usuário arrasta
        .on('end', brushed);     // dispara uma vez, ao soltar o mouse
    const brushG = g.append('g').attr('class', 'brush').call(brush);

    const zoomOutBtn = g.append('g')
        .attr('class', 'zoom-out-btn')
        .attr('transform', `translate(${innerW - 118}, -2)`)
        .style('cursor', 'pointer')
        .style('display', 'none')
        .on('click', () => {
            zoomTo(null); // 1. Volta o zoom do gráfico ao normal
            if (onBrush) onBrush(null); // 2. Avisa o main.js para remover o filtro global
        });
    zoomOutBtn.append('rect')
        .attr('width', 118).attr('height', 18).attr('rx', 9)
        .attr('fill', '#eef5f4').attr('stroke', 'var(--accent-teal)').attr('stroke-width', 1);
    zoomOutBtn.append('text')
        .attr('x', 59).attr('y', 13).attr('text-anchor', 'middle')
        .attr('font-size', 10.5).attr('fill', 'var(--accent-teal)')
        .text('↺ ver período completo');

    const periodLabel = g.append('text')
        .attr('class', 'period-label')
        .attr('x', 0).attr('y', 11)
        .attr('font-size', 11).attr('font-weight', 600)
        .attr('fill', 'var(--ink, #222)')
        .style('display', 'none');
    const formatPeriod = d3.timeFormat('%b %Y');

    let lastData = [];      // série completa, como veio da última chamada a update()
    let fullDomain = null;   // [minDate, maxDate] do dataset inteiro — para onde o zoom out volta
    let zoomDomain = null;   // [minDate, maxDate] do zoom atual, ou null se não há zoom


    function brushing(event) {
        if (!event.sourceEvent || !event.selection) return;
        const [start, end] = event.selection.map(x.invert);
        showPeriodLabel(start, end);
    }

    function brushed(event) {
        if (!event.sourceEvent) return;

        const sel = event.selection;
        if (!sel) {
            if (onBrush) onBrush(null); // brush limpo -> remove o filtro "when"
            return;
        }
        const [start, end] = sel.map(x.invert);
        showPeriodLabel(start, end);

        // Filtro "when" (linked views): continua disparando exatamente
        // como antes — o zoom visual é um efeito ADICIONAL, não um
        // substituto da filtragem.
        if (onBrush) onBrush([toISO(start), toISO(end)]);
        zoomTo([start, end]);
    }

    function showPeriodLabel(start, end) {
        periodLabel.style('display', null).text(`${formatPeriod(start)} – ${formatPeriod(end)}`);
    }

    function toISO(date) {
        return date.toISOString().slice(0, 10);
    }

    // Aplica (ou remove, se range=null) o zoom visual e redesenha a
    // timeline com os dados já carregados (sem nova consulta SQL).
    function zoomTo(range) {
        zoomDomain = range;
        brushG.call(brush.move, null); // limpa o retângulo de seleção desenhado
        if (!range) periodLabel.style('display', 'none');
        draw();
        if (onZoomChange) onZoomChange(zoomDomain != null);
    }

    function clearBrush() {
        brushG.call(brush.move, null);
        zoomTo(null);
    }

    // Redesenha eixos/área/linha usando o domínio ATUAL (zoomDomain, se
    // houver, senão fullDomain) sobre lastData — não busca dados novos.
    function draw() {
        if (lastData.length === 0) return;

        x.domain(zoomDomain || fullDomain);

        const visibleData = zoomDomain
            ? lastData.filter((d) => d.date >= zoomDomain[0] && d.date <= zoomDomain[1])
            : lastData;

        y.domain([0, d3.max(visibleData, (d) => d.n_reviews) || 1]).nice();

        axisX.transition().duration(400).call(d3.axisBottom(x).ticks(6).tickFormat(d3.timeFormat(zoomDomain ? '%b %Y' : '%Y')));
        axisY.transition().duration(400).call(d3.axisLeft(y).ticks(4));

        const areaPath = areaG.selectAll('path.fill').data([lastData]);
        areaPath.enter().append('path').attr('class', 'fill')
            .merge(areaPath)
            .attr('fill', 'var(--accent-teal)')
            .attr('fill-opacity', 0.35)
            .transition().duration(400)
            .attr('d', area);

        const linePath = areaG.selectAll('path.line').data([lastData]);
        linePath.enter().append('path').attr('class', 'line')
            .merge(linePath)
            .attr('fill', 'none')
            .attr('stroke', 'var(--accent-teal)')
            .attr('stroke-width', 1.6)
            .transition().duration(400)
            .attr('d', line);

        zoomOutBtn.style('display', zoomDomain ? null : 'none');
        if (zoomDomain) zoomOutBtn.raise();
    }

    function update(rows) {
        lastData = (rows || [])
            .map((d) => ({ date: parseMonth(d.month), n_reviews: +d.n_reviews }))
            .filter((d) => d.date instanceof Date && !isNaN(d.date))
            .sort((a, b) => a.date - b.date);

        if (lastData.length === 0) {
            areaG.selectAll('*').remove();
            zoomOutBtn.style('display', 'none');
            return;
        }

        fullDomain = d3.extent(lastData, (d) => d.date);

        if (zoomDomain && (zoomDomain[0] < fullDomain[0] || zoomDomain[1] > fullDomain[1])) {
            zoomDomain = null;
        }
        draw();
    }

    return { update, clearBrush };
}