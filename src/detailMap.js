import * as d3 from 'd3';

// Cria o mapa de detalhe (zoom) para um imóvel selecionado, com suporte a seleção e tooltip
export function createDetailMap(selector, { onSelect } = {}) {
    const svg = d3.select(selector);
    const width = +svg.attr('width');
    const height = +svg.attr('height');

    const g = svg.append('g').attr('class', 'detail-map-zoom-layer');
    const terrainG = g.append('g').attr('class', 'terrain');
    const pointsG = g.append('g').attr('class', 'points');
    const highlightG = g.append('g').attr('class', 'highlight');

    const emptyMsg = svg.append('text')
        .attr('x', width / 2).attr('y', height / 2)
        .attr('text-anchor', 'middle')
        .attr('font-size', 12).attr('fill', '#888')
        .text('Selecione um imóvel no mapa para ver o detalhe aqui.');

    const panel = svg.node().closest('.panel') || svg.node().parentNode;
    const tip = d3.select(panel).append('div').attr('class', 'tooltip').style('opacity', 0);


    // --- Funções auxiliares para tooltip ---------------------------------
    // Mostra tooltip com detalhes do imóvel
    function showTooltip(d, event) {
        if (!d) return hideTooltip();
        const rect = panel.getBoundingClientRect();
        tip.style('opacity', 1)
            .style('left', `${event.clientX - rect.left + 14}px`)
            .style('top', `${event.clientY - rect.top + 10}px`)
            .html(`
                <div style="font-family: sans-serif; line-height: 1.4;">
                   <strong style="font-size: 13px; color: var(--accent-teal);">${d.name ?? 'Sem nome'}</strong><br>
                    <span style="font-size: 11px; color: #666;">
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
    
    // Esconde a tooltip
    function hideTooltip() {
        tip.style('opacity', 0);
    }

    const x = d3.scaleLinear();
    const y = d3.scaleLinear();

    const zoom = d3.zoom()
        .scaleExtent([1, 12])
        .on('zoom', (event) => {
            g.attr('transform', event.transform);
        });
    svg.call(zoom);

    let currentCity = null;

    // Centraliza o zoom no ponto (px, py) com a escala especificada
    function centerOn(px, py, scale = 3.8) {
        const t = d3.zoomIdentity
            .translate(width / 2, height / 2)
            .scale(scale)
            .translate(-px, -py);
        svg.transition().duration(500).call(zoom.transform, t);
    }

    // Desenha o "terreno" (polígono) ao redor dos pontos, com base na envoltória convexa
    function drawTerrain(points) {
        terrainG.selectAll('*').remove();
        if (points.length < 3) return;

        const coords = points.map((d) => [x(+d.longitude), y(+d.latitude)]);
        const hull = d3.polygonHull(coords);
        if (!hull) return;

        const cx = d3.mean(hull, (p) => p[0]);
        const cy = d3.mean(hull, (p) => p[1]);
        const expanded = hull.map(([px, py]) => [
            cx + (px - cx) * 1.14,
            cy + (py - cy) * 1.14,
        ]);

        const line = d3.line().curve(d3.curveCatmullRomClosed.alpha(0.7));
        terrainG.append('path')
            .attr('d', line(expanded))
            .attr('fill', '#eef0e8')
            .attr('stroke', '#d6dac9')
            .attr('stroke-width', 1.5);
    }

    // *** AQUI: Mesma escala de cor de avaliação (verde/laranja) do mapa principal ***
    const ratingColorScale = d3.scaleSequential((t) => d3.interpolateHcl('#1f6e72', '#e8714a')(t));

    // Atualiza os pontos no mapa de detalhe, com base nos dados filtrados (chamado pelo main.js)
    function update(points, selectedId, recenter) {
        const valid = (points || []).filter((d) => d.longitude != null && d.latitude != null);

        if (valid.length === 0 || selectedId == null) {
            terrainG.selectAll('*').remove();
            pointsG.selectAll('*').remove();
            highlightG.selectAll('*').remove();
            emptyMsg.style('display', null);
            return;
        }
        emptyMsg.style('display', 'none');

        const cityChanged = currentCity !== null && currentCity !== (valid[0]?.city ?? null);
        currentCity = valid[0]?.city ?? currentCity;

        // Atualiza os domínios de tamanho e cor
        const ratings = valid.map((d) => +d.review_scores_rating).filter((v) => !isNaN(v));
        const ratingExtent = ratings.length ? d3.extent(ratings) : [0, 100];
        ratingColorScale.domain(ratingExtent);

        x.domain(d3.extent(valid, (d) => +d.longitude)).range([40, width - 40]).nice();
        y.domain(d3.extent(valid, (d) => +d.latitude)).range([height - 30, 30]).nice(); 

        drawTerrain(valid);

        const selected = valid.find((d) => d.listing_id === selectedId);

        const circles = pointsG.selectAll('circle').data(valid, (d) => d.listing_id);
        circles.exit().remove();
        circles.enter().append('circle')
            .merge(circles)
            .attr('cx', (d) => x(+d.longitude))
            .attr('cy', (d) => y(+d.latitude))
            .attr('r', (d) => (d.listing_id === selectedId ? 0 : 3.5)) // Selecionado fica no highlightG
            // Aplica a cor com base na nota, ou cinza se não tiver nota
            .attr('fill', (d) => (d.review_scores_rating != null ? ratingColorScale(+d.review_scores_rating) : '#999'))
            .attr('fill-opacity', 0.65)
            .attr('stroke', '#0b2027')
            .attr('stroke-width', 0.5)
            .style('cursor', 'pointer')
            .on('click', (event, d) => {
                if (onSelect) onSelect(d);
            })
            .on('mouseenter', (event, d) => showTooltip(d, event))
            .on('mousemove', (event) => {
                const rect = panel.getBoundingClientRect();
                tip.style('left', `${event.clientX - rect.left + 14}px`).style('top', `${event.clientY - rect.top + 10}px`);
            })
            .on('mouseleave', hideTooltip);

        highlightG.selectAll('*').remove();
        if (selected) {
            const sx = x(+selected.longitude);
            const sy = y(+selected.latitude);
            
            // Pega a cor específica deste imóvel selecionado
            const ptColor = selected.review_scores_rating != null ? ratingColorScale(+selected.review_scores_rating) : '#999';
            
            highlightG.append('circle')
                .attr('cx', sx).attr('cy', sy).attr('r', 11)
                .attr('fill', 'none').attr('stroke', ptColor).attr('stroke-width', 2).attr('opacity', 0.8);
                
            highlightG.append('circle')
                .attr('cx', sx).attr('cy', sy).attr('r', 6)
                .attr('fill', ptColor).attr('stroke', '#fff').attr('stroke-width', 1.5)
                .style('cursor', 'pointer')
                .on('mouseenter', (event) => showTooltip(selected, event))
                .on('mousemove', (event) => {
                    const rect = panel.getBoundingClientRect();
                    tip.style('left', `${event.clientX - rect.left + 14}px`).style('top', `${event.clientY - rect.top + 10}px`);
                })
                .on('mouseleave', hideTooltip);

            if (recenter || cityChanged) centerOn(sx, sy);
        }
    }
    
    // Reseta o mapa de detalhe, limpando todos os elementos e voltando ao estado inicial
    function reset() {
        terrainG.selectAll('*').remove();
        pointsG.selectAll('*').remove();
        highlightG.selectAll('*').remove();
        emptyMsg.style('display', null);
        currentCity = null;
        svg.call(zoom.transform, d3.zoomIdentity);
    }

    return { update, reset };
}