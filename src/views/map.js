import * as d3 from 'd3';

// View "Where": mapa de dispersão dos listings (latitude/longitude tratadas
// como um plano cartesiano simples — não é uma projeção geográfica real,
// mas para uma única cidade a distorção é pequena e a simplicidade reduz
// muito a complexidade do código; essa é uma decisão de design documentada
// no relatório, não um descuido).
//
// Interações suportadas (Taxonomia de Interação):
//  - Hover (mousemove sobre o quadtree)   -> tooltip com nome/preço/avaliação
//  - Clique simples (sem arrastar)        -> seleciona o listing (details on demand)
//  - Arrastar (brush) sobre a área        -> filtra por região (linked filter "where")
//
// onSelect(listing)    é chamado ao clicar em um ponto
// onBrush(bbox|null)   é chamado ao terminar um brush (null = brush limpo)
export function createMap(selector, { onSelect, onBrush } = {}) {
    const svg = d3.select(selector);
    const width = +svg.attr('width');
    const height = +svg.attr('height');
    const margin = { top: 16, right: 16, bottom: 16, left: 16 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
    const pointsG = g.append('g').attr('class', 'points');

    const x = d3.scaleLinear().range([0, innerW]);
    const y = d3.scaleLinear().range([innerH, 0]); // y invertido: latitude maior = mais "para cima"
    // Cor por avaliação (review_scores_rating): de um teal frio (nota baixa) a
    // um coral quente (nota alta) — reaproveita os dois tons de destaque da
    // paleta da página em vez de uma escala genérica.
    const color = d3.scaleSequential((t) => d3.interpolateHcl('#1f6e72', '#e8714a')(t));

    // Gradiente da legenda (definido uma vez; os stops usam o interpolador
    // diretamente, então não precisam ser refeitos a cada update — só os
    // rótulos numéricos das pontas mudam).
    const defs = svg.append('defs');
    const gradient = defs.append('linearGradient').attr('id', 'rating-gradient');
    [0, 0.25, 0.5, 0.75, 1].forEach((t) => {
        gradient.append('stop').attr('offset', `${t * 100}%`).attr('stop-color', color.interpolator()(t));
    });

    const legendW = 110;
    const legend = svg.append('g').attr('class', 'legend').attr('transform', `translate(${width - legendW - 14}, ${height - 30})`);
    legend.append('rect').attr('width', legendW).attr('height', 8).attr('fill', 'url(#rating-gradient)').attr('rx', 4);
    const legendMin = legend.append('text').attr('class', 'legend-label').attr('x', 0).attr('y', 22);
    const legendMax = legend.append('text').attr('class', 'legend-label').attr('x', legendW).attr('y', 22).attr('text-anchor', 'end');
    legend.append('text').attr('class', 'legend-title').attr('x', 0).attr('y', -6).text('Avaliação média');

    // Tooltip: div HTML absoluto sobre o painel (o painel precisa de
    // position:relative no CSS para isso funcionar).
    const panel = svg.node().closest('.panel') || svg.node().parentNode;
    const tip = d3.select(panel).append('div').attr('class', 'tooltip').style('opacity', 0);

    let quadtree = null;
    let lastData = [];

    function showTooltip(d, event) {
        if (!d) return hideTooltip();
        const rect = panel.getBoundingClientRect();
        tip.style('opacity', 1)
            .style('left', `${event.clientX - rect.left + 14}px`)
            .style('top', `${event.clientY - rect.top + 10}px`)
            .html(
                `<strong>${d.name ?? 'Sem nome'}</strong><br>` +
                `${d.neighbourhood ?? ''}<br>` +
                `R$ ${Math.round(d.price ?? 0).toLocaleString('pt-BR')} · ${d.room_type ?? ''}<br>` +
                (d.review_scores_rating != null ? `★ ${d.review_scores_rating.toFixed(0)}/100` : 'sem avaliação')
            );
    }
    function hideTooltip() {
        tip.style('opacity', 0);
    }

    // Brush: cobre toda a área de plotagem. Em vez de dar aos círculos seus
    // próprios listeners de mouse (que o overlay do brush bloquearia), todo
    // hover/clique é tratado aqui, via quadtree, sobre o overlay do brush.
    const brush = d3.brush().extent([[0, 0], [innerW, innerH]]).on('end', brushed);
    const brushG = g.append('g').attr('class', 'brush').call(brush);

    function brushed(event) {
        const sel = event.selection;
        if (!sel) {
            // Sem retângulo de seleção = foi um clique simples (sem arrastar).
            // Usa as coordenadas do clique para achar o ponto mais próximo.
            if (event.sourceEvent) {
                const [px, py] = d3.pointer(event.sourceEvent, g.node());
                const nearest = quadtree && quadtree.find(px, py, 16);
                if (nearest && onSelect) onSelect(nearest);
            }
            return;
        }
        const [[x0, y0], [x1, y1]] = sel;
        const bbox = {
            lonMin: x.invert(x0),
            lonMax: x.invert(x1),
            latMin: y.invert(y1), // y está invertido na escala
            latMax: y.invert(y0),
        };
        if (onBrush) onBrush(bbox);
    }

    brushG
        .select('.overlay')
        .style('cursor', 'crosshair')
        .on('mousemove.hover', (event) => {
            const [px, py] = d3.pointer(event, g.node());
            const nearest = quadtree && quadtree.find(px, py, 16);
            showTooltip(nearest, event);
        })
        .on('mouseleave.hover', hideTooltip);

    // Permite que o botão "Limpar filtros" da UI também limpe o retângulo
    // visual do brush no mapa.
    function clearBrush() {
        brushG.call(brush.move, null);
    }

    function update(data, highlightedId = null) {
        lastData = (data || []).filter((d) => d.longitude != null && d.latitude != null);
        if (lastData.length === 0) {
            pointsG.selectAll('circle').remove();
            quadtree = null;
            return;
        }

        x.domain(d3.extent(lastData, (d) => +d.longitude)).nice();
        y.domain(d3.extent(lastData, (d) => +d.latitude)).nice();

        const ratings = lastData.map((d) => +d.review_scores_rating).filter((v) => !isNaN(v));
        const ratingExtent = ratings.length ? d3.extent(ratings) : [0, 100];
        color.domain(ratingExtent);
        legendMin.text(Math.round(ratingExtent[0]));
        legendMax.text(Math.round(ratingExtent[1]));

        quadtree = d3.quadtree()
            .x((d) => x(+d.longitude))
            .y((d) => y(+d.latitude))
            .addAll(lastData);

        const circles = pointsG.selectAll('circle').data(lastData, (d) => d.listing_id);
        circles.exit().transition().duration(150).attr('r', 0).remove();

        circles
            .enter()
            .append('circle')
            .attr('cx', (d) => x(+d.longitude))
            .attr('cy', (d) => y(+d.latitude))
            .attr('r', 0)
            .attr('fill', (d) => (d.review_scores_rating != null ? color(+d.review_scores_rating) : 'var(--ink-dim)'))
            .attr('stroke', '#0b2027')
            .attr('stroke-width', 0.6)
            .attr('fill-opacity', 0.75)
            .merge(circles)
            .transition()
            .duration(300)
            .attr('cx', (d) => x(+d.longitude))
            .attr('cy', (d) => y(+d.latitude))
            .attr('fill', (d) => (d.review_scores_rating != null ? color(+d.review_scores_rating) : 'var(--ink-dim)'))
            .attr('r', (d) => (highlightedId && highlightedId === d.listing_id ? 7 : 3.2))
            .attr('stroke-width', (d) => (highlightedId && highlightedId === d.listing_id ? 1.6 : 0.6));

        // O brush precisa ficar por cima dos pontos para capturar o arrastar
        // em qualquer lugar, mas isso não impede o hover: o hover é
        // calculado via quadtree a partir do overlay do próprio brush.
        brushG.raise();
    }

    return { update, clearBrush };
}