import { DataLoader } from './data.js';

// função para criar tabela HTML a partir de dados (array de objetos)
function createTableWithInnerHTML(data) {
  // verifica se há dados e cria tabela HTML dinamicamente
  if (!data || data.length === 0) return;

  // criar cabeçalho da tabela com base nas chaves do primeiro objeto
  let tableHTML = '<table border="1"><tr>';

  // usar as chaves do primeiro objeto para criar os cabeçalhos da tabela
  Object.keys(data[0]).forEach((k) => (tableHTML += `<th>${k}</th>`));

  // fechar a linha do cabeçalho
  tableHTML += '</tr>';

  // preencher linhas da tabela
  data.forEach((row) => {
    tableHTML += '<tr>';
    Object.values(row).forEach((v) => (tableHTML += `<td>${v}</td>`));
    tableHTML += '</tr>';
  });

  //fecha o gráfico quando estiver completo
  tableHTML += '</table>';

  // inserir a tabela no div com id "table"
  const div = document.querySelector('#table');

  // verificar se o div existe antes de inserir a tabela
  if (div) div.innerHTML = tableHTML;
}

// função para desenhar gráfico de linhas usando D3 a partir dos dados agregados
function drawChart(data) {
  // configuração do SVG e margens
  const svg = d3.select('svg');
  const margin = { top: 20, right: 80, bottom: 40, left: 50 };
  const width = +svg.attr('width') - margin.left - margin.right;
  const height = +svg.attr('height') - margin.top - margin.bottom;

  // limpar gráfico anterior
  svg.selectAll('*').remove();

  // criar grupo para o gráfico com margens
  const g = svg
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  // garantir tipos numéricos (agregação do DuckDB já deve dar números, mas por segurança)
  const toNumber = (v) =>
    typeof v === 'bigint' ? Number(v) : v == null ? NaN : +v;

  // converter os dados para o formato esperado e filtrar valores inválidos
  data = data
    .map((d) => ({
      ano: toNumber(d.ano),
      tipo: d.tipo,
      valor: toNumber(d.valor),
    }))
    .filter((d) => !isNaN(d.ano) && !isNaN(d.valor));

  // agrupar por tipo para desenhar linhas separadas
  const grouped = d3.group(data, (d) => d.tipo);
  const x = d3
    .scaleLinear()
    .domain(d3.extent(data, (d) => d.ano))
    .range([0, width]);
  const yMin = 0;
  const yMax = d3.max(data, (d) => d.valor) + 0.5;
  const y = d3.scaleLinear().domain([yMin, yMax]).nice().range([height, 0]);
  const color = d3
    .scaleOrdinal()
    .domain(Array.from(grouped.keys()))
    .range(['#e74c3c', '#2c3e50', '#1f77b4', '#ff7f0e']);

  // eixos
  g.append('g')
    .attr('transform', `translate(0,${height})`)
    .call(d3.axisBottom(x).tickFormat(d3.format('d')));

  // rótulo do eixo X
  g.append('g').call(d3.axisLeft(y));
  // rótulo do eixo Y
  g.append('text')
    .attr('transform', `rotate(-90)`)
    .attr('x', -height / 2)
    .attr('y', -margin.left + 15)
    .attr('text-anchor', 'middle')
    .attr('fill', '#000')
    .text('% de vendas');

  // linha para cada tipo
  const line = d3
    .line()
    .x((d) => x(d.ano))
    .y((d) => y(d.valor));

  // iterar sobre cada grupo (tipo) e desenhar a linha correspondente
  for (const [key, values] of grouped) {
    values.sort((a, b) => a.ano - b.ano);
    g.append('path')
      .datum(values)
      .attr('fill', 'none')
      .attr('stroke', color(key))
      .attr('stroke-width', 2)
      .attr('d', line);
    const last = values[values.length - 1];
    g.append('text')
      .attr('x', x(last.ano) + 5)
      .attr('y', y(last.valor))
      .text(key === 'conversation_hearts' ? 'Hearts' : key)
      .style('font-size', '12px')
      .style('fill', color(key));
  }
}

// função principal para inicializar o DataLoader, carregar dados, executar consulta e desenhar gráfico
async function main() {
  const loader = new DataLoader();
  await loader.init();
  await loader.loadCSV('/data.csv'); // data.csv deve estar na pasta public/ para ser acessível via fetch

  // expõe o loader e a função de desenho para depuração no console
  window.loader = loader;
  window.drawChart = drawChart;

  // consulta de agregação por ano e tipo (igual ao que precisa para o gráfico)
  const agg = await loader.aggregatedByYearType();
  drawChart(agg);
  console.log(agg);

  // expõe a função de criação de tabela para depuração no console
  window.createTableWithInnerHTML = createTableWithInnerHTML;

  createTableWithInnerHTML(agg);
}

window.onload = main;
window.drawChart = drawChart;
