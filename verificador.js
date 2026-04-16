const puppeteer = require('puppeteer');
const fs = require('fs');

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// Processa UMA conta — abre aba, verifica e fecha
// ============================================================
async function verificarConta(browser, nomeConta, alvoPrincipal) {
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36");

    try {
        await page.goto(`https://www.instagram.com/${nomeConta}/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForSelector('header', { timeout: 8000 }).catch(() => null);

        const existe = await page.$('header');
        if (!existe) throw new Error("Página não encontrada.");

        const followingLink = await page.$(`a[href="/${nomeConta}/following/"]`);
        if (!followingLink) {
            return `[ PRIVADA/INEXISTENTE ] @${nomeConta}`;
        }

        await followingLink.click();
        await page.waitForSelector('div[role="dialog"]', { timeout: 10000 });
        await delay(1500);

        await page.waitForSelector('div[role="dialog"] input[type="text"]', { timeout: 8000 });
        const searchInput = await page.$('div[role="dialog"] input[type="text"]');

        if (!searchInput) {
            return `[ ERRO ] Barra de busca não encontrada em @${nomeConta}.`;
        }

        await searchInput.click({ clickCount: 3 });
        await page.keyboard.press('Backspace');
        await delay(400);
        await searchInput.type(alvoPrincipal, { delay: 80 });

        await delay(2500);

        const segueOAlvo = await page.evaluate((alvo) => {
            const links = Array.from(document.querySelectorAll('div[role="dialog"] a'));
            return links.some(link => {
                const href = link.getAttribute('href');
                return href && href.includes(`/${alvo}/`);
            });
        }, alvoPrincipal);

        const classificacao = segueOAlvo ? "SEGUE" : "NÃO SEGUE";
        return `[ ${classificacao} ] @${nomeConta}`;

    } catch (err) {
        return `[ ERRO ] @${nomeConta}: ${err.message}`;
    } finally {
        await page.close().catch(() => { });
    }
}

// ============================================================
// Execução controlada para API
// ============================================================
async function processarVerificacoesApi(contas, alvoPrincipal, jobId, callbackAtualizacao) {
    console.log(`[JOB ${jobId}] Iniciando verificação para ${contas.length} contas. Alvo: ${alvoPrincipal}`);
    
    let browser;
    let resultadosExtraidos = [];
    
    try {
        browser = await puppeteer.launch({
            headless: "new", // Alterado de volta para segundo plano
            defaultViewport: { width: 1280, height: 900 },
            userDataDir: './insta_session', // Aproveita sessao de testes manuais
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,900']
        });

        // FASE 1: Login Check (Sessão rápida para acordar o navegador)
        const loginPage = await browser.newPage();
        await loginPage.goto('https://www.instagram.com/', { waitUntil: 'networkidle2' });
        await delay(3000);
        await loginPage.close();

        // FASE 2: Concorrência Simples
        const fila = [...contas];
        const concorrencia = 3; // Aumentado para 3 abas em paralelo
        let em_andamento = 0;
        let indice = 0;

        return new Promise((resolve) => {
            function iniciarProxima() {
                if (indice >= fila.length && em_andamento === 0) {
                    // Finaliza tudo fechando o navegador
                    browser.close().then(() => resolve(resultadosExtraidos)).catch(()=> resolve(resultadosExtraidos));
                    return;
                }

                while (em_andamento < concorrencia && indice < fila.length) {
                    let nomeContaRaw = fila[indice].trim();
                    let nomeConta = nomeContaRaw.replace('@', '').trim().toLowerCase();
                    if (nomeConta.includes('instagram.com/')) {
                        nomeConta = nomeConta.replace(/\/$/, '').split('/').pop().split('?')[0];
                    }
                    
                    if (!nomeConta) {
                        indice++; // Pular vazio
                        continue;
                    }

                    indice++;
                    em_andamento++;
                    console.log(`[JOB] ⏱️ Iniciando @${nomeConta}... (Abas simultâneas: ${em_andamento}/${concorrencia})`);

                    verificarConta(browser, nomeConta, alvoPrincipal)
                        .then((resTexto) => {
                            em_andamento--;
                            resultadosExtraidos.push(resTexto); // Salva no array em memória
                            console.log(`[JOB] ✅ Concluído @${nomeConta}. Liberando slot...`);
                            
                            // Avisa o servidor principal que tivemos progresso
                            if(callbackAtualizacao) {
                                callbackAtualizacao(resultadosExtraidos);
                            }
                            
                            setTimeout(iniciarProxima, 500); // Chama a próxima rapidamente
                        })
                        .catch((e) => {
                            em_andamento--;
                            resultadosExtraidos.push(`[ ERRO EXTEMO ] @${nomeConta}: ${e.message}`);
                            console.log(`[JOB] ❌ Erro em @${nomeConta}. Liberando slot...`);
                            
                            if(callbackAtualizacao) {
                                callbackAtualizacao(resultadosExtraidos);
                            }
                            
                            setTimeout(iniciarProxima, 500); // Chama a próxima rapidamente
                        });
                }
            }

            iniciarProxima();
        });

    } catch (error) {
        console.error(`[JOB ${jobId}] Erro catastrófico:`, error);
        if (browser) await browser.close().catch(()=>{});
        return resultadosExtraidos;
    }
}

module.exports = {
    processarVerificacoesApi
};
