import * as d3 from 'd3';
import { PRICE_BINS } from './data.js';

const ROOM_TYPES = ['Entire place', 'Private room', 'Shared room', 'Hotel room'];
const ROOM_COLORS = {
    'Entire place': '#2F9E96',
    'Private room': '#E8714A', 
    'Shared room': '#D9A86C', 
    'Hotel room': '#7A98A0', 
};

// Cria o gráfico de histograma de preços, com barras empilhadas por tipo de quarto
export function createHistogram(selector, { onBarClick } = {}) {
    const svg = d3.select(selector);
    const width = +svg.attr('width');
    const height = +svg.attr('height');
    const margin = { top: 10, right: 10, bottom: 46, left: 36 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
    const barsG = g.append('g');
    const axisX = g.append('g').attr('class', 'axis axis-x').attr('transform', `translate(0,${innerH})`);
    const axisY = g.append('g').attr('class', 'axis axis-y');

    const x = d3.scaleBand().domain(PRICE_BINS.map((b) => b.label)).range([0, innerW]).padding(0.25);
    const y = d3.scaleLinear().range([innerH, 0]);
    const stackGen = d3.stack().keys(ROOM_TYPES);

    // Função para tratar os dados de entrada, transformando-os em um formato adequado para o gráfico empilhado
    function pivot(rows) {
        const byBin = new Map(PRICE_BINS.map((b) => [b.label, { bin_label: b.label }]));
        byBin.forEach((row) => ROOM_TYPES.forEach((rt) => (row[rt] = 0)));
        (rows || []).forEach((r) => {
            const row = byBin.get(r.bin_label);
            if (row && ROOM_TYPES.includes(r.room_type)) row[r.room_type] = +r.n;
        });
        return Array.from(byBin.values());
    }

    // Função para atualizar o histograma com novos dados, aplicando cores e tamanhos às barras com base na seleção
    function update(rows, activeBinLabel = null) {
        const pivoted = pivot(rows);
        const totals = pivoted.map((r) => ROOM_TYPES.reduce((s, rt) => s + r[rt], 0));
        y.domain([0, d3.max(totals) || 1]).nice();

        // Atualiza os eixos X e Y com base nos dados atuais, aplicando rotação aos rótulos do eixo X para melhor legibilidade
        axisX.call(d3.axisBottom(x)).selectAll('text').attr('transform', 'rotate(-35)').style('text-anchor', 'end');
        axisY.call(d3.axisLeft(y).ticks(4));

        const series = stackGen(pivoted);

        const layers = barsG.selectAll('g.layer').data(series, (d) => d.key);
        const layersEnter = layers.enter().append('g').attr('class', 'layer');
        layersEnter.merge(layers).attr('fill', (d) => ROOM_COLORS[d.key]);
        layers.exit().remove();

        const rects = layersEnter.merge(layers).selectAll('rect').data((d) => d, (d) => d.data.bin_label);

        rects
            .enter()
            .append('rect')
            .attr('x', (d) => x(d.data.bin_label))
            .attr('width', x.bandwidth())
            .attr('y', innerH)
            .attr('height', 0)
            .style('cursor', 'pointer')
            .on('click', (event, d) => onBarClick && onBarClick(d.data.bin_label))
            .merge(rects)
            .attr('x', (d) => x(d.data.bin_label))
            .attr('width', x.bandwidth())
            .attr('stroke', (d) => (d.data.bin_label === activeBinLabel ? 'var(--ink)' : 'none'))
            .attr('stroke-width', 1.5)
            .attr('opacity', (d) => (activeBinLabel && d.data.bin_label !== activeBinLabel ? 0.45 : 1))
            .transition()
            .duration(250)
            .attr('y', (d) => y(d[1]))
            .attr('height', (d) => y(d[0]) - y(d[1]));

        rects.exit().remove();
    }

    return { update, ROOM_TYPES, ROOM_COLORS };
}