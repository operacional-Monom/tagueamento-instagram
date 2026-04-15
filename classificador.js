const puppeteer = require('puppeteer');
const fs = require('fs');

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
    // Insira seu usuário e senha caso precise logar
    const user = "lindalvaconcs";
    const pass = "Lindalva12345";

    // Alvos para direita e esquerda
    const targetsDireita = ['jairmessiasbolsonaro', 'flaviobolsonaro', 'bolsonarosp', 'carlosbolsonaro', 'michellebolsonaro'];
    const targetsEsquerda = ['lulaoficial', 'ptbrasil'];

    console.log("Iniciando o classificador político de perfis via Puppeteer...");

    try {
        // Lendo arquivo lista_perfil.txt conforme solicitado
        if (!fs.existsSync('lista_perfil.txt')) {
            console.log("O arquivo lista_perfil.txt não foi encontrado!");
            return;
        }

        const contas = fs.readFileSync('lista_perfil.txt', 'utf8')
            .split('\n')
            .map(c => c.trim())
            .filter(c => c && !c.startsWith('#')); // Ignora linhas em branco ou comentadas

        if (contas.length === 0) {
            console.log("Por favor, adicione as contas a serem verificadas no arquivo lista_perfil.txt");
            return;
        }

        // Configuração do Puppeteer
        const browser = await puppeteer.launch({
            headless: "new",
            defaultViewport: null,
            userDataDir: './insta_session' // Salva o login
        });

        const page = await browser.newPage();
        await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36");

        console.log("Checando login no Instagram...");
        await page.goto('https://www.instagram.com/', { waitUntil: 'networkidle2' });
        await delay(3000);

        const needsLogin = await page.$('input[name="username"]');

        if (needsLogin) {
            console.log("Fazendo o login automático...");
            await page.type('input[name="username"]', user, { delay: 100 });
            await page.type('input[name="password"]', pass, { delay: 100 });
            await delay(1000);
            await page.click('button[type="submit"]');

            console.log("Aguardando confirmação do login com sucesso...");
            await page.waitForFunction(
                "window.location.pathname !== '/' && window.location.pathname !== '/accounts/login/'",
                { timeout: 60000 }
            );
            await delay(5000);
        }

        console.log("Login OK! Iniciando as verificações. O processo pode demorar alguns minutos dependendo da quantidade de contas...");

        fs.writeFileSync('resultado_classificacao.txt', "Relatório de Classificação de Perfis\n=============================================\n");

        for (let conta of contas) {
            // Extrai o nome de usuário corretamente, seja link, @ ou apenas o nome
            let nomeConta = conta.replace(/\/$/, '').split('/').pop().replace('@', '').split('?')[0];
            console.log(`\nVerificando a conta: @${nomeConta}...`);

            try {
                await page.goto(`https://www.instagram.com/${nomeConta}/`, { waitUntil: 'networkidle2' });
                await delay(3000);

                const existe = await page.$('header');
                if (!existe) {
                    throw new Error("Página não encontrada.");
                }

                // Aperta o botão de "Seguindo" ou "Following"
                const followingLink = await page.$(`a[href="/${nomeConta}/following/"]`);

                if (!followingLink) {
                    let texto = `[ ERRO ] @${nomeConta} - Conta é PRIVADA ou não existe. Não é possível classificar.`;
                    console.log(texto);
                    fs.appendFileSync('resultado_classificacao.txt', texto + "\n");
                    await delay(2000);
                    continue;
                }

                await followingLink.click();
                await page.waitForSelector('div[role="dialog"]', { timeout: 10000 });
                await delay(2000);

                const searchInput = await page.$('div[role="dialog"] input[type="text"]');
                if (!searchInput) {
                    let texto = `[ ERRO ] @${nomeConta} - Não localizou barra de busca.`;
                    console.log(texto);
                    fs.appendFileSync('resultado_classificacao.txt', texto + "\n");
                    continue;
                }

                let classificacao = "INDEFINIDO (Não segue nem Bolsonaro nem Lula/PT)";

                // Função auxiliar para buscar os alvos de uma lista
                const buscaAlvos = async (targets) => {
                    for (let alvo of targets) {
                        try {
                            // Limpa barra de pesquisa
                            await searchInput.click({ clickCount: 3 });
                            await page.keyboard.press('Backspace');
                            await delay(500);

                            // Digita o alvo
                            await searchInput.type(alvo, { delay: 150 });
                            await delay(3500); // Aguarda resultados

                            // Verifica se encontrou na lista (link exato do perfil)
                            const segueOAlvo = await page.evaluate((alvo) => {
                                const links = Array.from(document.querySelectorAll('div[role="dialog"] a'));
                                return links.some(link => {
                                    if (link.getAttribute('href') && typeof link.getAttribute('href') === 'string') {
                                        return link.getAttribute('href').includes(`/${alvo}/`);
                                    }
                                    return false;
                                });
                            }, alvo);

                            if (segueOAlvo) return true; // Conta segue um dos alvos
                        } catch (e) {
                            console.log(`Erro ao buscar ${alvo}:`, e.message);
                        }
                    }
                    return false;
                };

                // 1) Verifica se é Direita
                console.log(`  Buscando alvos da Direita...`);
                let isDireita = await buscaAlvos(targetsDireita);

                if (isDireita) {
                    classificacao = "DIREITA";
                } else {
                    // 2) Verifica se é Esquerda
                    console.log(`  Buscando alvos da Esquerda...`);
                    let isEsquerda = await buscaAlvos(targetsEsquerda);
                    if (isEsquerda) {
                        classificacao = "ESQUERDA";
                    }
                }

                let resultadoTexto = `[ ${classificacao} ] @${nomeConta}`;
                console.log(resultadoTexto);
                fs.appendFileSync('resultado_classificacao.txt', resultadoTexto + "\n");

                // Tenta fechar a janela dialog 
                await page.click('div[role="dialog"] button svg[aria-label="Close"]', { clickCount: 1 }).catch(() => { });
                await page.click('div[role="dialog"] button svg[aria-label="Fechar"]', { clickCount: 1 }).catch(() => { });

            } catch (err) {
                let textoErro = `[ ERRO ] @${nomeConta}: ${err.message}`;
                console.log(textoErro);
                fs.appendFileSync('resultado_classificacao.txt', textoErro + "\n");
            }

            console.log("Aguardando 5 segundos antes de ir para a próxima conta...");
            await delay(5000);
        }

        console.log("\nProcesso Finalizado com sucesso! Veja o arquivo 'resultado_classificacao.txt'");
        await browser.close();

    } catch (error) {
        console.error("Erro fatal:", error);
    }
})();
