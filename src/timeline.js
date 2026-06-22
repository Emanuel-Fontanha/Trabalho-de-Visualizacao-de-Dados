import * as d3 from 'd3';

// --- FUNÇÃO PARA CRIAR A TIMELINE ---

// A timeline é um gráfico de área/linha que mostra a quantidade de reviews por mês.
// Permite selecionar um intervalo de datas (brush) e aplicar um filtro global.
// Também permite zoom visual para o intervalo selecionado, com botão de reset.
export function createTimeline(selector, { onBrush, onZoomChange } = {}) {
    // Configurações iniciais do SVG e escalas
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
    
    // Adiciona rótulo do eixo Y
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

    // Gera a área e a linha do gráfico, com interpolação suave
    const area = d3.area()
        .x((d) => x(d.date))
        .y0(innerH)
        .y1((d) => y(d.n_reviews))
        .curve(d3.curveMonotoneX);

    const line = d3.line()
        .x((d) => x(d.date))
        .y((d) => y(d.n_reviews))
        .curve(d3.curveMonotoneX);

    // Adiciona o brush para seleção de período
    const brush = d3.brushX()
        .extent([[0, 0], [innerW, innerH]])
        .on('brush', brushing)   // dispara continuamente enquanto o usuário arrasta
        .on('end', brushed);     // dispara uma vez, ao soltar o mouse
    
    // Adiciona o grupo do brush ao gráfico
    const brushG = g.append('g').attr('class', 'brush').call(brush);

    // Adiciona botão para sair do zoom
    const zoomOutBtn = g.append('g')
        .attr('class', 'zoom-out-btn')
        .attr('transform', `translate(${innerW - 118}, -2)`)
        .style('cursor', 'pointer')
        .style('display', 'none')
        .on('click', () => {
            zoomTo(null); // 1. Volta o zoom do gráfico ao normal
            if (onBrush) onBrush(null); // 2. Avisa o main.js para remover o filtro global
        });

    // Adiciona retângulo e texto ao botão de zoom out    
    zoomOutBtn.append('rect')
        .attr('width', 118).attr('height', 18).attr('rx', 9)
        .attr('fill', '#eef5f4').attr('stroke', 'var(--accent-teal)').attr('stroke-width', 1);
    
    // Adiciona texto ao botão de zoom out
    zoomOutBtn.append('text')
        .attr('x', 59).attr('y', 13).attr('text-anchor', 'middle')
        .attr('font-size', 10.5).attr('fill', 'var(--accent-teal)')
        .text('↺ ver período completo');

    // Adiciona rótulo de período selecionado (ex.: "Jan 2020 – Mar 2021")
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

    // Retorna um domínio [start, end] arredondado para o mês mais próximo
    function monthAlignedDomain([start, end]) {
        return [d3.timeMonth.floor(start), d3.timeMonth.ceil(end)];
    }

    // Função chamada continuamente enquanto o usuário arrasta o brush — mostra o rótulo do período selecionado
    function brushing(event) {
        if (!event.sourceEvent || !event.selection) return;
        const [start, end] = event.selection.map(x.invert);
        showPeriodLabel(start, end);
    }

    // Função chamada quando o brush é finalizado (ao soltar o mouse) — aplica o filtro global e o zoom visual
    function brushed(event) {
        if (!event.sourceEvent) return;

        const sel = event.selection;
        if (!sel) {
            if (onBrush) onBrush(null); // brush limpo -> remove o filtro "when"
            return;
        }
        const [rawStart, rawEnd] = sel.map(x.invert);

        // Ajusta o intervalo para o mês mais próximo, para evitar problemas de "cair entre dois pontos"
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

    // Mostra o rótulo do período selecionado (ex.: "Jan 2020 – Mar 2021")
    function showPeriodLabel(start, end) {
        periodLabel.style('display', null).text(`${formatPeriod(start)} – ${formatPeriod(end)}`);
    }

    // Converte uma data para o formato ISO (YYYY-MM-DD) — usado no filtro global
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

        // Define o domínio do eixo X com base no zoom atual (ou no domínio completo, se não houver zoom)
        x.domain(zoomDomain || fullDomain);

        // Filtra os dados para o intervalo de datas visível no zoom atual
        const visibleData = zoomDomain
            ? lastData.filter((d) => d.date >= zoomDomain[0] && d.date <= zoomDomain[1])
            : lastData;

        
        // Define o domínio do eixo Y com base nos dados visíveis, garantindo que o máximo seja pelo menos 1 para evitar problemas de escala
        y.domain([0, d3.max(visibleData, (d) => d.n_reviews) || 1]).nice();

        // Atualiza os eixos X e Y com transição suave, aplicando formatação de data ao eixo X
        axisX.transition().duration(400).call(d3.axisBottom(x).ticks(6).tickFormat(d3.timeFormat(zoomDomain ? '%b %Y' : '%Y')));
        axisY.transition().duration(400).call(d3.axisLeft(y).ticks(4));

        // Atualiza a área e a linha do gráfico com transição suave, aplicando preenchimento e cor de acordo com o tema
        const areaPath = areaG.selectAll('path.fill').data([lastData]);
        areaPath.enter().append('path').attr('class', 'fill')
            .merge(areaPath)
            .attr('fill', 'var(--accent-teal)')
            .attr('fill-opacity', 0.35)
            .transition().duration(400)
            .attr('d', area);

        // Atualiza a linha do gráfico com transição suave, aplicando cor e largura de acordo com o tema
        const linePath = areaG.selectAll('path.line').data([lastData]);
        linePath.enter().append('path').attr('class', 'line')
            .merge(linePath)
            .attr('fill', 'none')
            .attr('stroke', 'var(--accent-teal)')
            .attr('stroke-width', 1.6)
            .transition().duration(400)
            .attr('d', line);

        // Mostra ou esconde o botão de zoom out dependendo se há um zoom ativo
        zoomOutBtn.style('display', zoomDomain ? null : 'none');
        if (zoomDomain) zoomOutBtn.raise();
    }

    // Função para atualizar a timeline com novos dados, aplicando o filtro global e o zoom visual
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