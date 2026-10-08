// Executa UM comando SQL no Postgres de teste (usado por e2e/orders-helpers.ts quando E2E_PG_URL existe).
// Entrada (stdin): JSON { url, sql, params }. Saída (stdout): JSON com as linhas. Síncrono para o chamador
// via execFileSync (os helpers de banco dos e2e são síncronos).
import pg from "pg";

const { Client } = pg;

let input = "";
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", async () => {
  const { url, sql, params } = JSON.parse(input);
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    const res = await client.query(sql, params);
    process.stdout.write(JSON.stringify(res.rows ?? []));
  } catch (e) {
    console.error(`${e.message}\nSQL: ${sql}`);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
});
