const puppeteer = require('puppeteer');
const fs = require('fs');

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
    // Utilize a mesma conta para o login
    const user = "lindalvaconcs";
    const pass = "Lindalva12345";
    
    // Alvo único agora
    const alvoPrincipal = 'reginaldo.veras';

    console.log(`Iniciando o verificador de seguidores para @${alvoPrincipal}...`);

    try {
        // Usa o MESMO ARQUIVO de perfis que estávamos usando antes
        const contas = fs.readFileSync('lista_perfil.txt', 'utf8')
            .split('\n')
            .map(c => c.trim())
            .filter(c => c && !c.startsWith('#'));

        if (contas.length === 0) {
            console.log("Por favor, adicione as contas válidas no arquivo lista_perfil.txt");
            return;
        }

        const browser = await puppeteer.launch({
            headless: false,
            defaultViewport: null,
            // MESMA PASTA DE SESSÃO DOS TESTES ANTERIORES PARA VOCÊ NÃO PRECISAR LOGAR DE NOVO 
            userDataDir: './insta_session' 
        });

        // ============================
        // FASE 1: LOGIN E PREPARAÇÃO
        // ============================
        const loginPage = await browser.newPage();
        await loginPage.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36");

        console.log("Checando login no Instagram...");
        await loginPage.goto('https://www.instagram.com/', { waitUntil: 'networkidle2' });
        await delay(3000);

        const needsLogin = await loginPage.$('input[name="username"]');

        if (needsLogin) {
            console.log("Fazendo o login automático por você...");
            await loginPage.type('input[name="username"]', user, { delay: 100 });
            await loginPage.type('input[name="password"]', pass, { delay: 100 });
            await delay(1000);
            await loginPage.click('button[type="submit"]');

            console.log("Aguardando o carregamento da página logo após o login...");
            await delay(5000);
        }

        console.log("-----------------------------------------");
        console.log("ATENÇÃO: Aguardando 25 segundos!");
        console.log("Interaja com o navegador se precisar aprovar o login!");
        console.log("-----------------------------------------");
        await delay(25000);

        console.log("Tempo esgotado! Fechando aba inicial e inciando buscas...");
        await loginPage.close();


        // ============================
        // FASE 2: VERIFICAÇÃO DE CONTAS
        // ============================
        const nomeArquivoRelatorio = 'resultado.txt'; // Usando o mesmo arquivo de resultado!
        fs.writeFileSync(nomeArquivoRelatorio, `Relatório de Verificação: @${alvoPrincipal}\n=============================================\n`);

        for (let conta of contas) {
            let nomeConta = conta.replace('@', '').trim().toLowerCase();
            
            if(nomeConta.includes('instagram.com/')) {
                nomeConta = nomeConta.replace(/\/$/, '').split('/').pop().split('?')[0];
            }

            console.log(`\nVerificando a conta: @${nomeConta}...`);

            // Navegação Isolada
            const page = await browser.newPage();
            await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36");

            try {
                await page.goto(`https://www.instagram.com/${nomeConta}/`, { waitUntil: 'networkidle2' });
                await delay(3500); 

                const existe = await page.$('header');
                if (!existe) {
                    throw new Error("Página não encontrada.");
                }

                const followingLink = await page.$(`a[href="/${nomeConta}/following/"]`);

                if (!followingLink) {
                    let texto = `[ ERRO ] @${nomeConta} é PRIVADA, NÃO tem seguidores ou NÃO existe.`;
                    console.log(texto);
                    fs.appendFileSync(nomeArquivoRelatorio, texto + "\n");
                    await delay(3000);
                    continue; 
                }

                await followingLink.click();
                await page.waitForSelector('div[role="dialog"]', { timeout: 10000 });
                await delay(2500);

                const searchInput = await page.$('div[role="dialog"] input[type="text"]');
                if (!searchInput) {
                    let texto = `[ ERRO ] Não encontrou a barra de busca de seguindo no perfil de @${nomeConta}.`;
                    console.log(texto);
                    fs.appendFileSync(nomeArquivoRelatorio, texto + "\n");
                    continue;
                }

                let classificacao = "NÃO SEGUE";

                await searchInput.click({ clickCount: 3 });
                await page.keyboard.press('Backspace');
                await delay(800);

                // Digita o alvo com um espaço extra no fim 
                await searchInput.type(alvoPrincipal + ' ', { delay: 100 });
                await delay(4000); 

                const segueOAlvo = await page.evaluate((alvo) => {
                    const links = Array.from(document.querySelectorAll('div[role="dialog"] a'));
                    return links.some(link => {
                        if (link.getAttribute('href') && typeof link.getAttribute('href') === 'string') {
                            return link.getAttribute('href').includes(`/${alvo}/`);
                        }
                        return false;
                    });
                }, alvoPrincipal);

                if(segueOAlvo) {
                    classificacao = "SEGUE";
                }

                let resultadoTexto = `[ ${classificacao} ] @${nomeConta}`;
                console.log(resultadoTexto);
                fs.appendFileSync(nomeArquivoRelatorio, resultadoTexto + "\n");

            } catch (err) {
                let textoErro = `[ ERRO ] Algo deu errado com a conta @${nomeConta}: ${err.message}`;
                console.log(textoErro);
                fs.appendFileSync(nomeArquivoRelatorio, textoErro + "\n");
            } finally {
                await page.close().catch(()=>{});
            }

            console.log("Aguardando um pequeno intervalo antes da próxima conta...");
            await delay(6000);
        }

        console.log(`\nProcesso Finalizado com sucesso! Veja o arquivo '${nomeArquivoRelatorio}'`);
        await browser.close();

    } catch (error) {
        console.error("Erro fatal:", error);
    }
})();
