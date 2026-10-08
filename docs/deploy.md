# Deploy em produção — passo a passo

Este guia leva o CRM Lava Jato para a internet (Vercel + banco Neon), sem precisar ser programador. Tempo estimado: 1 a 2 horas na primeira vez.

> Os nomes de botões e menus dos sites (GitHub, Neon, Vercel) mudam de vez em quando. Se algo estiver com outro nome, procure o equivalente. As decisões técnicas por trás disto estão em `docs/decisoes.md` (D-27, D-41 a D-46).

## Visão geral

| Peça | Serve para | Custo |
| --- | --- | --- |
| **GitHub** | Guarda o código (repositório **privado**). A Vercel lê daqui. | Grátis |
| **Neon** | Banco de dados PostgreSQL (onde ficam clientes, atendimentos, caixa). | Plano gratuito |
| **Vercel** | Coloca o sistema no ar com HTTPS. | Plano gratuito (uso pessoal) |

Fluxo: você envia o código ao GitHub -> a Vercel constrói o sistema e **aplica sozinha as migrations (criação das tabelas) no Neon** -> você cria o usuário de acesso -> testa.

## Variáveis de ambiente (resumo)

| Variável | Onde fica | O que colocar |
| --- | --- | --- |
| `DATABASE_URL` | Vercel | URL **pooled** da Neon (o endereço tem `-pooler`). O sistema usa esta no dia a dia. |
| `DIRECT_URL` | Vercel **e** GitHub (secret) | URL **direta** da Neon (mesmo endereço **sem** `-pooler`). Usada só para criar/atualizar tabelas, criar usuário e backup. |
| `AUTH_SECRET` | Vercel | Texto aleatório com 32+ caracteres (gerado no passo 3.3). **Nunca** reutilize o de desenvolvimento. |
| `DB_POOL_MAX` | Vercel (opcional) | Deixe em branco (padrão 5). |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | GitHub (secrets) **ou** digitados no terminal na hora | Dados do usuário de acesso. `ADMIN_NAME` é opcional. A senha precisa de 12+ caracteres. |

Não são necessárias `SEED_USER_*` (são só do computador de desenvolvimento).

---

## 1. GitHub (guardar o código)

1. Crie a conta em <https://github.com> (se ainda não tiver).
2. Clique em **New repository**. Nome sugerido: `crm-lava-jato`. Marque **Private** (privado). Não marque "Add a README".
3. No computador, na pasta do projeto, abra o terminal e envie o código (troque `SEU-USUARIO`):

   ```
   git remote add origin https://github.com/SEU-USUARIO/crm-lava-jato.git
   git branch -M main
   git push -u origin main
   ```

   Confirme, na página do repositório, que **não** aparecem arquivos `.env` nem `dev.db` (eles são ignorados de propósito; só `.env.example` deve aparecer).

## 2. Neon (banco de dados)

1. Crie a conta em <https://neon.tech> (pode entrar com o GitHub).
2. **Create project**: nome `crm-lava-jato`. Em **Region**, escolha **AWS South America (São Paulo) — sa-east-1**, se disponível (fica mais rápido para você). Se não existir, escolha a mais próxima (ex.: US East).
3. Na tela do projeto, clique em **Connect** (Conectar). Você verá uma caixa com o endereço do banco:
   - Deixe marcada a opção **Connection pooling** e copie o endereço -> esta é a `DATABASE_URL`. Ele tem `-pooler` no meio e começa com `postgresql://`.
   - **Desmarque** *Connection pooling* e copie de novo -> esta é a `DIRECT_URL` (sem `-pooler`).
4. Guarde as duas em um bloco de notas **temporário** (elas contêm a senha do banco). Não envie a ninguém, não coloque no GitHub.

## 3. Vercel (colocar no ar)

### 3.1 Importar o projeto
1. Crie a conta em <https://vercel.com> entrando com o GitHub.
2. **Add New… > Project** e escolha o repositório `crm-lava-jato` (autorize a Vercel a ler o repositório se pedir).
3. **Framework Preset**: *Next.js* (já vem detectado). **Não mude** o Build Command: o projeto tem um script próprio (`vercel-build`) que gera os arquivos, aplica as migrations no Neon e compila.
   - Se quiser conferir: Build Command deve estar em branco/padrão. (Equivale a `npm run vercel-build`.)

### 3.2 Região das funções (velocidade)
Em **Settings > Functions > Function Region**, escolha **São Paulo, Brazil (gru1)** para ficar perto do banco em sa-east-1. (Se o banco ficou em outra região, escolha a região da Vercel mais próxima dele.)

### 3.3 Variáveis de ambiente
Na tela de importação (seção **Environment Variables**) ou depois em **Settings > Environment Variables**, cadastre para **Production**:

1. `DATABASE_URL` = a URL **pooled** copiada da Neon.
2. `DIRECT_URL` = a URL **direta** copiada da Neon.
3. `AUTH_SECRET` = um texto aleatório. Para gerar, no terminal do computador:

   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

   Copie o resultado (mais de 40 caracteres) e cole. Se você perder esse valor não há problema: basta gerar outro (todos precisarão fazer login de novo).

Nunca use o valor de exemplo do `.env.example`: o sistema recusa iniciar em produção com ele.

### 3.4 Deploy
Clique em **Deploy**. Acompanhe o log: você deve ver `Applying migration ...` e `All migrations have been successfully applied`, e no fim `Build Completed`. Se aparecer erro, veja a seção "Se algo der errado".

O endereço provisório será algo como `crm-lava-jato.vercel.app`.

## 4. Criar o usuário de acesso (uma vez)

O sistema nasce sem nenhum usuário. Escolha **uma** das opções.

### Opção A — pelo GitHub (não instala nada)
1. No repositório: **Settings > Secrets and variables > Actions > New repository secret**. Crie:
   - `DIRECT_URL` = a URL direta da Neon;
   - `ADMIN_EMAIL` = seu e-mail de acesso;
   - `ADMIN_PASSWORD` = senha nova, **12+ caracteres**, sem ser algo óbvio (ex.: uma frase: `cafe com leite 2026`). Senhas como `admin123` são recusadas.
   - `ADMIN_NAME` (opcional) = seu nome.
2. Aba **Actions > Criar usuário de produção > Run workflow**. Deve terminar em verde e mostrar `Usuário "..." criado.`
3. Se a senha for recusada, o log explica o motivo; troque o secret e rode de novo.
4. Depois de criado, apague os secrets `ADMIN_*` se quiser (mantenha `DIRECT_URL` para o backup).

Para **trocar a senha** no futuro: altere o secret `ADMIN_PASSWORD` e rode o workflow de novo (rodar de novo nunca duplica o usuário; só atualiza).

### Opção B — no seu computador
Requer Node 22 e o projeto baixado (`npm install`). Crie o arquivo `.env.production.local` na pasta do projeto com **duas linhas** (ele é ignorado pelo git; nunca envie):

```
DATABASE_URL="(URL pooled)"
DIRECT_URL="(URL direta)"
```

Depois, no PowerShell (a senha é digitada aqui, não fica em arquivo):

```
$env:ADMIN_EMAIL = "voce@exemplo.com"
$env:ADMIN_PASSWORD = "cafe com leite 2026"
npm run db:seed:prod
Remove-Item Env:ADMIN_PASSWORD
```

Deve aparecer `Usuário "..." criado.` e o host do banco Neon (sem senha) na linha `[run-prod] banco:`.

## 5. Domínio próprio (opcional)

1. Compre/tenha um domínio (Registro.br, GoDaddy etc.).
2. Vercel: **Settings > Domains > Add** e digite o domínio (ex.: `sistema.meulavajato.com.br`).
3. A Vercel mostra o(s) registro(s) DNS a criar (um `CNAME` para subdomínio, ou `A` para o domínio raiz). Crie exatamente o que ela mostrar no painel do seu registrador. Pode levar de minutos a algumas horas.
4. O certificado HTTPS é emitido automaticamente pela Vercel.

## 6. Teste de fumaça (depois de cada deploy importante)

Abra o endereço no celular e no computador:

1. O endereço abre com **cadeado (HTTPS)**; abrir a raiz sem login leva para `/login`.
2. Entre com o e-mail e a senha do passo 4. Deve abrir o painel.
3. Cadastre um cliente **"Teste Deploy"** com um veículo.
4. Cadastre um serviço (ou use um existente) e crie um **atendimento** para o cliente teste.
5. Conclua com pagamento em Pix. Confira em **Caixa** que a entrada apareceu.
6. Estorne o pagamento e cancele o atendimento de teste; inative/exclua o cliente teste.
7. Saia e entre de novo (a sessão funciona).
8. Erro de senha: tente entrar com um e-mail **inexistente** (ex.: `nao@existe.com`) 6 vezes: na 6ª deve aparecer "Muitas tentativas…". (Não faça isso com o seu e-mail real: bloqueia a sua conta por 15 minutos.)

## 7. Backup e restauração

Duas camadas independentes. Faça as duas.

### 7.1 Neon — voltar no tempo (primeira linha de defesa)
A Neon guarda o histórico do banco e permite restaurar para um instante anterior (ex.: "5 minutos antes de eu apagar tudo por engano"). A **janela de histórico depende do plano** (no gratuito é curta — confira em *Settings > Storage/Backup & Restore* do projeto).

Para usar: no painel do projeto, **Backup & Restore** (ou *Restore*) > escolha data/hora > **Restore**. Recomendado: restaurar para uma **nova branch** e conferir os dados antes de trocar (veja 7.4).

### 7.2 Backup próprio (cópia fora da Neon) — GitHub Actions
O arquivo `.github/workflows/backup.yml` gera um backup **todos os dias às 03:00 (Brasília)** e guarda por 30 dias (aba **Actions > Backup do banco > run > Artifacts**). Requisitos: o secret `DIRECT_URL` (passo 4A). Para testar agora: **Actions > Backup do banco > Run workflow**.

Se um dia a Neon atualizar a versão do Postgres, mude `PG_VERSION` no arquivo para a versão nova (deve ser igual ou maior que a do banco).

Atenção: o backup contém dados de clientes. O repositório é privado, mas trate o arquivo baixado como dado sensível; apague depois de usar.

### 7.3 Backup manual no computador (opcional)
Requer o `pg_dump` (instale o "PostgreSQL" e marque só *Command Line Tools*). Com o `.env.production.local` do passo 4B:

```
npm run db:backup
```

Cria `backups/crm-AAAA-MM-DDTHH-MM-SS.dump` (a pasta é ignorada pelo git). Sem `pg_dump` o script avisa e não faz nada.

### 7.4 Restauração (teste isto uma vez, ANTES de precisar)
Nunca restaure "por cima" do banco em uso na primeira tentativa. Faça em um banco separado:

1. Neon: crie um projeto novo `crm-restore-teste` (ou uma *branch*). Copie a URL **direta** dele.
2. Baixe o arquivo `crm.dump` do artifact do GitHub (ou use um `.dump` do passo 7.3) e descompacte o zip.
3. Restaure (precisa do `pg_restore`, junto com o `pg_dump`):

   ```
   pg_restore --no-owner --no-privileges --clean --if-exists -d "URL-DIRETA-DO-BANCO-DE-TESTE" crm.dump
   ```

   Avisos do tipo "does not exist, skipping" em banco vazio são normais.
4. Confira no **SQL Editor** do Neon (banco de teste): `select count(*) from "ServiceOrder";` e `select count(*) from "Customer";` — os números devem bater com os do sistema.
5. Se for uma restauração de verdade (banco de produção danificado): em vez de testar, aponte a produção para o banco restaurado — na Vercel troque `DATABASE_URL` e `DIRECT_URL` pelas URLs do banco restaurado (**Settings > Environment Variables**), faça **Redeploy** e rode o teste de fumaça. Mantenha o banco antigo até ter certeza.
6. Ao terminar o teste, apague o projeto `crm-restore-teste`.

Restauração testada em **04/10/2026** (restore da Neon sobre a produção, ainda sem dados reais: login e categorias sobreviveram; branch `production_old` apagada). **Repetir com dados reais** (para uma branch nova, comparando as contagens de `Customer`, `ServiceOrder` e `CashEntry`) depois da primeira semana de uso.

## 8. Atualizações futuras

Cada `git push` na branch `main` gera um novo deploy: a Vercel compila, aplica migrations novas (se houver) e publica. Se a migration ou o build falhar, **a versão anterior continua no ar**.

## 9. Se algo der errado

| Sintoma | O que fazer |
| --- | --- |
| Build falha: "DATABASE_URL ausente…", "DIRECT_URL ausente…" ou "AUTH_SECRET ausente…" | Falta cadastrar a variável em **Settings > Environment Variables** (ambiente *Production*) e fazer **Redeploy**. |
| Build falha em `prisma migrate deploy` (timeout / "can't reach database") | `DIRECT_URL` errada ou banco da Neon "dormindo": abra o painel da Neon, espere ~10 s e faça Redeploy. Confirme que `DIRECT_URL` **não** tem `-pooler`. |
| Site abre mas dá erro 500 / "Application error" | Vercel > **Logs** do deploy. Causas comuns: `DATABASE_URL` errada; falta `?sslmode=require` no fim da URL; `AUTH_SECRET` fraco. |
| "AUTH_SECRET ... recusado" | O segredo é o de exemplo ou tem menos de 32 caracteres. Gere outro (passo 3.3) e faça Redeploy. |
| Não consigo entrar (senha certa) | Aguarde 15 min se errou 5 vezes seguidas. Ou redefina a senha rodando de novo o passo 4 com outra senha. |
| Esqueci a senha | Passo 4 de novo com a nova senha (atualiza o usuário existente). |
| Primeira requisição lenta | Normal: o banco gratuito "dorme" quando fica parado e leva alguns segundos para acordar. |
| Deploy novo deu problema | Vercel > **Deployments** > escolha o deploy anterior bom > **Promote to Production** (volta a versão do código; o banco não volta — para isso use 7.1/7.4). |
| Apaguei dados por engano | 7.1 (voltar no tempo na Neon) ou 7.4 (restaurar backup). Não faça novas alterações no sistema enquanto decide. |
| Vazou uma URL/senha do banco | Neon: **Roles > Reset password**; atualize `DATABASE_URL`/`DIRECT_URL` na Vercel e o secret no GitHub; Redeploy. |

## 10. Checklist final

- [ ] Repositório GitHub **privado**; sem `.env`/`.env.production.local`/`dev.db` nele.
- [ ] Projeto Neon criado (região São Paulo, se possível); duas URLs anotadas em local seguro.
- [ ] Vercel: `DATABASE_URL` (pooled), `DIRECT_URL` (direta) e `AUTH_SECRET` (novo, 32+ caracteres) cadastradas em *Production*.
- [x] Function Region da Vercel próxima ao banco.
- [ ] Deploy verde; log mostra migrations aplicadas.
- [ ] Usuário criado (passo 4) com senha forte que **não** é a de desenvolvimento.
- [ ] Site abre por HTTPS; `/login` funciona; sem login a raiz redireciona.
- [x] Teste de fumaça (passo 6) concluído e dados de teste removidos.
- [ ] Bloqueio após 5 erros de senha verificado (com e-mail inexistente).
- [x] Backup diário do GitHub rodou ao menos uma vez com sucesso (**Run workflow** manual).
- [x] **Restauração testada uma vez** (passo 7.4) e data anotada.
- [ ] Domínio próprio configurado e com HTTPS (se aplicável).
- [x] Ícone "Adicionar à tela inicial" testado no celular (parte do frontend).
