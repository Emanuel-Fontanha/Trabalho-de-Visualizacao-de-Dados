d3.csv("/data.csv").then(function (data) {
	// Converter tipos
	data.forEach((d) => {
		d.ano = +d.ano;
		d.valor = +d.valor;
	});

	const svg = d3.select("svg"),
		margin = { top: 20, right: 80, bottom: 40, left: 50 },
		width = +svg.attr("width") - margin.left - margin.right,
		height = +svg.attr("height") - margin.top - margin.bottom;

	const g = svg
		.append("g")
		.attr("transform", `translate(${margin.left},${margin.top})`);

	const grouped = d3.group(data, (d) => d.tipo);

	const x = d3
		.scaleLinear()
		.domain(d3.extent(data, (d) => d.ano))
		.range([0, width]);

	const y = d3
		.scaleLinear()
		.domain([8, d3.max(data, (d) => d.valor)])
		.range([height, 0]);

	const color = d3
		.scaleOrdinal()
		.domain(["conversation_hearts", "chocolates"])
		.range(["#e74c3c", "#2c3e50"]);

	g.append("g")
		.attr("transform", `translate(0,${height})`)
		.call(d3.axisBottom(x).tickFormat(d3.format("d")));

	g.append("g").call(d3.axisLeft(y));

	const line = d3
		.line()
		.x((d) => x(d.ano))
		.y((d) => y(d.valor));

	grouped.forEach((values, key) => {
		values.sort((a, b) => a.ano - b.ano);

		g.append("path")
			.datum(values)
			.attr("fill", "none")
			.attr("stroke", color(key))
			.attr("stroke-width", 2)
			.attr("d", line);

		const last = values[values.length - 1];

		g.append("text")
			.attr("x", x(last.ano) + 5)
			.attr("y", y(last.valor))
			.text(key === "conversation_hearts" ? "Hearts" : "Chocolates")
			.style("font-size", "12px")
			.style("fill", color(key));
	});
});
