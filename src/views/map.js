import * as d3 from 'd3';


const CITY_ORDER = [
    'Paris', 'New York', 'Rome', 'Sydney', 'Rio de Janeiro',
    'Istanbul', 'Mexico City', 'Bangkok', 'Cape Town', 'Hong Kong',
];
const GRID_COLS = 5;
const GRID_ROWS = 2;

// Cria o mapa de pontos para cada cidade, com suporte a seleção e brush
export function createMap(selector, { onSelect, onBrush } = {}) {
    const svg = d3.select(selector);
    const width = +svg.attr('width');
    const height = +svg.attr('height');

    const legendH = 60; // faixa reservada no topo para a legenda de cor (global, compartilhada)
    const cellW = width / GRID_COLS;
    const cellH = (height - legendH) / GRID_ROWS;
    const cellMargin = { top: 16, right: 8, bottom: 8, left: 8 };

    const color = d3.scaleSequential((t) => d3.interpolateHcl('#1f6e72', '#e8714a')(t));

    // --- Legenda (uma só, no topo do SVG inteiro) ---------------------
    const defs = svg.append('defs');
    const gradient = defs.append('linearGradient').attr('id', 'rating-gradient');
    [0, 0.25, 0.5, 0.75, 1].forEach((t) => {
        gradient.append('stop').attr('offset', `${t * 100}%`).attr('stop-color', color.interpolator()(t));
    });
    const legendW = 140;
    const legend = svg.append('g').attr('class', 'legend').attr('transform', `translate(${(width - legendW) / 2}, 16)`);
    legend.append('text').attr('class', 'legend-title').attr('x', legendW / 2).attr('y', 0).attr('text-anchor', 'middle').text('Avaliação média');
    legend.append('rect').attr('y', 8).attr('width', legendW).attr('height', 8).attr('fill', 'url(#rating-gradient)').attr('rx', 4);
    const legendMin = legend.append('text').attr('class', 'legend-label').attr('x', 0).attr('y', 30);
    const legendMax = legend.append('text').attr('class', 'legend-label').attr('x', legendW).attr('y', 30).attr('text-anchor', 'end');
    const panel = svg.node().closest('.panel') || svg.node().parentNode;
    const tip = d3.select(panel).append('div').attr('class', 'tooltip').style('opacity', 0);

    // --- Funções auxiliares para tooltip ---------------------------------
    function showTooltip(d, event) {
        if (!d) return hideTooltip();
        const rect = panel.getBoundingClientRect();
        tip.style('opacity', 1)
            .style('left', `${event.clientX - rect.left + 14}px`)
            .style('top', `${event.clientY - rect.top + 10}px`)
            .html(`
                <div style="font-family: sans-serif; line-height: 1.4;">
                    <strong style="font-size: 13px; color: var(--accent-teal);">${d.name ?? 'Sem nome'}</strong><br>
                        ${d.neighbourhood ?? '—'} • ${d.room_type ?? '—'}
                    </span><br>
                    <div style="margin-top: 6px; font-size: 12px;">
                        <strong>Preço:</strong> US$ ${d.price_usd != null ? Math.round(d.price_usd) : '—'}<br>
                        <strong>Nota:</strong> ${d.review_scores_rating != null ? `⭐ ${d.review_scores_rating}` : 'Sem nota'}<br>
                        <strong>Reviews:</strong> ${d.n_reviews ?? 0} avaliações
                    </div>
                </div>
            `);
    }
    function hideTooltip() {
        tip.style('opacity', 0);
    }
    const cells = CITY_ORDER.map((city, i) => {
        const col = i % GRID_COLS;
        const row = Math.floor(i / GRID_COLS);
        const cellG = svg.append('g')
            .attr('class', 'map-cell')
            .attr('transform', `translate(${col * cellW}, ${legendH + row * cellH})`);

        cellG.append('rect')
            .attr('class', 'cell-bg')
            .attr('width', cellW - 4).attr('height', cellH - 4)
            .attr('fill', 'none').attr('stroke', '#ddd').attr('stroke-width', 1);

        cellG.append('text')
            .attr('class', 'cell-label')
            .attr('x', 6).attr('y', 12)
            .attr('font-size', 11).attr('font-weight', 600)
            .text(city);

        const innerW = cellW - cellMargin.left - cellMargin.right;
        const innerH = cellH - cellMargin.top - cellMargin.bottom;
        const plotG = cellG.append('g').attr('transform', `translate(${cellMargin.left},${cellMargin.top})`);
        const pointsG = plotG.append('g').attr('class', 'points');

        const x = d3.scaleLinear().range([0, innerW]);
        const y = d3.scaleLinear().range([innerH, 0]); // y invertido: latitude maior = mais "para cima"
        const brush = d3.brush().extent([[0, 0], [innerW, innerH]]).on('end', brushed);
        const brushG = plotG.append('g').attr('class', 'brush').call(brush);

        const state = { quadtree: null, lastData: [] };

        // Função chamada quando o brush é finalizado (ao soltar o mouse) - Delimita uma área de seleção no mapa
        function brushed(event) {
            const sel = event.selection;
            if (!sel) {
                if (event.sourceEvent) {
                    const [px, py] = d3.pointer(event.sourceEvent, plotG.node());
                    const nearest = state.quadtree && state.quadtree.find(px, py, 16);
                    if (nearest && onSelect) onSelect(nearest);
                }
                if (onBrush) onBrush(null); // brush limpo nesta célula -> remove o filtro "where"
                return;
            }
            const [[x0, y0], [x1, y1]] = sel;
            const bbox = {
                lonMin: x.invert(x0),
                lonMax: x.invert(x1),
                latMin: y.invert(y1), // y está invertido na escala
                latMax: y.invert(y0),
            };
            if (onBrush) onBrush({ city, bbox });
        }

        brushG
            .select('.overlay')
            .style('cursor', 'crosshair')
            .on('mousemove.hover', (event) => {
                const [px, py] = d3.pointer(event, plotG.node());
                const nearest = state.quadtree && state.quadtree.find(px, py, 16);
                showTooltip(nearest, event);
            })
            .on('mouseleave.hover', hideTooltip);

        return { city, x, y, pointsG, brushG, brush, state };
    });

    // Limpa todos os brushes (chamado pelo main.js quando o filtro global é limpo)
    function clearBrush() {
        cells.forEach((c) => c.brushG.call(c.brush.move, null));
    }

    // Atualiza os pontos no mapa, com base nos dados filtrados (chamado pelo main.js)
    function update(data, highlightedId = null) {
        const all = (data || []).filter((d) => d.longitude != null && d.latitude != null);
        const ratings = all.map((d) => +d.review_scores_rating).filter((v) => !isNaN(v));
        const ratingExtent = ratings.length ? d3.extent(ratings) : [0, 100];
        color.domain(ratingExtent);
        legendMin.text(Math.round(ratingExtent[0]));
        legendMax.text(Math.round(ratingExtent[1]));

        const byCity = d3.group(all, (d) => d.city);

        cells.forEach((cell) => {
            const cellData = byCity.get(cell.city) || [];
            cell.state.lastData = cellData;

            if (cellData.length === 0) {
                cell.pointsG.selectAll('circle').remove();
                cell.state.quadtree = null;
                cell.brushG.raise();
                return;
            }

            cell.x.domain(d3.extent(cellData, (d) => +d.longitude)).nice();
            cell.y.domain(d3.extent(cellData, (d) => +d.latitude)).nice();

            cell.state.quadtree = d3.quadtree()
                .x((d) => cell.x(+d.longitude))
                .y((d) => cell.y(+d.latitude))
                .addAll(cellData);

            const circles = cell.pointsG.selectAll('circle').data(cellData, (d) => d.listing_id);
            circles.exit().remove();

            circles
                .enter()
                .append('circle')
                .attr('cx', (d) => cell.x(+d.longitude))
                .attr('cy', (d) => cell.y(+d.latitude))
                .attr('fill', (d) => (d.review_scores_rating != null ? color(+d.review_scores_rating) : 'var(--ink-dim)'))
                .attr('stroke', '#0b2027')
                .attr('stroke-width', 0.5)
                .attr('fill-opacity', 0.75)
                .merge(circles)
                .attr('cx', (d) => cell.x(+d.longitude))
                .attr('cy', (d) => cell.y(+d.latitude))
                .attr('fill', (d) => (d.review_scores_rating != null ? color(+d.review_scores_rating) : 'var(--ink-dim)'))
                .attr('r', (d) => (highlightedId && highlightedId === d.listing_id ? 6 : 2.2))
                .attr('stroke-width', (d) => (highlightedId && highlightedId === d.listing_id ? 1.4 : 0.5));
            cell.brushG.raise();
        });
    }

    return { update, clearBrush };
}
