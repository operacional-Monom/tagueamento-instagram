const puppeteer = require('puppeteer');
const fs = require('fs');
const readline = require('readline');

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// Processa UMA conta — abre aba, verifica e fecha
// ============================================================
async function verificarConta(browser, nomeConta, alvoPrincipal, nomeArquivoRelatorio) {
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36");

    try {
        // Navega para o perfil e aguarda o header aparecer (sem delay fixo)
        await page.goto(`https://www.instagram.com/${nomeConta}/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForSelector('header', { timeout: 8000 }).catch(() => null);

        const existe = await page.$('header');
        if (!existe) throw new Error("Página não encontrada.");

        // Verifica botão de "Seguindo"
        const followingLink = await page.$(`a[href="/${nomeConta}/following/"]`);
        if (!followingLink) {
            const texto = `[ PRIVADA/INEXISTENTE ] @${nomeConta}`;
            console.log(texto);
            fs.appendFileSync(nomeArquivoRelatorio, texto + "\n");
            return;
        }

        // Abre o modal de seguindo e espera ele aparecer
        await followingLink.click();
        await page.waitForSelector('div[role="dialog"]', { timeout: 10000 });
        await delay(1500); // Deixa o modal renderizar

        // Espera o input de busca aparecer dentro do dialog
        await page.waitForSelector('div[role="dialog"] input[type="text"]', { timeout: 8000 });
        const searchInput = await page.$('div[role="dialog"] input[type="text"]');

        if (!searchInput) {
            const texto = `[ ERRO ] Barra de busca não encontrada em @${nomeConta}.`;
            console.log(texto);
            fs.appendFileSync(nomeArquivoRelatorio, texto + "\n");
            return;
        }

        // Limpa o campo e digita o alvo
        await searchInput.click({ clickCount: 3 });
        await page.keyboard.press('Backspace');
        await delay(400);
        await searchInput.type(alvoPrincipal, { delay: 80 });

        // Aguarda os resultados carregarem (espera inteligente: até 3s)
        await delay(2500);

        // Verifica se o perfil alvo apareceu nos resultados
        const segueOAlvo = await page.evaluate((alvo) => {
            const links = Array.from(document.querySelectorAll('div[role="dialog"] a'));
            return links.some(link => {
                const href = link.getAttribute('href');
                return href && href.includes(`/${alvo}/`);
            });
        }, alvoPrincipal);

        const classificacao = segueOAlvo ? "SEGUE" : "NÃO SEGUE";
        const resultadoTexto = `[ ${classificacao} ] @${nomeConta}`;
        console.log(resultadoTexto);
        fs.appendFileSync(nomeArquivoRelatorio, resultadoTexto + "\n");

    } catch (err) {
        const textoErro = `[ ERRO ] @${nomeConta}: ${err.message}`;
        console.log(textoErro);
        fs.appendFileSync(nomeArquivoRelatorio, textoErro + "\n");
    } finally {
        await page.close().catch(() => {});
    }
}

// ============================================================
// Executa contas em lotes paralelos (CONCORRENCIA = 2 abas)
// ============================================================
async function processarEmParalelo(browser, contas, alvoPrincipal, nomeArquivoRelatorio, concorrencia = 2) {
    const fila = [...contas];
    let em_andamento = 0;
    let indice = 0;

    return new Promise((resolve) => {
        function iniciarProxima() {
            if (indice >= fila.length && em_andamento === 0) {
                resolve();
                return;
            }

            while (em_andamento < concorrencia && indice < fila.length) {
                let nomeConta = fila[indice].replace('@', '').trim().toLowerCase();
                if (nomeConta.includes('instagram.com/')) {
                    nomeConta = nomeConta.replace(/\/$/, '').split('/').pop().split('?')[0];
                }
                indice++;
                em_andamento++;

                console.log(`\n🔍 Verificando: @${nomeConta}...`);

                verificarConta(browser, nomeConta, alvoPrincipal, nomeArquivoRelatorio)
                    .then(() => {
                        em_andamento--;
                        // Pequeno intervalo entre tarefas para não sobrecarregar o Instagram
                        setTimeout(iniciarProxima, 2500);
                    })
                    .catch(() => {
                        em_andamento--;
                        setTimeout(iniciarProxima, 2500);
                    });
            }
        }

        iniciarProxima();
    });
}

// ============================================================
// MAIN
// ============================================================
(async () => {
    const user = "lindalvaconcs";
    const pass = "Lindalva12345";

    // Pergunta o alvo no terminal
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const alvoPrincipal = await new Promise(resolve => {
        rl.question('\n👤 Digite o nome de usuário que deseja buscar (sem @): ', answer => {
            rl.close();
            resolve(answer.trim().replace('@', ''));
        });
    });

    if (!alvoPrincipal) {
        console.log('❌ Nenhum usuário informado. Encerrando...');
        return;
    }

    console.log(`\n🎯 Alvo: @${alvoPrincipal}`);
    console.log(`⚡ Modo: 2 contas em paralelo (mais rápido)\n`);

    try {
        const contas = fs.readFileSync('lista_perfil.txt', 'utf8')
            .split('\n')
            .map(c => c.trim())
            .filter(c => c && !c.startsWith('#'));

        if (contas.length === 0) {
            console.log("Por favor, adicione as contas válidas no arquivo lista_perfil.txt");
            return;
        }

        console.log(`📋 ${contas.length} contas carregadas.`);

        const browser = await puppeteer.launch({
            headless: "new",
            defaultViewport: { width: 1280, height: 900 },
            userDataDir: './insta_session',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,900']
        });

        // ============================
        // FASE 1: LOGIN (só se necessário)
        // ============================
        const loginPage = await browser.newPage();
        await loginPage.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36");

        console.log("🔐 Checando login no Instagram...");
        await loginPage.goto('https://www.instagram.com/', { waitUntil: 'networkidle2' });
        await delay(2000);

        const needsLogin = await loginPage.$('input[name="username"]');

        if (needsLogin) {
            // Sessão expirou — faz login e aguarda 25s para verificação manual
            console.log("⚠️  Sessão expirada. Fazendo login...");
            await loginPage.type('input[name="username"]', user, { delay: 100 });
            await loginPage.type('input[name="password"]', pass, { delay: 100 });
            await delay(1000);
            await loginPage.click('button[type="submit"]');
            await delay(4000);

            console.log("-----------------------------------------");
            console.log("ATENÇÃO: Aguardando 25 segundos!");
            console.log("Interaja com o navegador se o Instagram pedir verificação.");
            console.log("-----------------------------------------");
            await delay(25000);
        } else {
            // Sessão ativa — sem espera desnecessária
            console.log("✅ Sessão ativa! Iniciando buscas...");
            await delay(1000);
        }

        await loginPage.close();

        // ============================
        // FASE 2: VERIFICAÇÃO PARALELA
        // ============================
        const nomeArquivoRelatorio = 'resultado_reginaldo.txt';
        fs.writeFileSync(nomeArquivoRelatorio, `Relatório de Verificação: @${alvoPrincipal}\n=============================================\n`);

        const inicio = Date.now();
        await processarEmParalelo(browser, contas, alvoPrincipal, nomeArquivoRelatorio, 2);
        const fim = Date.now();

        const segundos = ((fim - inicio) / 1000).toFixed(1);
        console.log(`\n✅ Processo finalizado em ${segundos}s! Veja o arquivo '${nomeArquivoRelatorio}'`);
        await browser.close();

    } catch (error) {
        console.error("Erro fatal:", error);
    }
})();
