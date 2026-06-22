import * as d3 from 'd3';

// --- FUNÇÃO PARA CRIAR A TIMELINE ---

// A timeline é um gráfico de área/linha que mostra a quantidade de reviews por mês.
// Permite selecionar um intervalo de datas (brush) e aplicar um filtro global.
// Também permite zoom visual para o intervalo selecionado, com botão de reset.
export function createTimeline(selector, { onBrush, onZoomChange } = {}) {
    const svg = d3.select(selector);
    const width = +svg.attr('width');
    const height = +svg.attr('height');
    const margin = { top: 10, right: 16, bottom: 24, left: 60 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
    const areaG = g.append('g').attr('class', 'area');
    const axisX = g.append('g').attr('class', 'axis axis-x').attr('transform', `translate(0,${innerH})`);
    const axisY = g.append('g').attr('class', 'axis axis-y');
    g.append('text')
        .attr('transform', 'rotate(-90)') 
        .attr('y', -margin.left + 12)  
        .attr('x', -(innerH / 2))     
        .attr('text-anchor', 'middle')   
        .attr('font-size', '11px')
        .attr('fill', '#666')
        .text('Quantidade de Reviews');
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


    // *** CORREÇÃO DE BUG: eixo Y travando em "1" depois de um zoom ***
    // Os dados são agregados por MÊS (1 ponto por mês, sempre no dia 1),
    // mas zoomDomain vem de x.invert() sobre a posição em pixels do
    // brush — datas "soltas" como 12 de agosto, não necessariamente o
    // dia 1 de nenhum mês. Se o usuário arrastasse um intervalo cujos
    // dois extremos caíssem DENTRO do mesmo mês sem tocar o dia 1 de
    // nenhum mês incluído (ex.: brush entre 10/ago e 20/ago), o filtro
    // `d.date >= zoomDomain[0] && d.date <= zoomDomain[1]` não batia em
    // NENHUM ponto — visibleData ficava vazio, d3.max([]) retornava
    // undefined, e o fallback "|| 1" travava o eixo Y em [0, 1].
    //
    // A correção arredonda o zoomDomain para fronteiras de mês ANTES de
    // filtrar: floor no início (volta para o dia 1 do mês do início) e
    // ceil no fim (avança para o dia 1 do mês seguinte ao do fim) — assim
    // qualquer mês que tenha overlap com o brush, mesmo que parcial, é
    // sempre incluído. Isso também melhora a UX: o zoom passa a sempre
    // "encaixar" em meses completos, em vez de cortar visualmente um mês
    // pela metade.

    // Retorna um domínio [start, end] arredondado para o mês mais próximo
    function monthAlignedDomain([start, end]) {
        return [d3.timeMonth.floor(start), d3.timeMonth.ceil(end)];
    }

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
        const [rawStart, rawEnd] = sel.map(x.invert);
        showPeriodLabel(rawStart, rawEnd);

        // Filtro "when" (linked views): continua usando as datas exatas
        // do brush (não as arredondadas por mês) — o filtro SQL em
        // data.js já trabalha em granularidade de dia, então não tem o
        // mesmo problema de "cair entre dois pontos" que o zoom visual
        // tinha; arredondar aqui só tornaria o filtro menos preciso do
        // que o usuário pediu.
        if (onBrush) onBrush([toISO(rawStart), toISO(rawEnd)]);

        // Zoom visual: usa as datas ARREDONDADAS por mês (ver
        // monthAlignedDomain acima) — é só esse cálculo que precisava
        // da correção.
        zoomTo(monthAlignedDomain([rawStart, rawEnd]));
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