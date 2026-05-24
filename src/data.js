import { loadDb } from './config.js';
// classe para gerenciar o DuckDB WASM, carregar dados e executar consultas
export class DataLoader {
    async init() {
        this.db = await loadDb();
        this.conn = await this.db.connect();
        this.table = 'sales';
  }

    // carrega o CSV único (ou vários arquivos) para o FS virtual e cria tabela
    async loadCSV(path = '/data.csv') {
        if (!this.db || !this.conn) throw new Error('Banco de dados não inicializado. Chame init() primeiro.');

        const resp = await fetch(path);
        const buf = new Uint8Array(await resp.arrayBuffer());
        // registra com uma chave (nome) qualquer
        await this.db.registerFileBuffer('data.csv', buf);

        await this.conn.query(`
            CREATE TABLE ${this.table} AS
            SELECT * FROM read_csv_auto('data.csv');
            `);
    }

    // função genérica para executar consultas SQL e retornar resultados como array de objetos
    async query(sql) {
        if (!this.db || !this.conn) throw new Error('Banco de dados não inicializado. Chame init() primeiro.');
        const res = await this.conn.query(sql);
        // segue o padrão do professor: toArray() e converter para JSON
        return res.toArray().map(r => r.toJSON());
    }

    // exemplo: agregação por ano e tipo (igual ao que precisa para o gráfico)
    async aggregatedByYearType() {
        const sql = `
            SELECT ano, tipo, SUM(valor) AS valor
            FROM ${this.table}
            GROUP BY ano, tipo
            ORDER BY ano, tipo;
            `;
        return this.query(sql);
    }
}
