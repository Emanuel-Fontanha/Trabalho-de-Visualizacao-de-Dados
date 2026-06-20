import { loadDb } from './config.js';

// Faixas de preço fixas usadas no histograma. Ficam fixas (em vez de
// recalculadas a cada filtro) para que o eixo X do histograma não "pule"
// quando o usuário aplica um filtro — só a altura das barras muda.
export const PRICE_BINS = [
    { min: 0, max: 100, label: '0–100' },
    { min: 100, max: 200, label: '100–200' },
    { min: 200, max: 300, label: '200–300' },
    { min: 300, max: 500, label: '300–500' },
    { min: 500, max: 750, label: '500–750' },
    { min: 750, max: 1000, label: '750–1.000' },
    { min: 1000, max: 1500, label: '1.000–1.500' },
    { min: 1500, max: 2500, label: '1.500–2.500' },
    { min: 2500, max: Infinity, label: '2.500+' },
];

// Monta a cláusula WHERE compartilhada por (quase) todas as consultas, a
// partir do objeto de filtros guardado em state.js. É uma função pura (não
// depende de `this`) para poder ser reaproveitada em qualquer consulta sem
// duplicar a lógica de cada filtro.
//
// filters = {
//   priceRange: [min, max] | null   -> filtro "what" (faixa de preço)
//   bbox: {lonMin,lonMax,latMin,latMax} | null -> filtro "where" (região do mapa)
//   dateRange: [isoStart, isoEnd] | null -> filtro "when" (intervalo de datas)
// }
//
// Importante: cada consulta decide quais desses filtros aplicar. Por
// exemplo, o histograma de preço NÃO aplica o próprio priceRange (senão o
// usuário nunca veria as barras fora do intervalo já selecionado), e a
// timeline de reviews NÃO aplica o próprio dateRange pelo mesmo motivo.
export function buildWhereClause(filters = {}) {
    const clauses = ['1=1'];

    if (filters.priceRange) {
        const [min, max] = filters.priceRange;
        clauses.push(`l.price BETWEEN ${Number(min)} AND ${Number(max)}`);
    }

    if (filters.bbox) {
        const { lonMin, lonMax, latMin, latMax } = filters.bbox;
        clauses.push(`l.longitude BETWEEN ${Number(lonMin)} AND ${Number(lonMax)}`);
        clauses.push(`l.latitude BETWEEN ${Number(latMin)} AND ${Number(latMax)}`);
    }

    if (filters.dateRange) {
        const [start, end] = filters.dateRange;
        // "o imóvel teve pelo menos uma review nesse intervalo" — é assim que
        // o filtro de tempo (when) se propaga para o mapa e o histograma
        // (que não têm, eles mesmos, nenhuma noção de tempo).
        clauses.push(`EXISTS (
            SELECT 1 FROM reviews_clean AS r
            WHERE r.listing_id = l.listing_id
              AND r.date_parsed BETWEEN DATE '${start}' AND DATE '${end}'
        )`);
    }

    return clauses.join(' AND ');
}

// DataLoader: carrega Listings/Reviews (amostra de Rio de Janeiro) no
// DuckDB-WASM e expõe as consultas que cada view (mapa, timeline, histograma,
// detalhes) precisa. Mantemos toda a lógica de agregação em SQL — o D3 só
// recebe linhas já prontas para desenhar.
export class DataLoader {
    async init() {
        this.db = await loadDb();
        this.conn = await this.db.connect();
    }

    // Lê os CSVs (servidos estaticamente pela pasta public/ do Vite — por
    // isso o caminho NÃO leva o prefixo "/public") e cria as tabelas/views
    // tratadas. Os parâmetros default apontam para a amostra de Rio de
    // Janeiro gerada a partir do dataset original (ver README do projeto).
    async loadAirbnb(listingsPath = '/Airbnb Data/Listings.csv', reviewsPath = '/Airbnb Data/Reviews.csv') {
        if (!this.db || !this.conn) throw new Error('Banco não inicializado. Chame init() primeiro.');

        const [r1, r2] = await Promise.all([fetch(listingsPath), fetch(reviewsPath)]);
        if (!r1.ok) throw new Error(`Falha ao buscar ${listingsPath} (${r1.status})`);
        if (!r2.ok) throw new Error(`Falha ao buscar ${reviewsPath} (${r2.status})`);

        const [buf1, buf2] = await Promise.all([r1.arrayBuffer(), r2.arrayBuffer()]);
        await this.db.registerFileBuffer('Listings.csv', new Uint8Array(buf1));
        await this.db.registerFileBuffer('Reviews.csv', new Uint8Array(buf2));

        // SAMPLE_SIZE=-1 faz o DuckDB ler o arquivo inteiro antes de decidir o
        // tipo de cada coluna (em vez de só as primeiras linhas). Sem isso,
        // colunas como review_scores_rating — que têm muitos nulos no início
        // do arquivo amostrado — podiam ser inferidas como tipo errado.
        await this.conn.query(`
            CREATE OR REPLACE TABLE listings_raw AS
            SELECT * FROM read_csv_auto('Listings.csv', SAMPLE_SIZE=-1);
        `);

        await this.conn.query(`
            CREATE OR REPLACE TABLE reviews_raw AS
            SELECT * FROM read_csv_auto('Reviews.csv', SAMPLE_SIZE=-1);
        `);

        // listings_clean: tipos numéricos garantidos via TRY_CAST (nunca
        // quebra a query, só vira NULL se o valor for inválido) e somente
        // linhas com coordenadas e preço utilizáveis — é o que os mapas e
        // agregações precisam.
        //
        // Nota sobre o preço: o CAST para VARCHAR antes do REPLACE existe
        // porque o DuckDB às vezes já infere a coluna "price" como número
        // (BIGINT) direto do CSV; chamar REPLACE em um número quebraria a
        // query. Convertendo para VARCHAR primeiro a query funciona nos dois
        // casos (preço já numérico ou preço como "$1,234").
        await this.conn.query(`
            CREATE OR REPLACE VIEW listings_clean AS
            SELECT
                listing_id,
                name,
                neighbourhood,
                district,
                city,
                property_type,
                room_type,
                accommodates,
                bedrooms,
                TRY_CAST(REPLACE(REPLACE(CAST(price AS VARCHAR), '$', ''), ',', '') AS DOUBLE) AS price,
                minimum_nights,
                maximum_nights,
                TRY_CAST(latitude AS DOUBLE) AS latitude,
                TRY_CAST(longitude AS DOUBLE) AS longitude,
                TRY_CAST(review_scores_rating AS DOUBLE) AS review_scores_rating,
                TRY_CAST(review_scores_accuracy AS DOUBLE) AS review_scores_accuracy,
                TRY_CAST(review_scores_cleanliness AS DOUBLE) AS review_scores_cleanliness,
                TRY_CAST(review_scores_checkin AS DOUBLE) AS review_scores_checkin,
                TRY_CAST(review_scores_communication AS DOUBLE) AS review_scores_communication,
                TRY_CAST(review_scores_location AS DOUBLE) AS review_scores_location,
                TRY_CAST(review_scores_value AS DOUBLE) AS review_scores_value,
                host_id,
                host_since,
                host_is_superhost,
                host_identity_verified,
                instant_bookable
            FROM listings_raw
            WHERE TRY_CAST(latitude AS DOUBLE) IS NOT NULL
              AND TRY_CAST(longitude AS DOUBLE) IS NOT NULL
              AND TRY_CAST(REPLACE(REPLACE(CAST(price AS VARCHAR), '$', ''), ',', '') AS DOUBLE) IS NOT NULL;
        `);

        // reviews_clean: listing_id convertido para BIGINT para casar com
        // listings_clean.listing_id mesmo que o CSV de origem traga o campo
        // entre aspas (string). Sem esse cast o JOIN/EXISTS usado no filtro
        // "when" simplesmente não bate nenhuma linha.
        await this.conn.query(`
            CREATE OR REPLACE VIEW reviews_clean AS
            SELECT
                TRY_CAST(listing_id AS BIGINT) AS listing_id,
                review_id,
                TRY_CAST(date AS DATE) AS date_parsed
            FROM reviews_raw
            WHERE TRY_CAST(listing_id AS BIGINT) IS NOT NULL;
        `);
    }

    // Executa SQL arbitrário e devolve um array de objetos JS simples.
    async query(sql) {
        if (!this.db || !this.conn) throw new Error('Banco não inicializado. Chame init() primeiro.');
        const res = await this.conn.query(sql);
        // O Arrow (formato interno do DuckDB-WASM) devolve inteiros de 64 bits
        // como BigInt. Isso quebra contas simples e escalas do D3
        // (`+BigInt` lança TypeError), então convertemos para Number aqui,
        // uma única vez, em vez de cada view ter que lembrar de fazer isso.
        return res.toArray().map((row) => {
            const obj = row.toJSON();
            for (const key in obj) {
                if (typeof obj[key] === 'bigint') obj[key] = Number(obj[key]);
            }
            return obj;
        });
    }

    // --- Consultas usadas pelas views coordenadas -------------------------

    // Pontos para o mapa (where). Aplica TODOS os filtros ativos, exceto o
    // próprio bbox (senão um brush no mapa nunca poderia ser "expandido").
    async listingsForMap(filters = {}) {
        const where = buildWhereClause({ priceRange: filters.priceRange, dateRange: filters.dateRange });
        const sql = `
            SELECT listing_id, name, neighbourhood, room_type, property_type,
                   latitude, longitude, price, review_scores_rating
            FROM listings_clean AS l
            WHERE ${where};
        `;
        return this.query(sql);
    }

    // Contagem de listings por faixa de preço x room_type (what). Não aplica
    // o próprio priceRange, pelo motivo explicado em buildWhereClause.
    async priceHistogram(filters = {}) {
        const where = buildWhereClause({ bbox: filters.bbox, dateRange: filters.dateRange });
        const caseLines = PRICE_BINS.map((b) =>
            b.max === Infinity
                ? `WHEN l.price >= ${b.min} THEN '${b.label}'`
                : `WHEN l.price >= ${b.min} AND l.price < ${b.max} THEN '${b.label}'`
        ).join('\n                ');

        const sql = `
            SELECT
                CASE
                ${caseLines}
                END AS bin_label,
                l.room_type,
                COUNT(*) AS n
            FROM listings_clean AS l
            WHERE ${where} AND l.price IS NOT NULL
            GROUP BY bin_label, l.room_type;
        `;
        return this.query(sql);
    }

    // Série mensal de reviews (when). Não aplica o próprio dateRange — a
    // timeline sempre mostra a linha do tempo inteira, e o brush é só uma
    // seleção visual sobre ela.
    async reviewsTimeSeries(filters = {}) {
        const where = buildWhereClause({ priceRange: filters.priceRange, bbox: filters.bbox });
        const sql = `
            SELECT TO_CHAR(r.date_parsed, 'YYYY-MM') AS month, COUNT(*) AS n_reviews
            FROM reviews_clean AS r
            JOIN listings_clean AS l ON l.listing_id = r.listing_id
            WHERE r.date_parsed IS NOT NULL AND ${where}
            GROUP BY month
            ORDER BY month;
        `;
        return this.query(sql);
    }

    // Estatísticas agregadas do conjunto filtrado atual — usado no resumo
    // ("X imóveis, preço médio R$ Y") e como estado "overview" do painel de
    // detalhes quando nada está selecionado.
    async summaryStats(filters = {}) {
        const where = buildWhereClause(filters);
        const sql = `
            SELECT COUNT(*) AS n_listings,
                   AVG(l.price) AS avg_price,
                   AVG(l.review_scores_rating) AS avg_rating
            FROM listings_clean AS l
            WHERE ${where};
        `;
        const rows = await this.query(sql);
        return rows[0];
    }

    // Top-N bairros do conjunto filtrado atual — também alimenta o estado
    // "overview" do painel de detalhes.
    async topNeighbourhoods(filters = {}, limit = 5) {
        const where = buildWhereClause(filters);
        const sql = `
            SELECT l.neighbourhood, COUNT(*) AS n_listings, AVG(l.price) AS avg_price
            FROM listings_clean AS l
            WHERE ${where}
            GROUP BY l.neighbourhood
            ORDER BY n_listings DESC
            LIMIT ${Number(limit)};
        `;
        return this.query(sql);
    }

    // Detalhes completos de um único listing (details on demand).
    async listingDetails(listingId) {
        const sql = `
            SELECT *
            FROM listings_clean
            WHERE listing_id = ${Number(listingId)}
            LIMIT 1;
        `;
        const rows = await this.query(sql);
        return rows[0] || null;
    }
}